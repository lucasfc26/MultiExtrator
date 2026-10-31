import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger'
import { IsIn, IsString } from 'class-validator'
import { Prisma, type PaymentOrder, type PaymentState } from '@prisma/client'
import type { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../credits/ledger.service'
import { NotificationsService } from '../notifications/notifications'
import { AuditService } from '../audit/audit.service'
import { AppError, CurrentUser, Public, type AuthUser } from '../common/http'
import { FakeGateway, PAYMENT_GATEWAY, type GatewayEvent, type PaymentGateway } from './gateway'

class CreateOrderDto {
  @IsString() packageId: string
  @IsIn(['pix', 'card', 'boleto']) method: 'pix' | 'card' | 'boleto'
}

class SimulateDto {
  @IsIn(['confirmed', 'declined', 'expired', 'refunded']) outcome: 'confirmed' | 'declined' | 'expired' | 'refunded'
}

const TRANSITION: Record<GatewayEvent['type'], PaymentState> = {
  'payment.processing': 'PROCESSING',
  'payment.confirmed': 'CONFIRMED',
  'payment.declined': 'DECLINED',
  'payment.expired': 'EXPIRED',
  'payment.refunded': 'REFUNDED',
}

function toOrderDto(o: PaymentOrder, sandbox: boolean) {
  return {
    id: o.id,
    packageId: o.packageId,
    credits: o.credits,
    amountCents: o.amountCents,
    method: o.method.toLowerCase(),
    state: o.state.toLowerCase(),
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt?.toISOString() ?? null,
    pix: o.method === 'PIX' ? { qrCodeImage: o.pixQrImage, copyPaste: o.pixCopyPaste } : undefined,
    checkoutUrl: o.checkoutUrl,
    boletoUrl: o.boletoUrl,
    demo: sandbox,
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
  ) {}

  /**
   * Processa um webhook: grava o evento (único por provedor+id), aplica a
   * transição de estado e credita/estorna pelo ledger com chave idempotente.
   * Eventos repetidos devolvem 200 sem efeito.
   */
  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    let event: GatewayEvent
    try {
      event = this.gateway.parseWebhook(rawBody, headers)
    } catch (e) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_WEBHOOK', `Webhook recusado: ${(e as Error).message}.`)
    }

    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: this.gateway.name, eventId: event.eventId, type: event.type, payload: event as unknown as Prisma.InputJsonValue },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { duplicate: true }
      throw e
    }

    try {
      await this.apply(event)
      await this.prisma.paymentWebhookEvent.update({
        where: { provider_eventId: { provider: this.gateway.name, eventId: event.eventId } },
        data: { processedAt: new Date() },
      })
    } catch (e) {
      await this.prisma.paymentWebhookEvent.update({
        where: { provider_eventId: { provider: this.gateway.name, eventId: event.eventId } },
        data: { error: (e as Error).message.slice(0, 500) },
      })
      throw e
    }
    return { duplicate: false }
  }

  private async apply(event: GatewayEvent) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { provider_providerRef: { provider: this.gateway.name, providerRef: event.providerRef } },
    })
    if (!order) throw new Error(`pedido não encontrado para ${event.providerRef}`)
    const next = TRANSITION[event.type]

    // Estados finais não regridem (exceto CONFIRMED → REFUNDED).
    const finais: PaymentState[] = ['CONFIRMED', 'DECLINED', 'EXPIRED', 'REFUNDED']
    if (finais.includes(order.state) && !(order.state === 'CONFIRMED' && next === 'REFUNDED')) return

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { state: next, ...(next === 'CONFIRMED' ? { confirmedAt: new Date() } : {}) },
      })
      if (next === 'CONFIRMED') {
        await this.ledger.post(
          order.userId,
          {
            type: 'PURCHASE',
            credits: order.credits,
            amountCents: order.amountCents,
            description: `Compra · ${order.credits.toLocaleString('pt-BR')} créditos`,
            reference: order.id.slice(0, 8).toUpperCase(),
            idempotencyKey: `payment:${order.id}`,
            paymentOrderId: order.id,
          },
          tx,
        )
      }
      if (next === 'REFUNDED') {
        await this.ledger.post(
          order.userId,
          {
            type: 'REFUND',
            credits: -order.credits,
            amountCents: -order.amountCents,
            description: 'Estorno de compra',
            reference: order.id.slice(0, 8).toUpperCase(),
            idempotencyKey: `refund:${order.id}`,
            paymentOrderId: order.id,
          },
          tx,
        )
      }
    })

    const link = `/app/creditos/pagamento/${order.id}`
    if (next === 'CONFIRMED')
      await this.notifications.notify(order.userId, 'PURCHASE_CONFIRMED', 'Compra confirmada', `${order.credits} créditos adicionados ao saldo.`, link)
    if (next === 'DECLINED')
      await this.notifications.notify(order.userId, 'PAYMENT_DECLINED', 'Pagamento recusado', 'O pagamento foi recusado. Tente outro meio de pagamento.', link)
    await this.audit.log(`payment.${next.toLowerCase()}`, { userId: order.userId, entity: 'PaymentOrder', entityId: order.id })
  }

  /** Cobranças vencidas sem pagamento viram EXPIRED. */
  @Interval(60_000)
  async expireOld() {
    const r = await this.prisma.paymentOrder.updateMany({
      where: { state: 'AWAITING_PAYMENT', expiresAt: { lt: new Date() } },
      data: { state: 'EXPIRED' },
    })
    if (r.count) this.logger.log(`${r.count} cobrança(s) expirada(s)`)
  }
}

