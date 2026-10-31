import { Inject, Injectable, Logger, Module } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.module'
import { NotificationsService } from '../notifications/notifications'

/**
 * Política de retenção (docs/retencao.md):
 *  - Arquivos vencidos são apagados do armazenamento; o registro do artefato
 *    fica com deletedAt (o histórico continua consultável).
 *  - Idempotente: rodar de novo não apaga nada duas vezes; falhas ficam para a
 *    próxima execução.
 *  - Avisa uma vez quando há arquivos a EXPIRY_WARNING_DAYS de vencer.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(now = new Date()) {
    const vencidos = await this.prisma.artifact.findMany({ where: { deletedAt: null, expiresAt: { lte: now } }, take: 500 })
    let ok = 0
    for (const a of vencidos) {
      try {
        await this.storage.remove(a.storageKey)
        await this.prisma.artifact.update({ where: { id: a.id }, data: { deletedAt: new Date() } })
        ok++
      } catch (e) {
        this.logger.warn(`retenção: falha ao apagar ${a.id}: ${(e as Error).message}`)
      }
    }
    if (vencidos.length) this.logger.log(`retenção: ${ok}/${vencidos.length} arquivo(s) apagados`)
    return ok
  }

  /** Diariamente: avisa sobre arquivos que vencem no dia que entra na janela de aviso. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async warnExpiring(now = new Date()) {
    const de = new Date(now.getTime() + (this.env.EXPIRY_WARNING_DAYS - 1) * 86_400_000)
    const ate = new Date(now.getTime() + this.env.EXPIRY_WARNING_DAYS * 86_400_000)
    const grupos = await this.prisma.artifact.groupBy({
      by: ['userId'],
      where: { deletedAt: null, kind: 'INVOICE_PDF', expiresAt: { gt: de, lte: ate } },
      _count: true,
    })
    for (const g of grupos) {
      await this.notifications.notify(
        g.userId,
        'FILES_EXPIRING',
        'Arquivos perto de expirar',
        `${g._count} PDF(s) serão apagados em ${this.env.EXPIRY_WARNING_DAYS} dias. Baixe o que precisar guardar.`,
        '/app/historico',
      )
    }
  }
}

@Module({ providers: [RetentionService] })
export class RetentionModule {}
