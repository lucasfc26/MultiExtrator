export { CREDIT_PACKAGES as DEMO_PACKAGES } from '@/config/pricing'
import type {
  AccountSettings,
  ApiKey,
  AppNotification,
  CreditTransaction,
  PaymentOrder,
  User,
} from '@/types/platform'

/**
 * Dados DEMONSTRATIVOS da plataforma (VITE_USE_MOCKS=true). Nada aqui vem de
 * um backend: a interface sinaliza "demo" sempre que estes dados aparecem.
 * Persistidos em localStorage só para sobreviver ao recarregar a página.
 */

export interface DemoDb {
  users: (User & { password: string })[]
  sessionUserId: string | null
  balance: number
  transactions: CreditTransaction[]
  orders: PaymentOrder[]
  apiKeys: ApiKey[]
  notifications: AppNotification[]
  settings: AccountSettings
}

const KEY = 'me-demo-db'
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function seed(): DemoDb {
  return {
    users: [],
    sessionUserId: null,
    balance: 225,
    transactions: [
      { id: 'tx-1', createdAt: dias(20), description: 'Compra · pacote Inicial (demo)', type: 'purchase', credits: 400, amountCents: 4900, status: 'confirmed', reference: 'DEMO-PAY-0001' },
      { id: 'tx-2', createdAt: dias(12), description: 'Consumo de extrações (demo)', type: 'consumption', credits: -95, amountCents: null, status: 'confirmed', reference: 'DEMO-USE-0000' },
      { id: 'tx-3', createdAt: dias(9), description: 'Consumo de extrações (demo)', type: 'consumption', credits: -48, amountCents: null, status: 'confirmed', reference: 'DEMO-USE-0001' },
      { id: 'tx-4', createdAt: dias(4), description: 'Consumo de extrações (demo)', type: 'consumption', credits: -32, amountCents: null, status: 'confirmed', reference: 'DEMO-USE-0002' },
      { id: 'tx-5', createdAt: dias(2), description: 'Compra · pacote Profissional (demo)', type: 'purchase', credits: 6000, amountCents: 59900, status: 'failed', reference: 'DEMO-PAY-0003' },
    ],
    orders: [],
    apiKeys: [
      { id: 'key-1', name: 'ERP produção (demo)', prefix: 'me_live_7Hq2', createdAt: dias(30), lastUsedAt: dias(1), status: 'active', scopes: ['extractions:write', 'extractions:read'] },
      { id: 'key-2', name: 'Teste antigo (demo)', prefix: 'me_live_x91K', createdAt: dias(60), lastUsedAt: dias(45), status: 'revoked', scopes: ['extractions:read'] },
    ],
    notifications: [
      { id: 'n-1', type: 'credits_low', title: 'Saldo baixo (demo)', body: 'Seu saldo demonstrativo está abaixo de 250 créditos.', createdAt: dias(1), read: false, link: '/app/creditos', demo: true },
      { id: 'n-2', type: 'payment_declined', title: 'Pagamento recusado (demo)', body: 'O pagamento DEMO-PAY-0003 foi recusado pela operadora.', createdAt: dias(2), read: false, link: '/app/creditos', demo: true },
      { id: 'n-3', type: 'security', title: 'Nova API key criada (demo)', body: 'A chave "ERP produção (demo)" foi criada.', createdAt: dias(30), read: true, link: '/app/api', demo: true },
    ],
    settings: {
      defaultOutput: 'json',
      notifications: { emailExtraction: true, emailCredits: true, emailSecurity: true, inAppExtraction: true },
    },
  }
}

let cache: DemoDb | null = null

export function db(): DemoDb {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? { ...seed(), ...(JSON.parse(raw) as DemoDb) } : seed()
  } catch {
    cache = seed()
  }
  return cache
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db()))
  } catch {
    /* quota/privado: segue em memória */
  }
}

export function resetDemoDb() {
  cache = seed()
  save()
}

/** Latência artificial para os estados de carregamento aparecerem. */
export const delay = (ms = 90): Promise<void> =>
  new Promise((r) => setTimeout(r, import.meta.env.MODE === 'test' ? 0 : ms))

export const uid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`
