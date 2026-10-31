import {
  Controller,
  Delete,
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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Interval } from '@nestjs/schedule'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { memoryStorage } from 'multer'
import type { Extraction, Prisma } from '@prisma/client'
import { ENV, loadEnv, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../credits/ledger.service'
import { BillingService } from '../credits/billing.service'
import { StorageService } from '../storage/storage.module'
import { NotificationsService } from '../notifications/notifications'
import { AllowApiKey, AppError, CurrentUser, pageArgs, paginated, type AuthUser } from '../common/http'
import { CONVERTER, ConversionError, NotConfiguredConverter, type ConverterAdapter } from './converter'

/** Tipo real pelo conteúdo (assinatura), não pela extensão nem pelo Content-Type enviado. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' }
  return null
}

function toStatusDto(e: Extraction) {
  return { id: e.id, status: e.status.toLowerCase(), error: e.error, duration_s: e.durationS }
}

function toExtractionDto(e: Extraction) {
  return {
    ...toStatusDto(e),
    fileName: e.fileName,
    mimeType: e.mimeType,
    sizeBytes: e.sizeBytes,
    creditsReserved: e.creditsReserved,
    creditsCharged: e.creditsCharged,
    source: e.source.toLowerCase(),
    createdAt: e.createdAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
  }
}

class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

@Injectable()
export class ExtractionsService {
  private readonly logger = new Logger(ExtractionsService.name)
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Inject(CONVERTER) private readonly converter: ConverterAdapter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Cada arquivo é uma extração independente (com reserva própria). */
  async create(user: AuthUser, file: Express.Multer.File) {
    const kind = sniff(file.buffer)
    if (!kind) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_FILE', 'Formato não aceito. Envie PDF, PNG ou JPG.')
    const reserva = this.billing.extractionReservation()
    const fileName = file.originalname.replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 200) || `fatura${kind.ext}`
    const storageKey = this.storage.newKey(`uploads/${user.id}`, kind.ext)
    await this.storage.put(storageKey, file.buffer)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const e = await tx.extraction.create({
          data: {
            userId: user.id,
            fileName,
            mimeType: kind.mime,
            sizeBytes: file.size,
            creditsReserved: reserva,
            source: user.via === 'api_key' ? 'API' : 'WEB',
            apiKeyId: user.apiKeyId,
          },
        })
        await tx.artifact.create({
          data: {
            userId: user.id,
            extractionId: e.id,
            kind: 'ORIGINAL_UPLOAD',
            fileName,
            mimeType: kind.mime,
            sizeBytes: file.size,
            storageKey,
            expiresAt: new Date(Date.now() + this.env.RETENTION_DAYS * 86_400_000),
          },
        })
        await this.ledger.reserve(user.id, reserva, { extractionId: e.id }, tx)
        return e
      })
    } catch (e) {
      await this.storage.remove(storageKey)
      throw e
    }
  }

  async owned(userId: string, id: string) {
    const e = await this.prisma.extraction.findFirst({ where: { id, userId } })
    if (!e) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Extração não encontrada.')
    return e
  }

  /** Processa a fila (uma por vez; o conversor pode ser pesado). */
  @Interval('extractions-process', 2000)
  async process() {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = await this.prisma.extraction.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } })
        if (!next) return
        const claimed = await this.prisma.extraction.updateMany({
          where: { id: next.id, status: 'QUEUED' },
          data: { status: 'PROCESSING', startedAt: new Date() },
        })
        if (claimed.count === 1) await this.run(next)
      }
    } finally {
      this.running = false
    }
  }

  private async run(e: Extraction) {
    const started = Date.now()
    const reservation = await this.ledger.reservationFor({ extractionId: e.id })
    try {
      const original = await this.prisma.artifact.findFirstOrThrow({ where: { extractionId: e.id, kind: 'ORIGINAL_UPLOAD' } })
      const chunks: Buffer[] = []
      for await (const c of this.storage.stream(original.storageKey)) chunks.push(c as Buffer)
      const result = await this.converter.convert({ extractionId: e.id, fileName: e.fileName, mimeType: e.mimeType, data: Buffer.concat(chunks) })
      const charge = this.billing.extractionCharge(result.billableUnits)
      if (reservation)
        await this.ledger.settle(reservation.id, charge, { description: `Extrator · ${e.fileName}`, reference: e.id.slice(0, 8).toUpperCase(), extractionId: e.id })
      await this.prisma.extraction.update({
        where: { id: e.id },
        data: {
          status: 'COMPLETED',
          data: result.data as Prisma.InputJsonValue,
          fields: result.fields as unknown as Prisma.InputJsonValue,
          creditsCharged: Math.min(charge, e.creditsReserved),
          durationS: (Date.now() - started) / 1000,
          completedAt: new Date(),
        },
      })
      await this.notifications.notify(e.userId, 'EXTRACTION_COMPLETED', 'Dados extraídos', e.fileName, '/app/extrator')
    } catch (err) {
      const msg = err instanceof ConversionError ? err.message : 'Falha interna ao converter a fatura. Nenhum crédito foi cobrado.'
      if (!(err instanceof ConversionError)) this.logger.error(`conversão ${e.id}`, (err as Error).stack)
      if (reservation) await this.ledger.release(reservation.id)
      await this.prisma.extraction.update({
        where: { id: e.id },
        data: { status: 'FAILED', error: msg, creditsCharged: 0, durationS: (Date.now() - started) / 1000, completedAt: new Date() },
      })
      await this.notifications.notify(e.userId, 'EXTRACTION_FAILED', 'Extração de dados com falha', `${e.fileName}: ${msg}`, '/app/extrator')
    }
  }
}

