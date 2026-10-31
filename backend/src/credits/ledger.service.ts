import { Injectable } from '@nestjs/common'
import { CreditTxType, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { insufficientCredits } from '../common/http'

type Tx = Prisma.TransactionClient

/**
 * Livro-razão de créditos.
 *
 * Invariante: CreditAccount.available + CreditAccount.reserved = soma dos
 * créditos das transações CONFIRMED do usuário.
 *
 * - O ledger (CreditTransaction) só recebe movimentos definitivos: compra,
 *   consumo, estorno e ajustes. Linhas nunca são editadas nem apagadas.
 * - Reservas ficam em CreditReservation e só movem créditos entre
 *   "disponível" e "reservado" na projeção.
 * - Toda escrita acontece numa transação; a checagem de saldo é um UPDATE
 *   condicional (available >= n), seguro contra concorrência.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAccount(userId: string, tx: Tx = this.prisma) {
    return tx.creditAccount.upsert({ where: { userId }, update: {}, create: { userId } })
  }

  async balance(userId: string) {
    return this.ensureAccount(userId)
  }

  /**
   * Crédito/débito definitivo. Idempotente pela `idempotencyKey`: a segunda
   * chamada com a mesma chave não faz nada e devolve a transação original.
   */
  async post(
    userId: string,
    entry: {
      type: CreditTxType
      credits: number
      description: string
      reference: string
      idempotencyKey: string
      amountCents?: number | null
      invoiceId?: string
      extractionId?: string
      paymentOrderId?: string
    },
    outer?: Tx,
  ) {
    const run = async (tx: Tx) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: entry.idempotencyKey } })
      if (existing) return { tx: existing, created: false }
      await this.ensureAccount(userId, tx)
      const created = await tx.creditTransaction.create({ data: { userId, ...entry } })
      await tx.creditAccount.update({
        where: { userId },
        data: {
          available: { increment: entry.credits },
          ...(entry.type === 'PURCHASE' ? { purchased: { increment: entry.credits } } : {}),
          ...(entry.type === 'CONSUMPTION' ? { consumed: { increment: -entry.credits } } : {}),
        },
      })
      return { tx: created, created: true }
    }
    if (outer) return run(outer)
    try {
      return await this.prisma.$transaction(run)
    } catch (e) {
      // Corrida entre duas chamadas com a mesma chave: a perdedora devolve a existente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.creditTransaction.findUniqueOrThrow({ where: { idempotencyKey: entry.idempotencyKey } })
        return { tx: existing, created: false }
      }
      throw e
    }
  }

  /** Reserva créditos para uma operação. Lança 402 se o saldo não cobre. */
  async reserve(userId: string, credits: number, target: { invoiceId?: string; extractionId?: string }, outer?: Tx) {
    const run = async (tx: Tx) => {
      await this.ensureAccount(userId, tx)
      const moved = await tx.creditAccount.updateMany({
        where: { userId, available: { gte: credits } },
        data: { available: { decrement: credits }, reserved: { increment: credits } },
      })
      if (moved.count === 0) {
        const acc = await tx.creditAccount.findUniqueOrThrow({ where: { userId } })
        throw insufficientCredits(credits, acc.available)
      }
      return tx.creditReservation.create({ data: { userId, credits, ...target } })
    }
    return outer ? run(outer) : this.prisma.$transaction(run)
  }

  /**
   * Liquida a reserva cobrando `charged` (≤ reservado) e devolve o resto.
   * Só a primeira chamada tem efeito (troca de status condicional).
   */
  async settle(reservationId: string, charged: number, meta: { description: string; reference: string; invoiceId?: string; extractionId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.creditReservation.findUniqueOrThrow({ where: { id: reservationId } })
      const cobrado = Math.max(0, Math.min(charged, r.credits))
      const claimed = await tx.creditReservation.updateMany({
        where: { id: reservationId, status: 'ACTIVE' },
        data: { status: cobrado > 0 ? 'CONSUMED' : 'RELEASED', settledAt: new Date() },
      })
      if (claimed.count === 0) return { charged: 0, alreadySettled: true }

      // Reserva volta inteira para o disponível; o consumo sai pelo ledger.
      await tx.creditAccount.update({
        where: { userId: r.userId },
        data: { reserved: { decrement: r.credits }, available: { increment: r.credits } },
      })
      if (cobrado > 0) {
        await this.post(
          r.userId,
          {
            type: 'CONSUMPTION',
            credits: -cobrado,
            description: meta.description,
            reference: meta.reference,
            idempotencyKey: `consume:${reservationId}`,
            invoiceId: meta.invoiceId,
            extractionId: meta.extractionId,
          },
          tx,
        )
      }
      return { charged: cobrado, alreadySettled: false }
    })
  }

  /** Devolve a reserva sem cobrar (operação falhou ou não começou). */
  release(reservationId: string) {
    return this.settle(reservationId, 0, { description: '', reference: '' })
  }

  async reservationFor(target: { invoiceId?: string; extractionId?: string }) {
    if (target.invoiceId) return this.prisma.creditReservation.findUnique({ where: { invoiceId: target.invoiceId } })
    if (target.extractionId) return this.prisma.creditReservation.findUnique({ where: { extractionId: target.extractionId } })
    return null
  }
}
