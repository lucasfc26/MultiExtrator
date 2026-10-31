import { request } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import { config } from '@/lib/config'
import type { RespostaExtracao, WorkerHealth } from '@/types/engine'
import { ROTA_FLUXO, type ExtractionEngine } from './types'

const base = config.workerBase

/**
 * Worker Python direto (worker/app/main.py), pelo proxy /engine/worker.
 * Usa aguardar=false + polling: dá para acompanhar a fila, cancelar e ver logs.
 */
export const workerEngine: ExtractionEngine = {
  mode: 'worker',
  supportsPolling: true,
  supportsCancel: true,
  supportsLogs: true,

  async start(fluxo, entrada, signal) {
    const { data } = await request<RespostaExtracao>(base, `/extracoes/${ROTA_FLUXO[fluxo]}`, {
      method: 'POST',
      body: entrada,
      query: { aguardar: false, incluir_pdf: false },
      signal,
    })
    return data
  },

  async poll(jobId, opts = {}) {
    const { data } = await request<RespostaExtracao>(base, `/extracoes/${jobId}`, {
      query: { aguardar: false, incluir_pdf: opts.pdf ?? false, logs: opts.logs ?? false },
      signal: opts.signal,
    })
    return data
  },

  async sendCode(job, entrada, signal) {
    const { data } = await request<RespostaExtracao>(base, `/extracoes/${job.jobId}/codigo`, {
      method: 'POST',
      body: entrada,
      query: { aguardar: false, incluir_pdf: false },
      signal,
    })
    return data
  },

  async cancel(jobId) {
    const { data } = await request<RespostaExtracao>(base, `/extracoes/${jobId}`, {
      method: 'DELETE',
      query: {},
      timeoutMs: 60_000,
    })
    return data
  },

  async health(signal) {
    try {
      const { data } = await request<WorkerHealth>(base, '/health', { signal, timeoutMs: 5000 })
      const faltando = [
        !data.chaves.capsolver && 'CAPSOLVER_API_KEY (Enel)',
        !data.chaves.nonecap && 'NONECAP_API_KEY (2 VIA)',
      ].filter(Boolean)
      return {
        online: true,
        mode: 'worker',
        worker: data,
        detalhe: faltando.length
          ? `Worker no ar, mas sem ${faltando.join(' e ')}.`
          : `Worker no ar · ${data.max_jobs_simultaneos} extração(ões) simultânea(s).`,
      }
    } catch (e) {
      return {
        online: false,
        mode: 'worker',
        detalhe:
          e instanceof ApiError && e.kind !== 'aborted'
            ? 'Worker fora do ar em WORKER_URL. Exponha a porta 8000 no docker-compose (ver web/README.md).'
            : 'Verificando…',
      }
    }
  },
}
