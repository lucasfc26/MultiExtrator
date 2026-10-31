import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { Prisma, type InvoiceFlow, type InvoiceRequest, type InvoiceState, type InvoiceStatus } from '@prisma/client'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../credits/ledger.service'
import { BillingService } from '../credits/billing.service'
import { StorageService } from '../storage/storage.module'
import { NotificationsService } from '../notifications/notifications'
import { AppError, type AuthUser } from '../common/http'
import { WorkerClient, WorkerError, asHttp, type WorkerFluxo, type WorkerResposta } from '../engine/worker.client'
import type { CreateInvoiceDto } from './invoices.dto'

const STATE: Record<WorkerResposta['estado'], InvoiceState> = {
  na_fila: 'QUEUED',
  executando: 'RUNNING',
  aguardando_codigo: 'AWAITING_CODE',
  concluido: 'COMPLETED',
}
const STATUS: Record<WorkerResposta['status'], InvoiceStatus> = {
  processando: 'PROCESSING',
  aguardando_codigo: 'AWAITING_CODE',
  sucesso: 'SUCCESS',
  atencao: 'WARNING',
  erro: 'ERROR',
}
const FLOW_LABEL: Record<InvoiceFlow, string> = { SITE_ENEL: 'Enel', CORPORATIVO: 'Corporativo', SEGUNDA_VIA: '2 VIA' }

function normRef(v: string): string {
  const t = v.trim()
  let m = /^(\d{4})-(\d{1,2})$/.exec(t)
  if (m) return `${m[2].padStart(2, '0')}/${m[1]}`
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t) ?? /^(\d{2})(\d{4})$/.exec(t)
  return m ? `${m[1].padStart(2, '0')}/${m[2]}` : t
}