const MAX_BYTES = loadEnv().UPLOAD_MAX_BYTES

@ApiTags('extrator')
@Controller('extractions')
export class ExtractionsController {
  constructor(
    private readonly extractions: ExtractionsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @AllowApiKey()
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }))
  async create(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'FILE_REQUIRED', 'Envie o arquivo no campo "file".')
    const e = await this.extractions.create(user, file)
    return { id: e.id, status: 'queued' }
  }

  @Get()
  @AllowApiKey()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q.page, q.pageSize)
    const where = { userId: user.id }
    const [items, total] = await Promise.all([
      this.prisma.extraction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.extraction.count({ where }),
    ])
    return paginated(items.map(toExtractionDto), total, page, pageSize)
  }

  @Get(':id')
  @AllowApiKey()
  async status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toStatusDto(await this.extractions.owned(user.id, id))
  }

  @Get(':id/result')
  @AllowApiKey()
  async result(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.extractions.owned(user.id, id)
    if (e.status !== 'COMPLETED') throw new AppError(HttpStatus.CONFLICT, 'NOT_READY', `A extração ainda não terminou (status: ${e.status.toLowerCase()}).`)
    return { data: e.data, fields: e.fields }
  }

  @Get(':id/original/link')
  @AllowApiKey()
  async original(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.extractions.owned(user.id, id)
    const art = await this.prisma.artifact.findFirst({ where: { extractionId: id, kind: 'ORIGINAL_UPLOAD' } })
    if (!art || art.deletedAt || art.expiresAt < new Date())
      throw new AppError(HttpStatus.GONE, 'FILE_EXPIRED', 'O arquivo original expirou.')
    return this.storage.signedUrl(art.id)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.extractions.owned(user.id, id)
    if (e.status === 'QUEUED' || e.status === 'PROCESSING') throw new AppError(HttpStatus.CONFLICT, 'IN_PROGRESS', 'Aguarde a extração terminar.')
    const arts = await this.prisma.artifact.findMany({ where: { extractionId: id } })
    for (const a of arts) await this.storage.remove(a.storageKey)
    await this.prisma.extraction.delete({ where: { id } })
  }
}

@Module({
  controllers: [ExtractionsController],
  providers: [ExtractionsService, NotConfiguredConverter, { provide: CONVERTER, useExisting: NotConfiguredConverter }],
})
export class ExtractionsModule {}
