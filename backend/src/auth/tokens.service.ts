import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { CookieOptions, Response } from 'express'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'

export const ACCESS_COOKIE = 'ftt_at'
export const REFRESH_COOKIE = 'ftt_rt'
/** Refresh reapresentado logo após a rotação (abas/requisições paralelas): não é roubo. */
const REUSE_GRACE_MS = 20_000

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

interface AccessPayload {
  sub: string
  email: string
  fam: string
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieBase(): CookieOptions {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/' }
  }

  verifyAccess(token: string): AccessPayload | null {
    try {
      return this.jwt.verify<AccessPayload>(token, { secret: this.env.JWT_ACCESS_SECRET })
    } catch {
      return null
    }
  }

  /** Abre uma sessão nova (login) e grava os cookies. */
  async issue(res: Response, user: { id: string; email: string }, meta: { ua?: string; ip?: string }, familyId: string = randomUUID()) {
    const refresh = randomToken()
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refresh),
        familyId,
        userAgent: meta.ua?.slice(0, 300),
        ip: meta.ip,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    })
    this.setCookies(res, user, refresh, familyId)
    return session
  }

  private setCookies(res: Response, user: { id: string; email: string }, refresh: string, familyId: string) {
    const access = this.jwt.sign(
      { sub: user.id, email: user.email, fam: familyId } satisfies AccessPayload,
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: `${this.env.ACCESS_TOKEN_TTL_MIN}m` },
    )
    res.cookie(ACCESS_COOKIE, access, { ...this.cookieBase(), maxAge: this.env.ACCESS_TOKEN_TTL_MIN * 60_000 })
    res.cookie(REFRESH_COOKIE, refresh, { ...this.cookieBase(), maxAge: this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 })
  }

  /**
   * Troca o refresh token por um novo (rotação). Reuso de um token já
   * trocado fora da janela de tolerância revoga a família inteira.
   */
  async rotate(res: Response, refresh: string, meta: { ua?: string; ip?: string }) {
    const hash = sha256(refresh)
    const s = await this.prisma.session.findUnique({ where: { tokenHash: hash }, include: { user: true } })
    if (!s || s.expiresAt < new Date()) return null
    if (s.revokedAt) {
      const recente = s.replacedById && Date.now() - s.revokedAt.getTime() < REUSE_GRACE_MS
      if (!recente) {
        await this.revokeFamily(s.familyId)
        return null
      }
    } else {
      // Se outra requisição paralela já trocou este token, segue: está dentro da janela.
      await this.prisma.session.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    const next = await this.issue(res, s.user, meta, s.familyId)
    if (!s.replacedById) await this.prisma.session.update({ where: { id: s.id }, data: { replacedById: next.id } })
    return { user: s.user, familyId: s.familyId }
  }

  async revokeByRefresh(refresh: string | undefined) {
    if (!refresh) return
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refresh) } })
    if (s) await this.revokeFamily(s.familyId)
  }

  revokeFamily(familyId: string) {
    return this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } })
  }

  revokeAll(userId: string, exceptFamily?: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptFamily ? { NOT: { familyId: exceptFamily } } : {}) },
      data: { revokedAt: new Date() },
    })
  }

  clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, this.cookieBase())
    res.clearCookie(REFRESH_COOKIE, this.cookieBase())
  }

  /** Token de uso único (verificação de e-mail, redefinição de senha). Guarda só o hash. */
  async oneTimeToken(userId: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMin: number) {
    const token = randomToken()
    await this.prisma.verificationToken.create({
      data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMin * 60_000) },
    })
    return token
  }

  async consumeOneTimeToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    const t = await this.prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } })
    if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) return null
    const claimed = await this.prisma.verificationToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } })
    return claimed.count === 1 ? t : null
  }
}
