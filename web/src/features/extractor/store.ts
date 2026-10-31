import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ApiError, userMessage } from '@/lib/api/errors'
import { extractorService } from '@/lib/api/services/extractor.service'
import { notificationsService } from '@/lib/api/services/notifications.service'
import { config } from '@/lib/config'
import type { DataExtraction } from '@/types/extractor'

/**
 * Extrações de dados feitas no Extrator. Cada arquivo é uma requisição
 * independente. Metadados e resultados ficam no navegador (sem os arquivos
 * originais, que só existem nesta sessão).
 */

interface ExtractorState {
  items: DataExtraction[]
  update: (id: string, patch: Partial<DataExtraction>) => void
  add: (item: DataExtraction) => void
  remove: (id: string) => void
  clear: () => void
}

export const useExtractor = create<ExtractorState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) => set((s) => ({ items: [item, ...s.items].slice(0, 200) })),
      update: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      remove: (id) => {
        originals.delete(id)
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
      },
      clear: () => {
        originals.clear()
        set({ items: [] })
      },
    }),
    {
      name: 'me-extractor',
      // Recarregou no meio do envio/processamento: não dá para retomar o upload.
      onRehydrateStorage: () => (state) => {
        state?.items.forEach((i) => {
          if (i.status === 'uploading')
            state.update(i.id, { status: 'failed', error: 'A página foi recarregada durante o envio.', uploadProgress: null })
          else if ((i.status === 'queued' || i.status === 'processing') && i.remoteId) void track(i.id, i.remoteId)
        })
      },
    },
  ),
)

/** Arquivos originais (só nesta sessão do navegador). */
const originals = new Map<string, File>()
export const getOriginal = (id: string) => originals.get(id) ?? null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function track(localId: string, remoteId: string) {
  const { update } = useExtractor.getState()
  let falhas = 0
  for (;;) {
    await sleep(1500)
    try {
      const st = await extractorService.status(remoteId)
      falhas = 0
      if (st.status === 'completed') {
        const res = await extractorService.result(remoteId)
        update(localId, {
          status: 'completed',
          data: res.data,
          fields: res.fields,
          durationS: st.duration_s ?? null,
          completedAt: new Date().toISOString(),
        })
        await notify(localId, true)
        return
      }
      if (st.status === 'failed') {
        update(localId, {
          status: 'failed',
          error: st.error ?? 'A extração falhou.',
          durationS: st.duration_s ?? null,
          completedAt: new Date().toISOString(),
        })
        await notify(localId, false)
        return
      }
      update(localId, { status: st.status })
    } catch (e) {
      if ((e instanceof ApiError && e.kind === 'not_found') || ++falhas >= 20) {
        update(localId, { status: 'failed', error: userMessage(e), completedAt: new Date().toISOString() })
        return
      }
    }
  }
}

async function notify(id: string, ok: boolean) {
  if (!config.useMocks) return
  const item = useExtractor.getState().items.find((i) => i.id === id)
  if (!item) return
  await notificationsService.pushLocal({
    type: ok ? 'extraction_completed' : 'extraction_failed',
    title: ok ? 'Dados extraídos' : 'Extração de dados com falha',
    body: ok ? item.fileName : `${item.fileName}: ${item.error ?? ''}`,
    link: '/app/extrator',
  })
}

/** Envia cada arquivo como uma extração independente. */
export async function extractFiles(files: File[]) {
  const { add, update } = useExtractor.getState()
  await Promise.all(
    files.map(async (file) => {
      const localId = crypto.randomUUID()
      originals.set(localId, file)
      add({
        id: localId,
        remoteId: null,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
        completedAt: null,
        status: 'uploading',
        uploadProgress: extractorService.realProgress ? 0 : null,
        error: null,
        durationS: null,
        data: null,
        fields: [],
        source: 'upload',
        demo: config.useMocks,
      })
      try {
        const { id } = await extractorService.upload(file, (pct) => update(localId, { uploadProgress: pct }))
        update(localId, { status: 'queued', uploadProgress: null, remoteId: id })
        void track(localId, id)
      } catch (e) {
        update(localId, { status: 'failed', error: userMessage(e), uploadProgress: null, completedAt: new Date().toISOString() })
      }
    }),
  )
}