@ApiTags('pagamentos')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('orders')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    const pkg = await this.prisma.creditPackage.findFirst({ where: { id: dto.packageId, active: true } })
    if (!pkg) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Pacote não encontrado.')
    const method = dto.method.toUpperCase() as 'PIX' | 'CARD' | 'BOLETO'
    const order = await this.prisma.paymentOrder.create({
      data: { userId: user.id, packageId: pkg.id, credits: pkg.credits, amountCents: pkg.priceCents, method, provider: this.payments.gateway.name },
    })
    const charge = await this.payments.gateway.createCharge({
      orderId: order.id,
      amountCents: pkg.priceCents,
      method,
      description: `Fatturas · ${pkg.name} (${pkg.credits} créditos)`,
      payerEmail: user.email,
    })
    const saved = await this.prisma.paymentOrder.update({ where: { id: order.id }, data: { ...charge } })
    await this.notifications.notify(user.id, 'PAYMENT_PENDING', 'Pagamento pendente', `Pedido de ${pkg.credits} créditos aguardando pagamento.`, `/app/creditos/pagamento/${order.id}`)
    return toOrderDto(saved, this.payments.gateway.sandbox)
  }

  @Get('orders/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.paymentOrder.findFirst({ where: { id, userId: user.id } })
    if (!o) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Pedido não encontrado.')
    return toOrderDto(o, this.payments.gateway.sandbox)
  }

  /** Webhook do provedor. Corpo cru (a assinatura é calculada sobre os bytes recebidos). */
  @Public()
  @ApiExcludeEndpoint()
  @Post('webhooks/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (provider !== this.payments.gateway.name) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Provedor desconhecido.')
    return this.payments.handleWebhook(req.rawBody ?? Buffer.from(JSON.stringify(req.body)), req.headers)
  }

  /** SOMENTE no gateway de desenvolvimento: simula o retorno do provedor com um webhook assinado. */
  @Post('orders/:id/simulate')
  @HttpCode(200)
  async simulate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateDto) {
    const gw = this.payments.gateway
    if (!(gw instanceof FakeGateway)) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Simulação indisponível.')
    const o = await this.prisma.paymentOrder.findFirst({ where: { id, userId: user.id } })
    if (!o?.providerRef) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Pedido não encontrado.')
    const { raw, headers } = gw.buildEvent(o.providerRef, `payment.${dto.outcome}` as GatewayEvent['type'])
    await this.payments.handleWebhook(raw, headers)
    return toOrderDto(await this.prisma.paymentOrder.findUniqueOrThrow({ where: { id } }), gw.sandbox)
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, FakeGateway, { provide: PAYMENT_GATEWAY, useExisting: FakeGateway }],
})
export class PaymentsModule {}
