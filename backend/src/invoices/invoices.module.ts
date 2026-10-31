import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.module'
import { AllowApiKey, AppError, CurrentUser, pageArgs, paginated, type AuthUser } from '../common/http'
import { CodeDto, CreateInvoiceDto, ListInvoicesQuery, toInvoiceDto } from './invoices.dto'
import { InvoicesService } from './invoices.service'

const UI_WHERE: Record<string, Prisma.InvoiceRequestWhereInput> = {
  pending: { state: 'PENDING' },
  queued: { state: 'QUEUED' },
  processing: { state: 'RUNNING' },
  awaiting_code: { state: 'AWAITING_CODE' },
  success: { state: 'COMPLETED', status: 'SUCCESS' },
  warning: { state: 'COMPLETED', status: 'WARNING' },
  failed: { state: 'COMPLETED', status: 'ERROR', NOT: { observation: { startsWith: 'Busca cancelada' } } },
  cancelled: { state: 'COMPLETED', status: 'ERROR', observation: { startsWith: 'Busca cancelada' } },
}

@ApiTags('nova fatura')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @AllowApiKey()
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Evita buscas duplicadas em retries' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto, @Headers('idempotency-key') key?: string) {
    const inv = await this.invoices.start(user, dto, key?.slice(0, 100))
    return toInvoiceDto(inv)
  }

  @Get()
  @AllowApiKey()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListInvoicesQuery) {
    const { skip, take, page, pageSize } = pageArgs(q.page, q.pageSize)
    const search = q.search?.trim()
    const where: Prisma.InvoiceRequestWhereInput = {
      userId: user.id,
      ...(q.flow && q.flow !== 'all' ? { flow: q.flow.toUpperCase() as Prisma.InvoiceRequestWhereInput['flow'] } : {}),
      ...(q.status && q.status !== 'all' ? UI_WHERE[q.status] : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999`) } : {}) } }
        : {}),
      ...(search
        ? {
            OR: [
              { uc: { contains: search.replace(/\D/g, '') || search } },
              { artifacts: { some: { fileName: { contains: search, mode: 'insensitive' } } } },
              ...(/^[0-9a-f-]{8,36}$/i.test(search) ? [{ id: { startsWith: search.toLowerCase() } } as Prisma.InvoiceRequestWhereInput] : []),
            ],
          }
        : {}),
    }
    const orderBy: Prisma.InvoiceRequestOrderByWithRelationInput =
      q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'duration' ? { durationS: { sort: 'desc', nulls: 'last' } } : { createdAt: 'desc' }
    const [items, total] = await Promise.all([
      this.prisma.invoiceRequest.findMany({ where, orderBy, skip, take, include: { artifacts: true } }),
      this.prisma.invoiceRequest.count({ where }),
    ])
    return paginated(items.map(toInvoiceDto), total, page, pageSize)
  }

  @Get(':id')
  @AllowApiKey()
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.invoices.owned(user.id, id)
    const inv = await this.prisma.invoiceRequest.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } }, artifacts: { orderBy: { fileName: 'asc' } } },
    })
    return toInvoiceDto(inv)
  }

  @Get(':id/logs')
  logs(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.logs(user.id, id)
  }

  @Post(':id/code')
  @AllowApiKey()
  async code(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CodeDto) {
    return toInvoiceDto(await this.invoices.sendCode(user.id, id, dto))
  }

  @Post(':id/cancel')
  @AllowApiKey()
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toInvoiceDto(await this.invoices.cancel(user.id, id))
  }

  /** Link assinado de curta duração para baixar um PDF da fatura. */
  @Get(':id/files/:fileId/link')
  @AllowApiKey()
  async link(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    const art = await this.prisma.artifact.findFirst({ where: { id: fileId, invoiceId: id, userId: user.id } })
    if (!art) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Arquivo não encontrado.')
    if (art.deletedAt || art.expiresAt < new Date())
      throw new AppError(HttpStatus.GONE, 'FILE_EXPIRED', 'O arquivo expirou e foi removido pela política de retenção.')
    return this.storage.signedUrl(art.id)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.invoices.owned(user.id, id)
    if (inv.state !== 'COMPLETED') throw new AppError(HttpStatus.CONFLICT, 'IN_PROGRESS', 'Aguarde a busca terminar para excluir.')
    const arts = await this.prisma.artifact.findMany({ where: { invoiceId: id } })
    for (const a of arts) await this.storage.remove(a.storageKey)
    await this.prisma.invoiceRequest.delete({ where: { id } })
  }
}

@Module({ controllers: [InvoicesController], providers: [InvoicesService] })
export class InvoicesModule {}
