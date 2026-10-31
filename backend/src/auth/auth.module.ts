import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Module, Post, Req, Res } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { Equals, IsBoolean, IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import * as argon2 from 'argon2'
import type { Request, Response } from 'express'
import type { User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { AuditService } from '../audit/audit.service'
import { LedgerService } from '../credits/ledger.service'
import { ENV, type Env } from '../config/env'
import { AppError, CurrentUser, Public, clientIp, type AuthUser } from '../common/http'
import { REFRESH_COOKIE, TokensService } from './tokens.service'
import { AuthGuard } from './auth.guard'

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/
const PASSWORD_MSG = 'A senha precisa de 8+ caracteres, com letras e números.'

class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido.' }) email: string
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string
  @IsBoolean() @Equals(true, { message: 'É preciso aceitar os termos e a política de privacidade.' }) acceptTerms: boolean
}

class LoginDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido.' }) email: string
  @IsString() @MinLength(1) @MaxLength(128) password: string
}

class EmailDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido.' }) email: string
}

class ResetDto {
  @IsString() @MinLength(10) token: string
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string
}

class TokenDto {
  @IsString() @MinLength(10) token: string
}

export function toUserDto(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }
}

@ApiTags('autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } })
    if (!u) throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sessão inválida.')
    return toUserDto(u)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (exists) throw new AppError(HttpStatus.CONFLICT, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.')

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id })
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { name: dto.name.trim(), email: dto.email, passwordHash } })
      await tx.userSettings.create({ data: { userId: u.id } })
      await this.ledger.ensureAccount(u.id, tx)
      if (this.env.SIGNUP_BONUS_CREDITS > 0) {
        await this.ledger.post(
          u.id,
          {
            type: 'ADJUSTMENT',
            credits: this.env.SIGNUP_BONUS_CREDITS,
            description: 'Bônus de boas-vindas',
            reference: 'BONUS-CADASTRO',
            idempotencyKey: `signup-bonus:${u.id}`,
          },
          tx,
        )
      }
      return u
    })

    const token = await this.tokens.oneTimeToken(user.id, 'EMAIL_VERIFY', 48 * 60)
    await this.mail.send(
      user.email,
      'Confirme seu e-mail',
      `Olá, ${user.name}!\n\nConfirme seu e-mail para ativar a conta:\n${this.mail.link(`/verificar-email?token=${token}`)}\n\nSeus ${this.env.SIGNUP_BONUS_CREDITS} créditos de boas-vindas já estão na conta.`,
    )
    await this.audit.log('auth.register', { userId: user.id, ip: clientIp(req) })
    return { email: user.email }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    // Mesmo caminho (e custo) para e-mail inexistente: não revela quais contas existem.
    const ok = user ? await argon2.verify(user.passwordHash, dto.password) : await argon2.hash(dto.password).then(() => false)
    if (!user || !ok) {
      await this.audit.log('auth.login_failed', { userId: user?.id, ip: clientIp(req) })
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.')
    }
    await this.tokens.issue(res, user, { ua: req.header('user-agent'), ip: clientIp(req) })
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await this.audit.log('auth.login', { userId: user.id, ip: clientIp(req) })
    return toUserDto(updated)
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revokeByRefresh(req.cookies?.[REFRESH_COOKIE])
    this.tokens.clearCookies(res)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() dto: EmailDto, @Req() req: Request) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (user) {
      const token = await this.tokens.oneTimeToken(user.id, 'PASSWORD_RESET', 60)
      await this.mail.send(
        user.email,
        'Redefinir senha',
        `Recebemos um pedido para redefinir sua senha. O link vale por 1 hora:\n${this.mail.link(`/redefinir-senha?token=${token}`)}\n\nSe não foi você, ignore este e-mail.`,
      )
      await this.audit.log('auth.password_forgot', { userId: user.id, ip: clientIp(req) })
    }
    // Sempre 202: não revela se o e-mail tem conta.
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetDto, @Req() req: Request) {
    const t = await this.tokens.consumeOneTimeToken(dto.token, 'PASSWORD_RESET')
    if (!t) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TOKEN_INVALID', 'O link de redefinição é inválido ou expirou. Peça um novo.')
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id })
    await this.prisma.user.update({ where: { id: t.userId }, data: { passwordHash } })
    await this.tokens.revokeAll(t.userId)
    await this.audit.log('auth.password_reset', { userId: t.userId, ip: clientIp(req) })
  }

  @Public()
  @Post('email/verify')
  @HttpCode(204)
  async verify(@Body() dto: TokenDto) {
    const t = await this.tokens.consumeOneTimeToken(dto.token, 'EMAIL_VERIFY')
    if (!t) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TOKEN_INVALID', 'O link de verificação é inválido ou expirou.')
    await this.prisma.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } })
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('email/resend')
  @HttpCode(202)
  async resend(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    if (u.emailVerifiedAt) return
    const token = await this.tokens.oneTimeToken(u.id, 'EMAIL_VERIFY', 48 * 60)
    await this.mail.send(u.email, 'Confirme seu e-mail', `Confirme seu e-mail:\n${this.mail.link(`/verificar-email?token=${token}`)}`)
  }
}

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [TokensService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokensService],
})
export class AuthModule {}
