import { config } from '@/lib/config'
import { ApiError } from '@/lib/api/errors'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { db, delay, save, uid } from '@/mocks/db'
import { CREDIT_PACKAGES } from '@/config/pricing'
import type {
  CreditBalance,
  CreditPackage,
  CreditTransaction,
  CreditTxType,
  PaymentMethod,
  PaymentOrder,
} from '@/types/platform'
import type { Paginated } from '@/types/extraction'

/**
 * Créditos e pagamentos (PROVISÓRIO):
 *  GET  /credits/balance                  → CreditBalance
 *  GET  /credits/transactions?type&page   → Paginated<CreditTransaction>
 *  GET  /credits/packages                 → CreditPackage[]
 *  POST /payments/orders {packageId,method} → PaymentOrder (PIX/checkout hospedado/boleto)
 *  GET  /payments/orders/:id              → PaymentOrder
 * O saldo só muda quando o backend confirma o pagamento (webhook do gateway).
 */
export interface TxQuery {
  type?: CreditTxType | 'all'
  page?: number
  pageSize?: number
}

export interface CreditsService {
  balance(): Promise<CreditBalance>
  transactions(q: TxQuery): Promise<Paginated<CreditTransaction>>
  packages(): Promise<CreditPackage[]>
  createOrder(packageId: string, method: PaymentMethod): Promise<PaymentOrder>
  getOrder(id: string): Promise<PaymentOrder>
  /** Só no modo demo: simula o retorno do gateway para testar os estados da tela. */
  simulateGateway?(id: string, outcome: 'confirmed' | 'declined' | 'expired'): Promise<PaymentOrder>
}

const http: CreditsService = {
  balance: async () => ({ ...(await api.get<Omit<CreditBalance, 'demo'>>(endpoints.credits.balance)), demo: false }),
  transactions: (q) =>
    api.get<Paginated<CreditTransaction>>(endpoints.credits.transactions, {
      query: { type: q.type === 'all' ? undefined : q.type, page: q.page, pageSize: q.pageSize },
    }),
  packages: () => api.get<CreditPackage[]>(endpoints.credits.packages),
  createOrder: (packageId, method) => api.post<PaymentOrder>(endpoints.payments.orders, { packageId, method }),
  getOrder: (id) => api.get<PaymentOrder>(endpoints.payments.order(id)),
  // Só funciona com o gateway de desenvolvimento da API (pedidos com demo: true).
  simulateGateway: (id, outcome) => api.post<PaymentOrder>(`${endpoints.payments.order(id)}/simulate`, { outcome }),
}

function totals() {
  const d = db()
  const ok = d.transactions.filter((t) => t.status === 'confirmed')
  return {
    available: d.balance,
    reserved: 0,
    purchased: ok.filter((t) => t.type === 'purchase').reduce((s, t) => s + t.credits, 0),
    consumed: -ok.filter((t) => t.type === 'consumption').reduce((s, t) => s + t.credits, 0),
    demo: true,
  }
}

const mock: CreditsService = {
  async balance() {
    await delay(200)
    return totals()
  },
  async transactions({ type = 'all', page = 1, pageSize = 10 }) {
    await delay()
    const all = db()
      .transactions.filter((t) => type === 'all' || t.type === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize))
    const p = Math.min(page, totalPages)
    return { items: all.slice((p - 1) * pageSize, p * pageSize), total: all.length, page: p, pageSize, totalPages }
  },
  async packages() {
    await delay(200)
    return CREDIT_PACKAGES
  },
  async createOrder(packageId, method) {
    await delay(200)
    const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId)
    if (!pkg) throw new ApiError('not_found', 'Pacote não encontrado.', 404)
    const order: PaymentOrder = {
      id: uid('ord'),
      packageId,
      credits: pkg.credits,
      amountCents: pkg.priceCents,
      method,
      state: 'awaiting_payment',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      // Demo: sem gateway não existe QR Code nem link reais.
      pix: method === 'pix' ? { qrCodeImage: null, copyPaste: null } : undefined,
      checkoutUrl: null,
      boletoUrl: null,
      demo: true,
    }
    db().orders.push(order)
    save()
    return order
  },
  async getOrder(id) {
    await delay(200)
    const o = db().orders.find((x) => x.id === id)
    if (!o) throw new ApiError('not_found', 'Pedido não encontrado.', 404)
    return structuredClone(o)
  },
  async simulateGateway(id, outcome) {
    await delay(150)
    const d = db()
    const o = d.orders.find((x) => x.id === id)
    if (!o) throw new ApiError('not_found', 'Pedido não encontrado.', 404)
    if (o.state !== 'awaiting_payment' && o.state !== 'processing') return o
    o.state = outcome
    d.transactions.push({
      id: uid('tx'),
      createdAt: new Date().toISOString(),
      description: `Compra · ${CREDIT_PACKAGES.find((p) => p.id === o.packageId)?.name ?? ''} (demo)`,
      type: 'purchase',
      credits: o.credits,
      amountCents: o.amountCents,
      status: outcome === 'confirmed' ? 'confirmed' : 'failed',
      reference: o.id.toUpperCase(),
    })
    if (outcome === 'confirmed') d.balance += o.credits
    d.notifications.unshift({
      id: uid('n'),
      type: outcome === 'confirmed' ? 'purchase_confirmed' : 'payment_declined',
      title: outcome === 'confirmed' ? 'Compra confirmada (demo)' : outcome === 'expired' ? 'Pagamento expirado (demo)' : 'Pagamento recusado (demo)',
      body: `${o.credits} créditos · pedido ${o.id}`,
      createdAt: new Date().toISOString(),
      read: false,
      link: `/app/creditos/pagamento/${o.id}`,
      demo: true,
    })
    save()
    return structuredClone(o)
  },
}

export const creditsService: CreditsService = config.useMocks ? mock : http
