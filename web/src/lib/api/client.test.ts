import { afterEach, describe, expect, it, vi } from 'vitest'
import { request, setUnauthorizedHandler } from './client'
import { ApiError } from './errors'

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  setUnauthorizedHandler(null)
})

describe('request', () => {
  it('monta a URL com query e envia JSON', async () => {
    const spy = mockFetch(200, { ok: true })
    const { data } = await request<{ ok: boolean }>('/engine/worker', '/extracoes/site-enel', {
      method: 'POST',
      body: { usuario: 'x' },
      query: { aguardar: false, vazio: undefined },
    })
    expect(data.ok).toBe(true)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/engine/worker/extracoes/site-enel?aguardar=false')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ usuario: 'x' }))
  })

  it('usa a "observacao" do worker como mensagem de erro (422)', async () => {
    mockFetch(422, { status: 'erro', observacao: 'Dados inválidos — uc: deve ter números' })
    await expect(request('/x', '/y')).rejects.toMatchObject({
      kind: 'validation',
      status: 422,
      message: 'Dados inválidos — uc: deve ter números',
    })
  })

  it('aceita 202 quando pedido (2 VIA aguardando código)', async () => {
    mockFetch(202, { estado: 'aguardando_codigo' })
    const r = await request('/x', '/y', { okStatuses: [202] })
    expect(r.status).toBe(202)
  })

  it('5xx sem corpo (proxy sem destino) vira "unavailable"', async () => {
    mockFetch(500, undefined)
    const err = await request('/x', '/y').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('unavailable')
  })

  it('falha de rede vira "network"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/x', '/y')).rejects.toMatchObject({ kind: 'network' })
  })

  it('401 aciona o handler de sessão expirada', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    mockFetch(401, { message: 'expirou' })
    await expect(request('/x', '/y')).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
