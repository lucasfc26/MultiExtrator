import { config } from '@/lib/config'
import { ApiError, DEFAULT_MESSAGES, kindFromStatus, messageFromBody } from './errors'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /** ms; 0 = sem timeout (extrações longas). */
  timeoutMs?: number
  headers?: Record<string, string>
  /** Aceita estes status como resposta válida (ex.: 202 da 2 VIA). */
  okStatuses?: number[]
}

let onUnauthorized: (() => void) | null = null

/** Registrado pelo AuthProvider: 401 → tela de sessão expirada. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']) {
  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${url}?${s}` : url
}

function devLog(method: string, url: string, status: number | string, ms: number) {
  // Só método, caminho e status: nunca corpo (senhas, CPF/CNPJ, PDFs).
  if (config.isDev && import.meta.env.MODE !== 'test') {
    console.debug(`[api] ${method} ${url.split('?')[0]} → ${status} (${Math.round(ms)} ms)`)
  }
}

export async function request<T>(
  base: string,
  path: string,
  opts: RequestOptions = {},
): Promise<{ data: T; status: number }> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')
  const url = buildUrl(base, path, opts.query)
  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? config.apiTimeoutMs
  let timedOut = false
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : null
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const started = performance.now()

  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    devLog(method, url, 'ERR', performance.now() - started)
    if (timedOut) throw new ApiError('timeout', DEFAULT_MESSAGES.timeout)
    if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError'))
      throw new ApiError('aborted', DEFAULT_MESSAGES.aborted)
    throw new ApiError('network', DEFAULT_MESSAGES.network)
  } finally {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  devLog(method, url, res.status, performance.now() - started)

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (res.ok || opts.okStatuses?.includes(res.status)) return { data: body as T, status: res.status }

  const fromBody = messageFromBody(body)
  // Proxy do Vite sem destino no ar responde 5xx sem corpo JSON.
  const kind = res.status >= 500 && !fromBody ? 'unavailable' : kindFromStatus(res.status)
  if (kind === 'unauthorized') onUnauthorized?.()
  throw new ApiError(kind, fromBody ?? DEFAULT_MESSAGES[kind], res.status, body)
}

type Opts = Omit<RequestOptions, 'method' | 'body'>

/** Cliente da plataforma (backend NestJS — contratos provisórios). */
export const api = {
  get: <T>(path: string, opts?: Opts) =>
    request<T>(config.apiBaseUrl, path, { ...opts, method: 'GET' }).then((r) => r.data),
  post: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(config.apiBaseUrl, path, { ...opts, method: 'POST', body: body ?? {} }).then(
      (r) => r.data,
    ),
  patch: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(config.apiBaseUrl, path, { ...opts, method: 'PATCH', body: body ?? {} }).then(
      (r) => r.data,
    ),
  delete: <T>(path: string, opts?: Opts) =>
    request<T>(config.apiBaseUrl, path, { ...opts, method: 'DELETE' }).then((r) => r.data),
}
