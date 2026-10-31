import type { CreditPackage } from '@/types/platform'

/**
 * Tabela comercial. Quando o backend existir, `GET /credits/packages` é a
 * fonte da verdade; estes valores são o padrão exibido até lá.
 */

/** Custo de cada operação, em créditos (o valor exato é definido pelo servidor). */
export const OPERATION_COSTS = {
  fatura: { label: 'Nova fatura', min: 2, max: 5, desc: 'Buscar a fatura em PDF direto na ENEL' },
  extracao: { label: 'Extrator', min: 5, max: 8, desc: 'Extrair os dados de uma fatura (upload ou API) em JSON/CSV' },
} as const

export type Operation = keyof typeof OPERATION_COSTS

/** Créditos de boas-vindas ao criar a conta (o backend é quem credita). */
export const SIGNUP_BONUS_CREDITS = 200

const faixa = (credits: number, op: Operation) => {
  const { min, max } = OPERATION_COSTS[op]
  const fmt = (n: number) => n.toLocaleString('pt-BR')
  return `${fmt(Math.floor(credits / max))} a ${fmt(Math.floor(credits / min))}`
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'pkg-400',
    name: 'Inicial',
    credits: 400,
    priceCents: 4900,
    benefits: [
      `${faixa(400, 'fatura')} faturas`,
      `ou ${faixa(400, 'extracao')} extrações de dados`,
      'Enel, Corporativo e 2 VIA',
      'Acesso à API',
    ],
  },
  {
    id: 'pkg-6000',
    name: 'Profissional',
    credits: 6000,
    priceCents: 59900,
    benefits: [
      `${faixa(6000, 'fatura')} faturas`,
      `ou ${faixa(6000, 'extracao')} extrações de dados`,
      'Prioridade na fila',
      'Suporte por e-mail',
    ],
    highlighted: true,
  },
  {
    id: 'pkg-12000',
    name: 'Escala',
    credits: 12000,
    priceCents: 99900,
    benefits: [
      `${faixa(12000, 'fatura')} faturas`,
      `ou ${faixa(12000, 'extracao')} extrações de dados`,
      'Múltiplas API keys',
      'Suporte dedicado',
    ],
  },
]

/** Preço por crédito com 3 casas (ex.: "R$ 0,123"): os valores ficam abaixo de 1 centavo de diferença. */
export function formatUnitPrice(pkg: Pick<CreditPackage, 'priceCents' | 'credits'>): string {
  return (pkg.priceCents / 100 / pkg.credits).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

/** Economia em relação ao pacote de entrada, por crédito. */
export function savingsVsBase(pkg: CreditPackage): number {
  const base = CREDIT_PACKAGES[0]
  const unit = pkg.priceCents / pkg.credits
  const baseUnit = base.priceCents / base.credits
  return Math.round((1 - unit / baseUnit) * 100)
}

/** Faixa estimada de uma operação repetida N vezes (meses de fatura ou arquivos no Extrator). */
export function estimate(op: Operation, quantidade: number) {
  const n = Math.max(1, quantidade)
  return { min: n * OPERATION_COSTS[op].min, max: n * OPERATION_COSTS[op].max }
}
