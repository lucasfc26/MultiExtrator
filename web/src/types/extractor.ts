/**
 * Extrator: dados estruturados a partir de uma fatura enviada (upload ou API).
 * Contrato PROVISÓRIO — cada arquivo é uma requisição independente.
 *
 *  POST /extractions            multipart (file) → 202 { id, status }
 *  GET  /extractions/:id        → DataExtractionStatusResponse
 *  GET  /extractions/:id/result → { data, fields }
 */

export type DataExtractionStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'failed'

export interface ExtractedField {
  key: string
  label: string
  value: string | number | null
}

export interface DataExtraction {
  id: string
  /** id no servidor (depois do upload). */
  remoteId: string | null
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: string
  completedAt: string | null
  status: DataExtractionStatus
  /** % do upload; só quando o navegador informa progresso real. */
  uploadProgress: number | null
  error: string | null
  durationS: number | null
  data: Record<string, unknown> | null
  fields: ExtractedField[]
  source: 'upload' | 'api'
  demo: boolean
}

export interface DataExtractionStatusResponse {
  id: string
  status: Exclude<DataExtractionStatus, 'uploading'>
  error?: string | null
  duration_s?: number | null
}

export interface DataExtractionResult {
  data: Record<string, unknown>
  fields: ExtractedField[]
}
