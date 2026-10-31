import { config } from '@/lib/config'
import { ApiError } from '@/lib/api/errors'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { db, delay, save, uid } from '@/mocks/db'
import { SIGNUP_BONUS_CREDITS } from '@/config/pricing'
import type { LoginInput, RegisterInput, Session, User } from '@/types/platform'

/**
 * Autenticação. Contrato esperado do backend (PROVISÓRIO):
 *  GET  /auth/me              → 200 User | 401
 *  POST /auth/login           {email,password} → 200 User (cookie HttpOnly)
 *  POST /auth/logout          → 204
 *  POST /auth/register        {name,email,password,acceptTerms} → 201
 *  POST /auth/password/forgot {email} → 202
 *  POST /auth/password/reset  {token,password} → 204
 *  POST /auth/email/verify    {token} → 204
 * A sessão vive em cookie HttpOnly emitido pelo backend: o frontend não toca em tokens.
 */
export interface AuthService {
  me(): Promise<Session | null>
  login(input: LoginInput): Promise<Session>
  logout(): Promise<void>
  register(input: RegisterInput): Promise<{ email: string }>
  forgotPassword(email: string): Promise<void>
  resetPassword(token: string, password: string): Promise<void>
  verifyEmail(token: string): Promise<void>
}

const http: AuthService = {
  async me() {
    try {
      return { user: await api.get<User>(endpoints.auth.me), demo: false }
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'unauthorized') return null
      throw e
    }
  },
  login: async (input) => ({ user: await api.post<User>(endpoints.auth.login, input), demo: false }),
  logout: async () => void (await api.post(endpoints.auth.logout)),
  register: async (input) => {
    await api.post(endpoints.auth.register, input)
    return { email: input.email }
  },
  forgotPassword: async (email) => void (await api.post(endpoints.auth.forgot, { email })),
  resetPassword: async (token, password) => void (await api.post(endpoints.auth.reset, { token, password })),
  verifyEmail: async (token) => void (await api.post(endpoints.auth.verifyEmail, { token })),
}

const strip = ({ password: _p, ...u }: User & { password: string }): User => u

// Modo demo: guarda só o id do usuário demonstrativo — não há token nenhum.
const mock: AuthService = {
  async me() {
    await delay(150)
    const d = db()
    const u = d.users.find((x) => x.id === d.sessionUserId)
    return u ? { user: strip(u), demo: true } : null
  },
  async login({ email, password }) {
    await delay()
    const d = db()
    let u = d.users.find((x) => x.email.toLowerCase() === email.toLowerCase())
    if (u && u.password !== password) throw new ApiError('unauthorized', 'E-mail ou senha incorretos.', 401)
    if (!u) {
      // Demo: qualquer e-mail entra e ganha uma conta demonstrativa.
      u = {
        id: uid('usr'),
        name: email
          .split('@')[0]
          .split(/[._-]/)
          .filter(Boolean)
          .map((p) => p[0].toUpperCase() + p.slice(1))
          .join(' '),
        email,
        password,
        emailVerified: true,
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      }
      d.users.push(u)
    }
    u.lastLoginAt = new Date().toISOString()
    d.sessionUserId = u.id
    save()
    return { user: strip(u), demo: true }
  },
  async logout() {
    await delay(100)
    db().sessionUserId = null
    save()
  },
  async register({ name, email, password }) {
    await delay()
    const d = db()
    if (d.users.some((x) => x.email.toLowerCase() === email.toLowerCase()))
      throw new ApiError('conflict', 'Já existe uma conta com este e-mail.', 409)
    d.users.push({
      id: uid('usr'),
      name,
      email,
      password,
      emailVerified: false,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    })
    // Bônus de boas-vindas (demo: a carteira demonstrativa é única).
    d.balance += SIGNUP_BONUS_CREDITS
    d.transactions.push({
      id: uid('tx'),
      createdAt: new Date().toISOString(),
      description: 'Bônus de boas-vindas (demo)',
      type: 'adjustment',
      credits: SIGNUP_BONUS_CREDITS,
      amountCents: null,
      status: 'confirmed',
      reference: 'BONUS-CADASTRO',
    })
    save()
    return { email }
  },
  forgotPassword: async () => delay().then(() => undefined),
  async resetPassword(token) {
    await delay()
    if (token === 'expirado') throw new ApiError('validation', 'O link de redefinição expirou. Peça um novo.', 422)
  },
  async verifyEmail(token) {
    await delay()
    if (token === 'expirado') throw new ApiError('validation', 'O link de verificação expirou.', 422)
    const d = db()
    const u = d.users.find((x) => x.id === d.sessionUserId) ?? d.users.at(-1)
    if (u) u.emailVerified = true
    save()
  },
}

export const authService: AuthService = config.useMocks ? mock : http
