import { afterEach, describe, expect, it, vi } from 'vitest'
import { n8nEngine, proxiedCodeUrl } from './n8n'
import { workerEngine } from './worker'
import { mockEngine } from './mock'

afterEach(() => vi.restoreAllMocks())

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('workerEngine', () => {
  it('inicia sem esperar (aguardar=false) e sem PDF no corpo', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { job_id: 'j1', estado: 'na_fila' }))
    const r = await workerEngine.start('corporativo', { usuario: 'u', senha: 's', uc: '1' })
    expect(r.job_id).toBe('j1')
    expect(spy.mock.calls[0][0]).toBe('/engine/worker/extracoes/corporativo?aguardar=false&incluir_pdf=false')
  })

  it('envia o código para /extracoes/{id}/codigo', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { job_id: 'j1', estado: 'executando' }))
    await workerEngine.sendCode({ jobId: 'j1', urlCodigo: null }, { codigo: '123456' })
    expect(String(spy.mock.calls[0][0])).toMatch(/^\/engine\/worker\/extracoes\/j1\/codigo\?/)
  })

  it('health avisa quando faltam chaves de captcha', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, { ok: true, chaves: { capsolver: false, nonecap: true }, navegadores: {}, max_jobs_simultaneos: 1 }),
    )
    const h = await workerEngine.health()
    expect(h.online).toBe(true)
    expect(h.detalhe).toContain('CAPSOLVER_API_KEY')
  })
})

describe('n8nEngine', () => {
  it('converte a url_codigo absoluta em caminho do proxy', () => {
    expect(proxiedCodeUrl('https://n8n.empresa.com/webhook-waiting/1234')).toBe('/webhook-waiting/1234')
    expect(proxiedCodeUrl('http://localhost:5678/webhook-waiting/9?x=1')).toBe('/webhook-waiting/9?x=1')
  })

  it('repete o envio do código quando o n8n responde 409', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(409, { message: 'running already' }))
      .mockResolvedValueOnce(json(200, { job_id: 'j', estado: 'concluido', status: 'sucesso' }))
    vi.useFakeTimers()
    const p = n8nEngine.sendCode({ jobId: 'j', urlCodigo: 'http://localhost:5678/webhook-waiting/1' }, { codigo: '1' })
    await vi.advanceTimersByTimeAsync(1600)
    vi.useRealTimers()
    const r = await p
    expect(r.status).toBe('sucesso')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][0]).toBe('/engine/n8n/webhook-waiting/1')
  })

  it('403 explica como configurar a chave do n8n', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Authorization data is wrong!', { status: 403 }))
    await expect(n8nEngine.start('site_enel', { usuario: 'u', senha: 's' })).rejects.toThrow(/N8N_API_KEY/)
  })
})

describe('mockEngine', () => {
  it('2 VIA passa por aguardando_codigo e conclui com PDF depois do código', async () => {
    vi.useFakeTimers()
    const start = await mockEngine.start('segunda_via', { uc: '123', cpf_cnpj: '12345678901' })
    expect(start.estado).toBe('na_fila')
    vi.advanceTimersByTime(2000)
    expect((await mockEngine.poll(start.job_id)).estado).toBe('executando')
    vi.advanceTimersByTime(6000)
    expect((await mockEngine.poll(start.job_id)).estado).toBe('aguardando_codigo')
    await mockEngine.sendCode({ jobId: start.job_id, urlCodigo: null }, { codigo: '123456' })
    vi.advanceTimersByTime(6000)
    const fim = await mockEngine.poll(start.job_id, { pdf: true })
    vi.useRealTimers()
    expect(fim.status).toBe('sucesso')
    expect(fim.arquivos?.[0].pdf_base64).toBeTruthy()
    expect(atob(fim.arquivos![0].pdf_base64!)).toContain('%PDF-1.4')
  })
})
