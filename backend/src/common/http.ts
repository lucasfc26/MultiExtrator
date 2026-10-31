import {
  ArgumentsHost,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestMiddleware,
  SetMetadata,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

// ─── Usuário autenticado ─────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  via: 'session' | 'api_key'
  apiKeyId?: string
  /** Família do refresh token da sessão atual (para "encerrar outras sessões"). */
  sessionFamilyId?: string
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user
})

/** Rota sem autenticação. */
export const IS_PUBLIC = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** Rota que também aceita API key (além da sessão por cookie). */
export const ALLOW_API_KEY = 'allowApiKey'
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true)

// ─── Request ID ──────────────────────────────────────────────────────────────

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id')
    const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    ;(req as Request & { id: string }).id = id
    res.setHeader('X-Request-Id', id)
    next()
  }
}

// ─── Erros padronizados ──────────────────────────────────────────────────────

/** Erro de domínio com código estável para a API. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status)
  }
}

export const insufficientCredits = (needed: number, available: number) =>
  new AppError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_CREDITS', `Saldo insuficiente: são necessários ${needed} créditos e há ${available}.`, {
    needed,
    available,
  })

/**
 * Corpo de erro: { statusCode, code, message, requestId }. Nunca expõe stack
 * ou mensagens internas do banco.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const req = ctx.getRequest<Request & { id?: string }>()
    const res = ctx.getResponse<Response>()
    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code = 'INTERNAL_ERROR'
    let message: string | string[] = 'Erro interno do servidor.'
    let details: unknown

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') message = body
      else {
        const b = body as Record<string, unknown>
        message = (b.message as string | string[]) ?? exception.message
        code = (b.code as string) ?? HttpStatus[status] ?? 'ERROR'
        details = b.details
      }
      if (code === 'Bad Request' || code === 'BAD_REQUEST') code = 'VALIDATION_ERROR'
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT
      code = 'CONFLICT'
      message = 'Registro duplicado.'
    } else {
      this.logger.error(`[${req.id}] ${req.method} ${req.path}`, exception instanceof Error ? exception.stack : String(exception))
    }

    res.status(status).json({
      statusCode: status,
      code: typeof code === 'string' ? code.toUpperCase().replace(/\s+/g, '_') : 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: req.id,
    })
  }
}

// ─── Paginação ───────────────────────────────────────────────────────────────

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function pageArgs(page = 1, pageSize = 10, max = 100) {
  const size = Math.min(Math.max(1, pageSize), max)
  const p = Math.max(1, page)
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size }
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export function clientIp(req: Request): string | undefined {
  return (req.ip || req.socket?.remoteAddress) ?? undefined
}
