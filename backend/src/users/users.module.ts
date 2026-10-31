import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Patch, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator'
import * as argon2 from 'argon2'
import type { Request } from 'express'
import type { UserSettings } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications'
import { AppError, CurrentUser, clientIp, type AuthUser } from '../common/http'
import { AuthModule, PASSWORD_RULE, toUserDto } from '../auth/auth.module'
import { TokensService } from '../auth/tokens.service'

class ProfileDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string
}

class PasswordDto {
  @IsString() @MinLength(1) currentPassword: string
  @IsString() @Matches(PASSWORD_RULE, { message: 'A senha precisa de 8+ caracteres, com letras e números.' }) newPassword: string
}

class DeletionDto {
  @IsString() @MinLength(1) password: string
}

class NotificationPrefsDto {
  @IsBoolean() emailExtraction: boolean
  @IsBoolean() emailCredits: boolean
  @IsBoolean() emailSecurity: boolean
  @IsBoolean() inAppExtraction: boolean
}

class SettingsDto {
  @IsIn(['json', 'csv']) defaultOutput: 'json' | 'csv'
  @ValidateNested() @Type(() => NotificationPrefsDto) notifications: NotificationPrefsDto
}

function toSettingsDto(s: UserSettings) {
  return {
    defaultOutput: s.defaultOutput.toLowerCase(),
    notifications: {
      emailExtraction: s.emailExtraction,
      emailCredits: s.emailCredits,
      emailSecurity: s.emailSecurity,
      inAppExtraction: s.inAppExtraction,
    },
  }
}

@ApiTags('conta')
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async checkPassword(userId: string, password: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (!(await argon2.verify(u.passwordHash, password)))
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'WRONG_PASSWORD', 'Senha incorreta.')
    return u
  }

  @Patch('users/me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    const u = await this.prisma.user.update({ where: { id: user.id }, data: { name: dto.name.trim() } })
    return toUserDto(u)
  }

  @Post('users/me/password')
  @HttpCode(204)
  async password(@CurrentUser() user: AuthUser, @Body() dto: PasswordDto, @Req() req: Request) {
    await this.checkPassword(user.id, dto.currentPassword).catch(() => {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'WRONG_PASSWORD', 'Senha atual incorreta.')
    })
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id })
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    // Mantém a sessão atual e derruba as outras.
    await this.tokens.revokeAll(user.id, user.sessionFamilyId)
    await this.audit.log('user.password_changed', { userId: user.id, ip: clientIp(req) })
    await this.notifications.notify(user.id, 'SECURITY', 'Senha alterada', 'A senha da sua conta foi alterada. Se não foi você, redefina a senha agora.')
  }

  @Delete('users/me/sessions')
  @HttpCode(204)
  async endSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.tokens.revokeAll(user.id, user.sessionFamilyId)
    await this.audit.log('user.sessions_revoked', { userId: user.id, ip: clientIp(req) })
  }

  /** Exportação (LGPD): envia por e-mail um JSON com os dados pessoais e o histórico. */
  @Post('users/me/export')
  @HttpCode(202)
  async export(@CurrentUser() user: AuthUser) {
    const [u, invoices, extractions, transactions] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { settings: true } }),
      this.prisma.invoiceRequest.findMany({ where: { userId: user.id }, select: { id: true, flow: true, uc: true, referencias: true, status: true, createdAt: true } }),
      this.prisma.extraction.findMany({ where: { userId: user.id }, select: { id: true, fileName: true, status: true, createdAt: true } }),
      this.prisma.creditTransaction.findMany({ where: { userId: user.id } }),
    ])
    const { passwordHash: _p, ...perfil } = u
    const content = JSON.stringify({ perfil, faturas: invoices, extracoes: extractions, creditos: transactions }, null, 2)
    await this.mail.send(u.email, 'Seus dados', 'Em anexo, os dados pessoais e o histórico da sua conta.', [{ filename: 'fatturas-dados.json', content }])
    await this.audit.log('user.data_export', { userId: user.id })
  }

  @Post('users/me/deletion-request')
  @HttpCode(202)
  async deletion(@CurrentUser() user: AuthUser, @Body() dto: DeletionDto, @Req() req: Request) {
    const u = await this.checkPassword(user.id, dto.password)
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } })
    await this.audit.log('user.deletion_requested', { userId: user.id, ip: clientIp(req) })
    await this.mail.send(
      u.email,
      'Pedido de exclusão recebido',
      'Recebemos o pedido de exclusão da sua conta. Registros financeiros obrigatórios são mantidos pelo prazo legal.',
    )
  }

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser) {
    const s = await this.prisma.userSettings.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } })
    return toSettingsDto(s)
  }

  @Patch('settings')
  async setSettings(@CurrentUser() user: AuthUser, @Body() dto: SettingsDto) {
    const data = { defaultOutput: dto.defaultOutput.toUpperCase() as 'JSON' | 'CSV', ...dto.notifications }
    const s = await this.prisma.userSettings.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } })
    return toSettingsDto(s)
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController] })
export class UsersModule {}
