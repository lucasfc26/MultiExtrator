import { Inject, Injectable } from '@nestjs/common'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PaymentMethod } from '@prisma/client'
import { ENV, type Env } from '../config/env'

/** Resultado da criação de uma cobrança no provedor. */
export interface Charge {
  providerRef: string
  pixCopyPaste?: string | null
  pixQrImage?: string | null
  checkoutUrl?: string | null
  boletoUrl?: string | null
  expiresAt: Date
}

/** Evento normalizado vindo do webhook do provedor. */
export interface GatewayEvent {
  eventId: string
  type: 'payment.confirmed' | 'payment.declined' | 'payment.expired' | 'payment.refunded' | 'payment.processing'
  providerRef: string
}

/**
 * Contrato de um gateway de pagamento. Um provedor real (ex.: Mercado Pago,
 * Pagar.me, Stripe) implementa esta interface usando o checkout hospedado ou os
 * componentes tokenizados dele — a API nunca recebe dados de cartão.
 */
export interface PaymentGateway {
  readonly name: string
  /** true = provedor de desenvolvimento (a interface mostra o aviso "demo"). */
  readonly sandbox: boolean
  createCharge(input: { orderId: string; amountCents: number; method: PaymentMethod; description: string; payerEmail: string }): Promise<Charge>
  /** Valida a assinatura e normaliza o corpo do webhook. Lança se inválido. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')

/**
 * Gateway FALSO para desenvolvimento. Não cobra nada: gera referências e um
 * "copia e cola" visivelmente fictício. O retorno é simulado por
 * POST /payments/orders/:id/simulate, que envia um webhook ASSINADO pelo mesmo
 * caminho de um provedor real.
 */
@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake'
  readonly sandbox = true

  constructor(@Inject(ENV) private readonly env: Env) {}

  async createCharge(input: { orderId: string; amountCents: number; method: PaymentMethod }): Promise<Charge> {
    const providerRef = `fake_${randomUUID()}`
    const expiresAt = new Date(Date.now() + this.env.PAYMENT_EXPIRES_MIN * 60_000)
    return {
      providerRef,
      expiresAt,
      pixCopyPaste: input.method === 'PIX' ? `FATTURAS-DEV-PIX-${input.orderId.slice(0, 8).toUpperCase()}-NAO-PAGAR` : null,
      pixQrImage: null,
      checkoutUrl: null,
      boletoUrl: null,
    }
  }

  sign(rawBody: string) {
    return createHmac('sha256', this.env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex')
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent {
    const sig = String(headers['x-fatturas-signature'] ?? '')
    const expected = this.sign(rawBody.toString('utf8'))
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('assinatura inválida')
    const body = JSON.parse(rawBody.toString('utf8')) as GatewayEvent
    if (!body.eventId || !body.providerRef || !body.type) throw new Error('evento incompleto')
    return body
  }

  /** Monta um webhook assinado (usado pela simulação em dev). */
  buildEvent(providerRef: string, type: GatewayEvent['type']) {
    const raw = JSON.stringify({ eventId: `evt_${randomUUID()}`, type, providerRef } satisfies GatewayEvent)
    return { raw: Buffer.from(raw), headers: { 'x-fatturas-signature': this.sign(raw) } }
  }
}
