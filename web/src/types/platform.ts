/**
 * Contratos PROVISÓRIOS da plataforma (auth, créditos, pagamentos, API keys,
 * notificações). O backend NestJS ainda não existe — ajuste quando a
 * especificação OpenAPI estiver disponível. Ver docs em web/README.md.
 */

export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  avatarUrl: string | null
  createdAt: string
  lastLoginAt: string | null
}

export interface Session {
  user: User
  demo: boolean
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  password: string
  acceptTerms: boolean
}

export interface CreditBalance {
  available: number
  reserved: number
  purchased: number
  consumed: number
  demo: boolean
}

export type CreditTxType = 'purchase' | 'consumption' | 'reservation' | 'release' | 'refund' | 'adjustment'
export type CreditTxStatus = 'confirmed' | 'pending' | 'failed' | 'reversed'

export interface CreditTransaction {
  id: string
  createdAt: string
  description: string
  type: CreditTxType
  credits: number
  amountCents: number | null
  status: CreditTxStatus
  reference: string
}

export interface CreditPackage {
  id: string
  name: string
  credits: number
  priceCents: number
  benefits: string[]
  highlighted?: boolean
}

export type PaymentMethod = 'pix' | 'card' | 'boleto'
export type PaymentState = 'awaiting_payment' | 'processing' | 'confirmed' | 'declined' | 'expired' | 'refunded'

export interface PaymentOrder {
  id: string
  packageId: string
  credits: number
  amountCents: number
  method: PaymentMethod
  state: PaymentState
  createdAt: string
  expiresAt: string | null
  pix?: { qrCodeImage: string | null; copyPaste: string | null }
  checkoutUrl?: string | null
  boletoUrl?: string | null
  demo: boolean
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  status: 'active' | 'revoked'
  scopes: string[]
}

export interface CreatedApiKey {
  key: ApiKey
  /** Segredo completo: mostrado uma única vez. */
  secret: string
}

export type NotificationType =
  | 'extraction_completed'
  | 'extraction_failed'
  | 'credits_low'
  | 'purchase_confirmed'
  | 'payment_pending'
  | 'payment_declined'
  | 'files_expiring'
  | 'security'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  createdAt: string
  read: boolean
  link: string | null
  demo: boolean
}

export interface NotificationPreferences {
  emailExtraction: boolean
  emailCredits: boolean
  emailSecurity: boolean
  inAppExtraction: boolean
}

export interface AccountSettings {
  defaultOutput: 'json' | 'csv'
  notifications: NotificationPreferences
}
