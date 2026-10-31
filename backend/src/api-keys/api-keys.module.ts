import { Body, Controller, Get, HttpStatus, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import type { ApiKey } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications'
import { AppError, CurrentUser, clientIp, type AuthUser } from '../common/http'
import { sha256 } from '../auth/tokens.service'

const SCOPES = ['invoices:write', 'invoices:read', 'extractions:write', 'extractions:read', 'credits:read']
const MAX_ACTIVE_KEYS = 10

class CreateKeyDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string
}

function toKeyDto(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    status: k.status.toLowerCase(),
    scopes: k.scopes,
  }
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function base62(bytes: number) {
  return Array.from(randomBytes(bytes), (b) => B62[b % 62]).join('')
}

@ApiTags('api keys')
@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const keys = await this.prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    return keys.map(toKeyDto)
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateKeyDto, @Req() req: Request) {
    const ativas = await this.prisma.apiKey.count({ where: { userId: user.id, status: 'ACTIVE' } })
    if (ativas >= MAX_ACTIVE_KEYS)
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'KEY_LIMIT', `Limite de ${MAX_ACTIVE_KEYS} chaves ativas. Revogue uma antes de criar outra.`)
    const secret = `ftt_live_${base62(36)}`
    const key = await this.prisma.apiKey.create({
      data: { userId: user.id, name: dto.name.trim(), prefix: secret.slice(0, 13), secretHash: sha256(secret), scopes: SCOPES },
    })
    await this.audit.log('api_key.created', { userId: user.id, entity: 'ApiKey', entityId: key.id, ip: clientIp(req) })
    await this.notifications.notify(user.id, 'SECURITY', 'Nova API key criada', `A chave "${key.name}" foi criada.`, '/app/api')
    return { key: toKeyDto(key), secret }
  }

  @Post(':id/revoke')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, userId: user.id } })
    if (!key) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Chave não encontrada.')
    const updated =
      key.status === 'REVOKED'
        ? key
        : await this.prisma.apiKey.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date() } })
    await this.audit.log('api_key.revoked', { userId: user.id, entity: 'ApiKey', entityId: id, ip: clientIp(req) })
    await this.notifications.notify(user.id, 'SECURITY', 'API key revogada', `A chave "${key.name}" foi revogada.`, '/app/api')
    return toKeyDto(updated)
  }
}

@Module({ controllers: [ApiKeysController] })
export class ApiKeysModule {}
