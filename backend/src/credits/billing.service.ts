import { Inject, Injectable } from '@nestjs/common'
import type { InvoiceFlow } from '@prisma/client'
import { ENV, type Env } from '../config/env'

/**
 * Regras de cobrança, centralizadas e configuráveis por ambiente.
 *
 * Premissas (ajustáveis no .env, ver docs/cobranca.md):
 *  - Nova fatura: custo fixo por fatura entregue, conforme o fluxo
 *    (Corporativo 2, Enel 3, 2 VIA 5 — o 2 VIA tem hCaptcha + código).
 *    Reserva = custo × meses pedidos. Cobra só PDFs entregues (a cópia
 *    " Old" de refaturamento não conta). Erro ou "atenção" sem PDF não cobra.
 *  - Extrator: entre MIN e MAX por arquivo. Reserva o MÁXIMO; o conversor
 *    informa o custo real (ex.: por páginas), limitado à faixa. Falha não cobra.
 */
@Injectable()
export class BillingService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  invoiceUnitCost(flow: InvoiceFlow): number {
    return { SITE_ENEL: this.env.COST_SITE_ENEL, CORPORATIVO: this.env.COST_CORPORATIVO, SEGUNDA_VIA: this.env.COST_SEGUNDA_VIA }[flow]
  }

  invoiceReservation(flow: InvoiceFlow, months: number): number {
    return this.invoiceUnitCost(flow) * Math.max(1, months)
  }

  invoiceCharge(flow: InvoiceFlow, pdfNames: string[]): number {
    const entregues = pdfNames.filter((n) => !/ old\.pdf$/i.test(n)).length
    return this.invoiceUnitCost(flow) * entregues
  }

  extractionReservation(): number {
    return this.env.EXTRACTION_COST_MAX
  }

  extractionCharge(reported?: number | null): number {
    const { EXTRACTION_COST_MIN: min, EXTRACTION_COST_MAX: max } = this.env
    return Math.min(max, Math.max(min, Math.round(reported ?? min)))
  }

  /** Tabela pública (para a interface e a documentação). */
  table() {
    return {
      invoice: {
        site_enel: this.env.COST_SITE_ENEL,
        corporativo: this.env.COST_CORPORATIVO,
        segunda_via: this.env.COST_SEGUNDA_VIA,
      },
      extraction: { min: this.env.EXTRACTION_COST_MIN, max: this.env.EXTRACTION_COST_MAX },
      signupBonus: this.env.SIGNUP_BONUS_CREDITS,
    }
  }
}
