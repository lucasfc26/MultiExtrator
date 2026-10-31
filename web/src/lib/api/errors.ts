export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'server'
  | 'unavailable'
  | 'unknown'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly body: unknown

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.body = body
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 422) return 'validation'
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  if (status >= 500) return 'server'
  return 'unknown'
}

export const DEFAULT_MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Não foi possível conectar ao servidor. Verifique se o serviço está no ar.',
  timeout: 'O servidor demorou demais para responder.',
  aborted: 'A requisição foi cancelada.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
  forbidden: 'Acesso negado. Verifique a chave ou suas permissões.',
  not_found: 'Recurso não encontrado.',
  conflict: 'A operação conflita com o estado atual.',
  validation: 'Dados inválidos.',
  server: 'Erro interno do servidor.',
  unavailable: 'Serviço indisponível no momento. Verifique se ele está no ar.',
  unknown: 'Erro inesperado.',
}

/** Mensagem segura para o usuário: prioriza a do servidor, sem detalhes internos. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || DEFAULT_MESSAGES[err.kind]
  if (err instanceof Error && err.message) return err.message
  return DEFAULT_MESSAGES.unknown
}

/** Extrai a mensagem dos formatos conhecidos (worker/n8n: `observacao`; Nest: `message`). */
export function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const msg = b.observacao ?? b.message ?? b.error ?? b.detail
  if (Array.isArray(msg)) return msg.join('; ')
  return typeof msg === 'string' && msg ? msg : null
}
