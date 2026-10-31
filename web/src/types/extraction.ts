import type { ArquivoFatura, EstadoJob, Fluxo, StatusJob } from './engine'
import type { EngineMode } from '@/lib/config'

/** Status de interface (badges), derivado de estado + status do motor. */
export type UiStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'awaiting_code'
  | 'success'
  | 'warning'
  | 'failed'
  | 'cancelled'

export interface TimelineEvent {
  at: string
  estado: EstadoJob | 'enviado' | 'erro_http'
  status?: StatusJob
  mensagem: string
}

/**
 * Registro do histórico local. O motor não guarda histórico (o worker apaga o
 * job em 1 h), então o navegador guarda os metadados e os PDFs em IndexedDB.
 * Nunca guarda senha nem CPF/CNPJ completo.
 */
export interface ExtractionRecord {
  id: string
  jobId: string | null
  fluxo: Fluxo
  engine: EngineMode
  uc: string | null
  referencias: string[]
  /** Resumo da entrada sem segredos (login, CPF/CNPJ mascarado...). */
  entradaResumo: Record<string, string>
  criadoEm: string
  atualizadoEm: string
  concluidoEm: string | null
  estado: EstadoJob
  status: StatusJob
  uiStatus: UiStatus
  observacao: string
  duracaoS: number | null
  arquivos: Omit<ArquivoFatura, 'pdf_base64'>[]
  /** Data a partir da qual os PDFs locais são apagados. */
  expiraEm: string | null
  arquivosDisponiveis: boolean
  timeline: TimelineEvent[]
  expiraCodigoEm: string | null
  urlCodigo: string | null
  /** Resposta crua do motor (sem pdf_base64) para o visualizador JSON. */
  respostaBruta: unknown
  demo: boolean
}

export interface HistoryQuery {
  search?: string
  status?: UiStatus | 'all'
  fluxo?: Fluxo | 'all'
  from?: string
  to?: string
  sort?: 'recent' | 'oldest' | 'duration'
  page?: number
  pageSize?: number
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
