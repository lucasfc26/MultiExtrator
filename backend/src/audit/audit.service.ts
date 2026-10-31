import { Global, Injectable, Logger, Module } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** Auditoria de operações sensíveis. Nunca registra senhas, tokens nem conteúdo de faturas. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)
  constructor(private readonly prisma: PrismaService) {}

  async log(action: string, opts: { userId?: string; entity?: string; entityId?: string; meta?: Prisma.InputJsonValue; ip?: string } = {}) {
    try {
      await this.prisma.auditLog.create({ data: { action, ...opts } })
    } catch (e) {
      this.logger.warn(`Falha ao auditar ${action}: ${(e as Error).message}`)
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