function maskDoc(d: string) {
  return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : `**.${d.slice(2, 5)}.***/${d.slice(8, 12)}-**`
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name)
  private polling = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
    private readonly worker: WorkerClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private event(invoiceId: string, state: string, message: string, status?: InvoiceStatus) {
    return this.prisma.invoiceEvent.create({ data: { invoiceId, state, message, status } })
  }

  /** Inicia a busca: reserva créditos, registra e entrega ao motor. */
  async start(user: AuthUser, dto: CreateInvoiceDto, idempotencyKey?: string) {
    if (idempotencyKey) {
      const prev = await this.prisma.invoiceRequest.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } } })
      if (prev) return prev
    }
    const flow = dto.flow.toUpperCase() as InvoiceFlow
    const referencias = Array.from(new Set([dto.referencia, ...(dto.referencias ?? [])].filter((r): r is string => !!r).map(normRef)))
    const uc = dto.uc?.replace(/\D/g, '') || null
    const reserva = this.billing.invoiceReservation(flow, referencias.length)

    const inputSummary: Record<string, string> = {}
    if (dto.usuario) inputSummary.usuario = dto.usuario
    if (uc) inputSummary.uc = uc
    if (flow === 'SITE_ENEL') inputSummary.tipo_conta = dto.tipo_conta ?? 'empresa'
    if (dto.cpf_cnpj) inputSummary.cpf_cnpj = maskDoc(dto.cpf_cnpj)
    if (dto.email_segunda_via) inputSummary.email_segunda_via = dto.email_segunda_via
    if (flow === 'SEGUNDA_VIA') inputSummary.canal = dto.canal ?? 'email'

    let invoice: InvoiceRequest
    try {
      invoice = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invoiceRequest.create({
          data: {
            userId: user.id,
            flow,
            uc,
            referencias,
            inputSummary,
            creditsReserved: reserva,
            source: user.via === 'api_key' ? 'API' : 'WEB',
            apiKeyId: user.apiKeyId,
            idempotencyKey,
            observation: 'Enviando pedido ao motor…',
          },
        })
        await this.ledger.reserve(user.id, reserva, { invoiceId: inv.id }, tx)
        return inv
      })
    } catch (e) {
      // Duas requisições simultâneas com a mesma Idempotency-Key.
      if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return this.prisma.invoiceRequest.findUniqueOrThrow({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } } })
      throw e
    }
    await this.event(invoice.id, 'enviado', `Pedido enviado ao motor · ${reserva} créditos reservados.`)

    // A senha só existe nesta chamada: vai direto ao worker e não é gravada.
    const entrada: Record<string, unknown> = {
      usuario: dto.usuario,
      senha: dto.senha,
      uc: uc ?? undefined,
      referencias: referencias.length ? referencias : undefined,
      tipo_conta: dto.tipo_conta,
      cpf_cnpj: dto.cpf_cnpj,
      email_segunda_via: dto.email_segunda_via,
      canal: dto.canal,
    }
    try {
      const r = await this.worker.start(dto.flow as WorkerFluxo, entrada)
      return this.apply(invoice.id, r)
    } catch (e) {
      const msg = e instanceof WorkerError ? e.message : 'Falha ao iniciar a busca.'
      await this.fail(invoice.id, msg)
      asHttp(e)
    }
  }

  /** Aplica uma resposta do motor ao registro (com linha do tempo). */
  private async apply(id: string, r: WorkerResposta) {
    const atual = await this.prisma.invoiceRequest.findUniqueOrThrow({ where: { id } })
    const state = STATE[r.estado]
    const status = STATUS[r.status]
    if (state === 'COMPLETED') return this.finalize(atual, r.job_id)
    const mudou = atual.state !== state || atual.status !== status || atual.observation !== r.observacao
    const updated = await this.prisma.invoiceRequest.update({
      where: { id },
      data: {
        engineJobId: r.job_id,
        state,
        status,
        observation: r.observacao,
        codeExpiresAt: state === 'AWAITING_CODE' && r.expira_em_s != null ? new Date(Date.now() + r.expira_em_s * 1000) : null,
      },
    })
    if (mudou) await this.event(id, r.estado, r.observacao, status)
    return updated
  }

  /**
   * Conclusão: baixa os PDFs, guarda com prazo de retenção, cobra pelo que foi
   * entregue e libera o resto da reserva. Protegido por advisory lock: só um
   * processo finaliza cada busca.
   */
  private async finalize(inv: InvoiceRequest, jobId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${inv.id})) AS locked`
        if (!locked) return { invoice: inv, finalizedNow: false }
        const fresh = await tx.invoiceRequest.findUniqueOrThrow({ where: { id: inv.id } })
        if (fresh.state === 'COMPLETED') return { invoice: fresh, finalizedNow: false }

        const full = await this.worker.status(jobId, { pdf: true })
        const expiresAt = new Date(Date.now() + this.env.RETENTION_DAYS * 86_400_000)
        const arquivos = full.arquivos ?? []
        for (const a of arquivos) {
          if (!a.pdf_base64) continue
          const data = Buffer.from(a.pdf_base64, 'base64')
          const storageKey = this.storage.newKey(`invoices/${inv.userId}`, '.pdf')
          await this.storage.put(storageKey, data)
          await tx.artifact.create({
            data: {
              userId: inv.userId,
              invoiceId: inv.id,
              kind: 'INVOICE_PDF',
              fileName: a.nome,
              mimeType: 'application/pdf',
              sizeBytes: data.length,
              storageKey,
              referencia: a.referencia,
              expiresAt,
            },
          })
        }
        const status = STATUS[full.status]
        const cobravel = status === 'SUCCESS' || status === 'WARNING'
        const charge = cobravel ? this.billing.invoiceCharge(inv.flow, arquivos.map((a) => a.nome)) : 0
        const updated = await tx.invoiceRequest.update({
          where: { id: inv.id },
          data: {
            state: 'COMPLETED',
            status,
            observation: full.observacao,
            durationS: full.duracao_s ?? null,
            codeExpiresAt: null,
            creditsCharged: Math.min(charge, inv.creditsReserved),
            completedAt: new Date(),
          },
        })
        await tx.invoiceEvent.create({ data: { invoiceId: inv.id, state: 'concluido', status, message: full.observacao } })
        return { invoice: updated, finalizedNow: true }
      },
      { timeout: 180_000 },
    ).then(async ({ invoice: done, finalizedNow }) => {
      if (!finalizedNow) return done
      const r = await this.ledger.reservationFor({ invoiceId: inv.id })
      if (r)
        await this.ledger.settle(r.id, done.creditsCharged ?? 0, {
          description: `Nova fatura · ${FLOW_LABEL[inv.flow]}${inv.uc ? ` · UC ${inv.uc}` : ''}`,
          reference: inv.id.slice(0, 8).toUpperCase(),
          invoiceId: inv.id,
        })
      await this.afterDone(done)
      return done
    })
  }

  private async afterDone(inv: InvoiceRequest) {
    const ok = inv.status === 'SUCCESS' || inv.status === 'WARNING'
    await this.notifications.notify(
      inv.userId,
      ok ? 'EXTRACTION_COMPLETED' : 'EXTRACTION_FAILED',
      ok ? `Fatura obtida · ${FLOW_LABEL[inv.flow]}` : `Busca com falha · ${FLOW_LABEL[inv.flow]}`,
      inv.observation,
      `/app/historico/${inv.id}`,
    )
    const acc = await this.ledger.balance(inv.userId)
    if (acc.available < this.env.LOW_CREDITS_THRESHOLD)
      await this.notifications.notify(inv.userId, 'CREDITS_LOW', 'Saldo baixo', `Restam ${acc.available} créditos.`, '/app/creditos')
  }

  /** Erro antes/fora do motor: encerra e devolve toda a reserva. */
  private async fail(id: string, message: string) {
    const inv = await this.prisma.invoiceRequest.update({
      where: { id },
      data: { state: 'COMPLETED', status: 'ERROR', observation: message, completedAt: new Date(), creditsCharged: 0, codeExpiresAt: null },
    })
    await this.event(id, 'erro', message, 'ERROR')
    const r = await this.ledger.reservationFor({ invoiceId: id })
    if (r) await this.ledger.release(r.id)
    await this.afterDone(inv)
  }

  async owned(userId: string, id: string) {
    const inv = await this.prisma.invoiceRequest.findFirst({ where: { id, userId } })
    if (!inv) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Fatura não encontrada.')
    return inv
  }

  async sendCode(userId: string, id: string, body: { codigo?: string; reenviar?: boolean }) {
    const inv = await this.owned(userId, id)
    if (inv.state !== 'AWAITING_CODE' || !inv.engineJobId)
      throw new AppError(HttpStatus.CONFLICT, 'NOT_AWAITING_CODE', 'Esta busca não está aguardando código.')
    const codigo = (body.codigo ?? '').replace(/\s/g, '')
    if (!codigo && !body.reenviar) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'CODE_REQUIRED', 'Informe o código (ou peça o reenvio).')
    await this.event(id, 'enviado', body.reenviar ? 'Pedido de reenvio do código.' : 'Código de segurança enviado.')
    try {
      return await this.apply(id, await this.worker.sendCode(inv.engineJobId, body.reenviar ? { reenviar: true } : { codigo }))
    } catch (e) {
      asHttp(e)
    }
  }

  async cancel(userId: string, id: string) {
    const inv = await this.owned(userId, id)
    if (inv.state === 'COMPLETED') return inv
    if (!inv.engineJobId) {
      await this.fail(id, 'Busca cancelada.')
      return this.prisma.invoiceRequest.findUniqueOrThrow({ where: { id } })
    }
    try {
      return await this.apply(id, await this.worker.cancel(inv.engineJobId))
    } catch (e) {
      asHttp(e)
    }
  }

  async logs(userId: string, id: string) {
    const inv = await this.owned(userId, id)
    if (!inv.engineJobId || inv.state === 'COMPLETED') return []
    try {
      return (await this.worker.status(inv.engineJobId, { logs: true })).logs ?? []
    } catch {
      return []
    }
  }

  /** Acompanha as buscas em andamento consultando o motor. */
  @Interval('invoices-poll', 3000)
  async poll() {
    if (this.polling) return
    this.polling = true
    try {
      const ativas = await this.prisma.invoiceRequest.findMany({
        where: { state: { in: ['QUEUED', 'RUNNING', 'AWAITING_CODE'] }, engineJobId: { not: null } },
        take: 50,
      })
      for (const inv of ativas) {
        try {
          await this.apply(inv.id, await this.worker.status(inv.engineJobId!))
        } catch (e) {
          if (e instanceof WorkerError && e.status === 404)
            await this.fail(inv.id, 'O motor não conhece mais esta busca (foi reiniciado ou o resultado expirou).')
          else this.logger.warn(`poll ${inv.id}: ${(e as Error).message}`)
        }
      }
    } finally {
      this.polling = false
    }
  }
}
