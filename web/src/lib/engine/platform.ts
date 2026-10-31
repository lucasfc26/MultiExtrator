import { api } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import type { EstadoJob, Fluxo, RespostaExtracao, StatusJob } from '@/types/engine'
import type { ExtractionEngine } from './types'

/**
 * Nova fatura pela API Fatturas (backend NestJS). A API reserva e cobra os
 * créditos, guarda os PDFs por 30 dias e acompanha o worker sozinha; aqui só
 * consultamos o estado. `job_id` é o id da fatura na API.
 */

interface InvoiceFile {
  id: string
  fileName: string
  referencia: string | null
  sizeBytes: number
  available: boolean
}

interface InvoiceDto {
  id: string
  flow: Fluxo
  uc: string | null
  state: 'pending' | 'queued' | 'running' | 'awaiting_code' | 'completed'
  status: 'processing' | 'awaiting_code' | 'success' | 'warning' | 'error'
  observation: string
  durationS: number | null
  codeExpiresAt: string | null
  files?: InvoiceFile[]
}

const ESTADO: Record<InvoiceDto['state'], EstadoJob> = {
  pending: 'na_fila',
  queued: 'na_fila',
  running: 'executando',
  awaiting_code: 'aguardando_codigo',
  completed: 'concluido',
}
const STATUS: Record<InvoiceDto['status'], StatusJob> = {
  processing: 'processando',
  awaiting_code: 'aguardando_codigo',
  success: 'sucesso',
  warning: 'atencao',
  error: 'erro',
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function toResposta(inv: InvoiceDto, withPdf = false): Promise<RespostaExtracao> {
  const arquivos = await Promise.all(
    (inv.files ?? []).map(async (f) => {
      const base = { nome: f.fileName, referencia: f.referencia, tamanho_bytes: f.sizeBytes }
      if (!withPdf || !f.available) return base
      const { url } = await api.get<{ url: string }>(`/invoices/${inv.id}/files/${f.id}/link`)
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return base
      return { ...base, pdf_base64: await toBase64(await res.blob()) }
    }),
  )
  return {
    job_id: inv.id,
    fluxo: inv.flow,
    uc: inv.uc,
    estado: ESTADO[inv.state],
    status: STATUS[inv.status],
    observacao: inv.observation,
    ...(inv.state === 'completed' ? { arquivos, duracao_s: inv.durationS ?? undefined } : {}),
    ...(inv.codeExpiresAt
      ? { expira_em_s: Math.max(0, Math.round((new Date(inv.codeExpiresAt).getTime() - Date.now()) / 1000)) }
      : {}),
  }
}

export const platformEngine: ExtractionEngine = {
  mode: 'platform',
  supportsPolling: true,
  supportsCancel: true,
  supportsLogs: true,

  async start(fluxo, entrada) {
    const inv = await api.post<InvoiceDto>('/invoices', { flow: fluxo, ...entrada }, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    return toResposta(inv)
  },

  async poll(jobId, opts = {}) {
    const inv = await api.get<InvoiceDto>(`/invoices/${jobId}`, { signal: opts.signal })
    const r = await toResposta(inv, opts.pdf)
    if (opts.logs) r.logs = await api.get<string[]>(`/invoices/${jobId}/logs`).catch(() => [])
    return r
  },

  async sendCode(job, entrada) {
    return toResposta(await api.post<InvoiceDto>(`/invoices/${job.jobId}/code`, entrada))
  },

  async cancel(jobId) {
    return toResposta(await api.post<InvoiceDto>(`/invoices/${jobId}/cancel`))
  },

  async health(signal) {
    try {
      const h = await api.get<{ ok: boolean; worker: { online: boolean } }>('/health', { signal, timeoutMs: 8000 })
      return {
        online: h.ok,
        mode: 'platform',
        detalhe: h.worker.online
          ? 'API e motor no ar. Créditos cobrados pela API.'
          : 'API no ar, mas o motor (worker) está fora — as buscas vão falhar.',
      }
    } catch (e) {
      return {
        online: false,
        mode: 'platform',
        detalhe: e instanceof ApiError && e.kind !== 'aborted' ? 'API Fatturas fora do ar (BACKEND_URL).' : 'Verificando…',
      }
    }
  },
}
