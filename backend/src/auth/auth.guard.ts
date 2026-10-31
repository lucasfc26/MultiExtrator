import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { ALLOW_API_KEY, IS_PUBLIC, clientIp, type AuthUser } from '../common/http'
import { ACCESS_COOKIE, REFRESH_COOKIE, TokensService, sha256 } from './tokens.service'

/**
 * Guard global. Ordem:
 *  1. Rota @Public → passa.
 *  2. Header de API key (Authorization: Bearer ftt_... ou X-API-Key) → só em rotas @AllowApiKey.
 *  3. Cookie de acesso válido → sessão.
 *  4. Acesso vencido + refresh válido → renova em silêncio (novos cookies na resposta).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const res = ctx.switchToHttp().getResponse<Response>()

    const apiKey = this.extractApiKey(req)
    if (apiKey) {
      if (!this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY, targets))
        throw new ForbiddenException({ code: 'API_KEY_NOT_ALLOWED', message: 'Esta rota não aceita API key.' })
      req.user = await this.authApiKey(apiKey)
      return true
    }

    const access = req.cookies?.[ACCESS_COOKIE] as string | undefined
    const payload = access ? this.tokens.verifyAccess(access) : null
    if (payload) {
      req.user = { id: payload.sub, email: payload.email, via: 'session', sessionFamilyId: payload.fam }
      return true
    }

    const refresh = req.cookies?.[REFRESH_COOKIE] as string | undefined
    if (refresh) {
      const rotated = await this.tokens.rotate(res, refresh, { ua: req.header('user-agent'), ip: clientIp(req) })
      if (rotated) {
        req.user = { id: rotated.user.id, email: rotated.user.email, via: 'session', sessionFamilyId: rotated.familyId }
        return true
      }
      this.tokens.clearCookies(res)
    }
    throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sua sessão expirou. Entre novamente.' })
  }

  private extractApiKey(req: Request): string | null {
    const h = req.header('x-api-key')
    if (h) return h.trim()
    const auth = req.header('authorization')
    if (auth?.startsWith('Bearer ftt_')) return auth.slice(7).trim()
    return null
  }

  private async authApiKey(secret: string): Promise<AuthUser> {
    const key = await this.prisma.apiKey.findUnique({ where: { secretHash: sha256(secret) }, include: { user: true } })
    if (!key || key.status !== 'ACTIVE')
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'API key ausente, inválida ou revogada.' })
    // Atualização de "último uso" sem bloquear a requisição.
    void this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
    return { id: key.userId, email: key.user.email, via: 'api_key', apiKeyId: key.id }
  }
}
