import type { EngineMode } from '@/lib/config'
import type {
  EntradaCodigo,
  EntradaPorFluxo,
  Fluxo,
  RespostaExtracao,
  WorkerHealth,
} from '@/types/engine'

export interface EngineHealth {
  online: boolean
  mode: EngineMode
  detalhe: string
  worker?: WorkerHealth
}

/**
 * Adaptador do motor de extração. Os componentes não sabem se estão falando
 * com o worker, com o n8n ou com o simulador.
 */
export interface ExtractionEngine {
  readonly mode: EngineMode
  /** true = start() volta logo e o progresso vem por poll(). */
  readonly supportsPolling: boolean
  readonly supportsCancel: boolean
  readonly supportsLogs: boolean
  /** worker: volta na hora (aguardar=false). n8n: bloqueia até o fim ou o 202 da 2 VIA. */
  start<F extends Fluxo>(fluxo: F, entrada: EntradaPorFluxo[F], signal?: AbortSignal): Promise<RespostaExtracao>
  poll(jobId: string, opts?: { signal?: AbortSignal; logs?: boolean; pdf?: boolean }): Promise<RespostaExtracao>
  sendCode(
    job: { jobId: string; urlCodigo: string | null },
    entrada: EntradaCodigo,
    signal?: AbortSignal,
  ): Promise<RespostaExtracao>
  cancel(jobId: string): Promise<RespostaExtracao>
  health(signal?: AbortSignal): Promise<EngineHealth>
}

export const ROTA_FLUXO: Record<Fluxo, string> = {
  site_enel: 'site-enel',
  corporativo: 'corporativo',
  segunda_via: 'segunda-via',
}
