import { BillingService } from './billing.service'
import { loadEnv } from '../config/env'

const env = loadEnv({
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  DOWNLOAD_URL_SECRET: 'b'.repeat(32),
  PAYMENT_WEBHOOK_SECRET: 'c'.repeat(16),
} as NodeJS.ProcessEnv)

describe('BillingService', () => {
  const billing = new BillingService(env)

  it('reserva custo do fluxo × meses (mínimo 1)', () => {
    expect(billing.invoiceReservation('CORPORATIVO', 0)).toBe(2)
    expect(billing.invoiceReservation('SITE_ENEL', 3)).toBe(9)
    expect(billing.invoiceReservation('SEGUNDA_VIA', 2)).toBe(10)
  })

  it('cobra só PDFs entregues, sem a cópia " Old" do refaturamento', () => {
    expect(billing.invoiceCharge('SITE_ENEL', ['07.2026 - 1.pdf', '07.2026 - 1 Old.pdf'])).toBe(3)
    expect(billing.invoiceCharge('SITE_ENEL', [])).toBe(0)
  })

  it('extrator: reserva o máximo e cobra dentro da faixa 5–8', () => {
    expect(billing.extractionReservation()).toBe(8)
    expect(billing.extractionCharge(undefined)).toBe(5)
    expect(billing.extractionCharge(6.4)).toBe(6)
    expect(billing.extractionCharge(20)).toBe(8)
    expect(billing.extractionCharge(1)).toBe(5)
  })
})

describe('configuração', () => {
  it('recusa segredos curtos', () => {
    expect(() => loadEnv({ DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'curto', DOWNLOAD_URL_SECRET: 'b'.repeat(32), PAYMENT_WEBHOOK_SECRET: 'c'.repeat(16) } as NodeJS.ProcessEnv)).toThrow(/JWT_ACCESS_SECRET/)
  })
})
