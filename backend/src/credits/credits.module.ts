import { Controller, Get, Global, Module, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CreditTxType, type CreditTransaction } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { PrismaService } from '../prisma/prisma.service'
import { AllowApiKey, CurrentUser, Public, pageArgs, paginated, type AuthUser } from '../common/http'
import { LedgerService } from './ledger.service'
import { BillingService } from './billing.service'

const TYPES = Object.values(CreditTxType).map((t) => t.toLowerCase())

class TxQuery {
  @IsOptional() @IsIn([...TYPES, 'all']) type?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

export function toTxDto(t: CreditTransaction) {
  return {
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    description: t.description,
    type: t.type.toLowerCase(),
    credits: t.credits,
    amountCents: t.amountCents,
    status: t.status.toLowerCase(),
    reference: t.reference,
  }
}

@ApiTags('créditos')
@Controller('credits')
export class CreditsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly billing: BillingService,
  ) {}

  @Get('balance')
  @AllowApiKey()
  async balance(@CurrentUser() user: AuthUser) {
    const a = await this.ledger.balance(user.id)
    return { available: a.available, reserved: a.reserved, purchased: a.purchased, consumed: a.consumed }
  }

  @Get('transactions')
  @AllowApiKey()
  async transactions(@CurrentUser() user: AuthUser, @Query() q: TxQuery) {
    const { skip, take, page, pageSize } = pageArgs(q.page, q.pageSize)
    const where = { userId: user.id, ...(q.type && q.type !== 'all' ? { type: q.type.toUpperCase() as CreditTxType } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.creditTransaction.count({ where }),
    ])
    return paginated(items.map(toTxDto), total, page, pageSize)
  }

  @Get('packages')
  @Public()
  async packages() {
    const pkgs = await this.prisma.creditPackage.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } })
    return pkgs.map(({ id, name, credits, priceCents, benefits, highlighted }) => ({ id, name, credits, priceCents, benefits, highlighted }))
  }

  @Get('pricing')
  @Public()
  pricing() {
    return this.billing.table()
  }
}

@Global()
@Module({ controllers: [CreditsController], providers: [LedgerService, BillingService], exports: [LedgerService, BillingService] })
export class CreditsModule {}
