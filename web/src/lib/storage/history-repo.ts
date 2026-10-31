import type { ExtractionRecord, HistoryQuery, Paginated } from '@/types/extraction'

/**
 * Histórico de extrações no navegador. O motor não tem histórico (o worker
 * descarta o job em 1 h), então os metadados e os PDFs ficam em IndexedDB
 * até o backend da plataforma existir. Sem IndexedDB (testes): memória.
 */

const DB_NAME = 'multiextractor'
const DB_VERSION = 1
const RECORDS = 'records'
const FILES = 'files'

interface Backend {
  getAll(): Promise<ExtractionRecord[]>
  get(id: string): Promise<ExtractionRecord | undefined>
  put(r: ExtractionRecord): Promise<void>
  delete(id: string): Promise<void>
  putFile(key: string, blob: Blob): Promise<void>
  getFile(key: string): Promise<Blob | undefined>
  deleteFiles(prefix: string): Promise<void>
  clear(): Promise<void>
}

function memoryBackend(): Backend {
  const records = new Map<string, ExtractionRecord>()
  const files = new Map<string, Blob>()
  return {
    getAll: async () => [...records.values()].map((r) => structuredClone(r)),
    get: async (id) => (records.has(id) ? structuredClone(records.get(id)!) : undefined),
    put: async (r) => void records.set(r.id, structuredClone(r)),
    delete: async (id) => void records.delete(id),
    putFile: async (k, b) => void files.set(k, b),
    getFile: async (k) => files.get(k),
    deleteFiles: async (prefix) => {
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k)
    },
    clear: async () => {
      records.clear()
      files.clear()
    },
  }
}

function idbBackend(): Backend {
  let dbp: Promise<IDBDatabase> | null = null
  const open = () =>
    (dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))

  async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void) {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode)
      const req = fn(t.objectStore(store))
      t.oncomplete = () => resolve(req ? req.result : (undefined as T))
      t.onerror = () => reject(t.error)
    })
  }

  return {
    getAll: () => tx<ExtractionRecord[]>(RECORDS, 'readonly', (s) => s.getAll()),
    get: (id) => tx<ExtractionRecord | undefined>(RECORDS, 'readonly', (s) => s.get(id)),
    put: (r) => tx<void>(RECORDS, 'readwrite', (s) => void s.put(r)),
    delete: (id) => tx<void>(RECORDS, 'readwrite', (s) => void s.delete(id)),
    putFile: (k, b) => tx<void>(FILES, 'readwrite', (s) => void s.put(b, k)),
    getFile: (k) => tx<Blob | undefined>(FILES, 'readonly', (s) => s.get(k)),
    deleteFiles: (prefix) =>
      tx<void>(FILES, 'readwrite', (s) => void s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))),
    clear: async () => {
      await tx<void>(RECORDS, 'readwrite', (s) => void s.clear())
      await tx<void>(FILES, 'readwrite', (s) => void s.clear())
    },
  }
}

const backend: Backend = typeof indexedDB === 'undefined' ? memoryBackend() : idbBackend()

const fileKey = (recordId: string, nome: string) => `${recordId}/${nome}`

const ORDER: Record<NonNullable<HistoryQuery['sort']>, (a: ExtractionRecord, b: ExtractionRecord) => number> = {
  recent: (a, b) => b.criadoEm.localeCompare(a.criadoEm),
  oldest: (a, b) => a.criadoEm.localeCompare(b.criadoEm),
  duration: (a, b) => (b.duracaoS ?? -1) - (a.duracaoS ?? -1),
}

export function filterRecords(all: ExtractionRecord[], q: HistoryQuery): Paginated<ExtractionRecord> {
  const search = q.search?.trim().toLowerCase()
  const from = q.from ? new Date(`${q.from}T00:00:00`).getTime() : null
  const to = q.to ? new Date(`${q.to}T23:59:59.999`).getTime() : null
  const items = all
    .filter((r) => !q.status || q.status === 'all' || r.uiStatus === q.status)
    .filter((r) => !q.fluxo || q.fluxo === 'all' || r.fluxo === q.fluxo)
    .filter((r) => {
      if (!search) return true
      const hay = [r.id, r.jobId, r.uc, ...r.arquivos.map((a) => a.nome), ...r.referencias]
      return hay.some((v) => v?.toLowerCase().includes(search))
    })
    .filter((r) => {
      const t = new Date(r.criadoEm).getTime()
      return (from === null || t >= from) && (to === null || t <= to)
    })
    .sort(ORDER[q.sort ?? 'recent'])
  const pageSize = q.pageSize ?? 10
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(1, q.page ?? 1), totalPages)
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    totalPages,
  }
}

export const historyRepo = {
  async all(): Promise<ExtractionRecord[]> {
    return (await backend.getAll()).sort(ORDER.recent)
  },
  async list(q: HistoryQuery = {}): Promise<Paginated<ExtractionRecord>> {
    return filterRecords(await backend.getAll(), q)
  },
  get: (id: string) => backend.get(id),
  put: (r: ExtractionRecord) => backend.put(r),
  async remove(id: string) {
    await backend.deleteFiles(`${id}/`)
    await backend.delete(id)
  },
  saveFile: (recordId: string, nome: string, blob: Blob) => backend.putFile(fileKey(recordId, nome), blob),
  getFile: (recordId: string, nome: string) => backend.getFile(fileKey(recordId, nome)),
  /** Apaga os PDFs vencidos e mantém os metadados (o histórico continua consultável). */
  async purgeExpired(now = Date.now()): Promise<number> {
    let n = 0
    for (const r of await backend.getAll()) {
      if (r.arquivosDisponiveis && r.expiraEm && new Date(r.expiraEm).getTime() <= now) {
        await backend.deleteFiles(`${r.id}/`)
        await backend.put({ ...r, arquivosDisponiveis: false })
        n++
      }
    }
    return n
  },
  clear: () => backend.clear(),
}
