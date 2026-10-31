import { describe, expect, it } from 'vitest'
import { normalizarReferencia, segundaViaSchema, siteEnelSchema, ultimos12Meses } from './schemas'

describe('referências', () => {
  it('aceita os mesmos formatos do worker', () => {
    expect(normalizarReferencia('07/2026')).toBe('07/2026')
    expect(normalizarReferencia('7/2026')).toBe('07/2026')
    expect(normalizarReferencia('072026')).toBe('07/2026')
    expect(normalizarReferencia('2026-07')).toBe('07/2026')
    expect(normalizarReferencia('13/2026')).toBeNull()
    expect(normalizarReferencia('julho')).toBeNull()
  })

  it('janela de 12 meses começa no mês atual', () => {
    const m = ultimos12Meses(new Date(2026, 0, 15))
    expect(m[0]).toBe('01/2026')
    expect(m[1]).toBe('12/2025')
    expect(m).toHaveLength(12)
  })

  it('recusa referência fora da janela da ENEL', () => {
    const r = siteEnelSchema.safeParse({ usuario: 'u', senha: 's', uc: '', tipo_conta: 'empresa', referencias: ['01/2001'] })
    expect(r.success).toBe(false)
  })
})

describe('2 VIA', () => {
  const base = { uc: '123', email_segunda_via: '', canal: 'email' as const, referencias: [] }
  it('exige CPF (11) ou CNPJ (14) dígitos, com ou sem pontuação', () => {
    expect(segundaViaSchema.safeParse({ ...base, cpf_cnpj: '12.345.678/0001-99' }).success).toBe(true)
    expect(segundaViaSchema.safeParse({ ...base, cpf_cnpj: '123.456.789-01' }).success).toBe(true)
    expect(segundaViaSchema.safeParse({ ...base, cpf_cnpj: '1234' }).success).toBe(false)
  })
})
