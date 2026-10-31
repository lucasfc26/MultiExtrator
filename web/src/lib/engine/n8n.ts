import { request } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import { config } from '@/lib/config'
import type { RespostaExtracao } from '@/types/engine'
import { ROTA_FLUXO, type ExtractionEngine } from './types'

const base = config.n8nBase

/** A url_codigo vem absoluta (N8N_URL); o navegador passa pelo proxy. */
export function proxiedCodeUrl(urlCodigo: string): string {
  try {
    const u = new URL(urlCodigo)
    return `${u.pathname}${u.search}`
  } catch {
    return urlCodigo.startsWith('/') ? urlCodigo : `/${urlCodigo}`
  }
}

function explicar(e: unknown): never {
  if (e instanceof ApiError) {
    if (e.status === 403 || e.status === 401)
      throw new ApiError(
        'forbidden',
        'O n8n recusou a chave. Defina N8N_API_KEY (e N8N_API_KEY_HEADER) no web/.env.local com o valor da credencial "MultiExtractor API Key" e reinicie o npm run dev.',
        e.status,
        e.body,
      )
    if (e.status === 404)
      throw new ApiError(
        'not_found',
        'Webhook não encontrado no n8n. Importe e ative os workflows de n8n/workflows/.',
        e.status,
        e.body,
      )
  }
  throw e
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Webhooks públicos do n8n (README → API), pelo proxy /engine/n8n.
 * A chamada fica aberta até a extração terminar — sem polling nem cancelamento.
 */
export const n8nEngine: ExtractionEngine = {
  mode: 'n8n',
  supportsPolling: false,
  supportsCancel: false,
  supportsLogs: false,

  async start(fluxo, entrada, signal) {
    try {
      const { data } = await request<RespostaExtracao>(base, `/webhook/enel/${ROTA_FLUXO[fluxo]}`, {
        method: 'POST',
        body: entrada,
        signal,
        timeoutMs: 0,
        okStatuses: [202],
      })
      return data
    } catch (e) {
      explicar(e)
    }
  },

  async poll() {
    throw new ApiError('unknown', 'O modo n8n não oferece consulta de status.')
  },

  async sendCode(job, entrada, signal) {
    if (!job.urlCodigo) throw new ApiError('validation', 'Esta extração não tem url_codigo.')
    const path = proxiedCodeUrl(job.urlCodigo)
    // 409 "running already": o n8n ainda não voltou a esperar. Repetir em 1–2 s.
    for (let tentativa = 0; ; tentativa++) {
      try {
        const { data } = await request<RespostaExtracao>(base, path, {
          method: 'POST',
          body: entrada,
          signal,
          timeoutMs: 0,
          okStatuses: [202],
        })
        return data
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && tentativa < 6) {
          await sleep(1500)
          continue
        }
        if (e instanceof ApiError && e.status === 404)
          throw new ApiError(
            'not_found',
            'A url_codigo não vale mais (extração terminou ou expirou). Comece uma nova extração.',
            404,
          )
        explicar(e)
      }
    }
  },

  async cancel() {
    throw new ApiError('unknown', 'O modo n8n não oferece cancelamento.')
  },

  async health(signal) {
    try {
      await request(base, '/healthz', { signal, timeoutMs: 5000 })
      return { online: true, mode: 'n8n', detalhe: 'n8n no ar. A chave é injetada pelo proxy do Vite.' }
    } catch {
      return { online: false, mode: 'n8n', detalhe: 'n8n fora do ar em N8N_URL (docker compose up -d).' }
    }
  },
}
