import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resumoEntrada, sanitizeResponse, startExtraction, uiStatusOf } from './runner'
import { historyRepo } from '@/lib/storage/history-repo'

describe('uiStatusOf', () => {
  it('mapeia estado/status do motor para o badge', () => {
    expect(uiStatusOf('na_fila', 'processando')).toBe('queued')
    expect(uiStatusOf('aguardando_codigo', 'aguardando_codigo')).toBe('awaiting_code')
    expect(uiStatusOf('concluido', 'sucesso')).toBe('success')
    expect(uiStatusOf('concluido', 'atencao')).toBe('warning')
    expect(uiStatusOf('concluido', 'erro', 'Login ou senha inválidos')).toBe('failed')
    expect(uiStatusOf('concluido', 'erro', 'Extração cancelada.')).toBe('cancelled')
  })
})

describe('dados sensíveis', () => {
  it('o resumo nunca guarda senha e mascara CPF/CNPJ', () => {
    const r = resumoEntrada('site_enel', { usuario: 'u@x.com', senha: 'segredo', uc: '1' })
    expect(JSON.stringify(r)).not.toContain('segredo')
    const v = resumoEntrada('segunda_via', { uc: '1', cpf_cnpj: '12345678000199' })
    expect(v.cpf_cnpj).not.toContain('12345678000199')
  })

  it('a resposta guardada omite o base64 dos PDFs', () => {
    const s = sanitizeResponse({
      job_id: 'j',
      fluxo: 'site_enel',
      uc: '1',
      estado: 'concluido',
      status: 'sucesso',
      observacao: '',
      arquivos: [{ nome: 'a.pdf', referencia: null, tamanho_bytes: 3, pdf_base64: 'JVBERi0x' }],
    })
    expect(JSON.stringify(s)).not.toContain('JVBERi0x')
  })
})

describe('startExtraction (simulador)', () => {
  beforeEach(() => historyRepo.clear())

  it('registra no histórico e acompanha até concluir com PDF', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const id = await startExtraction('site_enel', { usuario: 'u@x.com', senha: 's', uc: '12345678', referencia: '07/2026' })
    const inicial = await historyRepo.get(id)
    expect(inicial?.entradaResumo.usuario).toBe('u@x.com')
    expect(JSON.stringify(inicial)).not.toContain('"s"')

    await vi.waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(2000)
        expect((await historyRepo.get(id))?.estado).toBe('concluido')
      },
      { timeout: 5000, interval: 10 },
    )
    vi.useRealTimers()
    const fim = (await historyRepo.get(id))!
    expect(fim.uiStatus).toBe('success')
    expect(fim.arquivosDisponiveis).toBe(true)
    expect(await historyRepo.getFile(id, fim.arquivos[0].nome)).toBeInstanceOf(Blob)
    expect(fim.timeline.map((t) => t.estado)).toEqual(expect.arrayContaining(['enviado', 'na_fila', 'concluido']))
  })
})
