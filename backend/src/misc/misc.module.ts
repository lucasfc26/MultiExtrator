import { Body, Controller, Get, HttpCode, Inject, Module, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { randomBytes } from 'node:crypto'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { WorkerClient } from '../engine/worker.client'
import { Public } from '../common/http'

class SalesContactDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string
  @IsEmail({}, { message: 'E-mail inválido.' }) email: string
  @IsString() @MinLength(2) @MaxLength(160) company: string
  @IsOptional() @IsString() @MaxLength(40) phone?: string
  @IsIn(['ate-500', '500-2000', '2000-10000', '10000+']) volume: string
  @IsString() @MinLength(10) @MaxLength(2000) message: string
}

@ApiTags('contato')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('sales')
  @HttpCode(202)
  async sales(@Body() dto: SalesContactDto) {
    const protocol = `FTT-${randomBytes(4).toString('hex').toUpperCase()}`
    await this.prisma.contactRequest.create({ data: { ...dto, protocol } })
    await this.mail.send(
      this.env.MAIL_SALES_TO,
      `Contato comercial ${protocol} · ${dto.company}`,
      `Nome: ${dto.name}\nE-mail: ${dto.email}\nEmpresa: ${dto.company}\nTelefone: ${dto.phone ?? '—'}\nFaturas/mês: ${dto.volume}\n\n${dto.message}`,
    )
    return { protocol }
  }
}

@ApiTags('saúde')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: WorkerClient,
  ) {}

  @Public()
  @Get()
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false)
    const worker = await this.worker.health()
    return { ok: db, database: db ? 'ok' : 'erro', worker, time: new Date().toISOString() }
  }
}

@Module({ controllers: [ContactController, HealthController] })
export class MiscModule {}
