import { config } from '@/lib/config'
import { api } from '@/lib/api/client'
import { ApiError, DEFAULT_MESSAGES, kindFromStatus, messageFromBody } from '@/lib/api/errors'
import { delay } from '@/mocks/db'
import type {
  DataExtractionResult,
  DataExtractionStatusResponse,
  ExtractedField,
} from '@/types/extractor'

/**
 * Extrator de dados (PROVISÓRIO — o motor ainda não existe no repositório):
 *  POST /extractions            multipart "file" → 202 { id, status }
 *  GET  /extractions/:id        → { id, status, error?, duration_s? }
 *  GET  /extractions/:id/result → { data, fields }
 * Com VITE_USE_MOCKS=true, um simulador devolve dados FICTÍCIOS marcados com "_simulado".
 */
export interface ExtractorService {
  upload(file: File, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<{ id: string }>
  status(id: string): Promise<DataExtractionStatusResponse>
  result(id: string): Promise<DataExtractionResult>
  /** true quando o progresso de upload vem do navegador (XHR real). */
  readonly realProgress: boolean
}

function xhrUpload(file: File, onProgress?: (pct: number) => void, signal?: AbortSignal) {
  return new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${config.apiBaseUrl}/extractions`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* corpo não-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as { id: string })
      const msg = messageFromBody(body)
      const kind = xhr.status >= 500 && !msg ? 'unavailable' : kindFromStatus(xhr.status)
      reject(new ApiError(kind, msg ?? DEFAULT_MESSAGES[kind], xhr.status, body))
    }
    xhr.onerror = () => reject(new ApiError('network', DEFAULT_MESSAGES.network))
    xhr.onabort = () => reject(new ApiError('aborted', DEFAULT_MESSAGES.aborted))
    signal?.addEventListener('abort', () => xhr.abort())
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

const http: ExtractorService = {
  realProgress: true,
  upload: xhrUpload,
  status: (id) => api.get<DataExtractionStatusResponse>(`/extractions/${id}`),
  result: (id) => api.get<DataExtractionResult>(`/extractions/${id}/result`),
}

// ─── Simulador ───────────────────────────────────────────────────────────────

interface MockJob {
  fileName: string
  started: number
}
const jobs = new Map<string, MockJob>()
const FILA_MS = 1200
const PROC_MS = 3500

function hash(s: string) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

function fakeResult(fileName: string): DataExtractionResult {
  const h = hash(fileName)
  const consumo = 150 + (h % 900)
  const tarifa = 0.89
  const energia = +(consumo * tarifa).toFixed(2)
  const icms = +(energia * 0.18).toFixed(2)
  const pis = +(energia * 0.0104).toFixed(2)
  const cofins = +(energia * 0.0478).toFixed(2)
  const ilum = 18.5
  const total = +(energia + icms + pis + cofins + ilum).toFixed(2)
  const d = new Date()
  const ref = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const venc = new Date(d.getFullYear(), d.getMonth(), 20).toLocaleDateString('pt-BR')
  const uc = String(10_000_000 + (h % 89_999_999))
  const data = {
    _simulado: true,
    _aviso: 'Dados fictícios gerados pelo simulador. O extrator real ainda não está conectado.',
    distribuidora: 'ENEL',
    numero_cliente: uc,
    referencia: ref,
    vencimento: venc,
    valor_total: total,
    consumo_kwh: consumo,
    tarifa_kwh: tarifa,
    tributos: { icms, pis, cofins },
    itens: [
      { descricao: 'Consumo de energia', quantidade_kwh: consumo, valor: energia },
      { descricao: 'Contribuição de iluminação pública', valor: ilum },
    ],
  }
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fields: ExtractedField[] = [
    { key: 'distribuidora', label: 'Distribuidora', value: 'ENEL' },
    { key: 'numero_cliente', label: 'Nº do cliente (UC)', value: uc },
    { key: 'referencia', label: 'Referência', value: ref },
    { key: 'vencimento', label: 'Vencimento', value: venc },
    { key: 'consumo_kwh', label: 'Consumo (kWh)', value: consumo },
    { key: 'valor_total', label: 'Valor total', value: brl(total) },
    { key: 'icms', label: 'ICMS', value: brl(icms) },
    { key: 'pis_cofins', label: 'PIS/COFINS', value: brl(pis + cofins) },
  ]
  return { data, fields }
}

const mock: ExtractorService = {
  realProgress: false,
  async upload(file) {
    await delay(150)
    const id = `demo-${crypto.randomUUID().slice(0, 8)}`
    jobs.set(id, { fileName: file.name, started: Date.now() })
    return { id }
  },
  async status(id) {
    await delay(120)
    const job = jobs.get(id)
    if (!job) throw new ApiError('not_found', 'Extração não encontrada (o simulador perde os dados ao recarregar).', 404)
    const t = Date.now() - job.started
    if (t < FILA_MS) return { id, status: 'queued' }
    if (t < FILA_MS + PROC_MS) return { id, status: 'processing' }
    if (/erro|falha/i.test(job.fileName))
      return { id, status: 'failed', error: '[demo] Não foi possível ler a fatura (arquivo ilegível).', duration_s: 4.7 }
    return { id, status: 'completed', duration_s: +((FILA_MS + PROC_MS) / 1000).toFixed(1) }
  },
  async result(id) {
    await delay(150)
    const job = jobs.get(id)
    if (!job) throw new ApiError('not_found', 'Resultado não encontrado.', 404)
    return fakeResult(job.fileName)
  },
}

export const extractorService: ExtractorService = config.useMocks ? mock : http
