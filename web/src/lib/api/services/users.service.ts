import { config } from '@/lib/config'
import { ApiError } from '@/lib/api/errors'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { db, delay, save } from '@/mocks/db'
import type { AccountSettings, User } from '@/types/platform'

/**
 * Perfil e preferências da conta (PROVISÓRIO):
 *  PATCH  /users/me             {name}
 *  POST   /users/me/password    {currentPassword,newPassword}
 *  DELETE /users/me/sessions    encerra as outras sessões
 *  POST   /users/me/export      → 202 (o backend envia por e-mail)
 *  POST   /users/me/deletion-request {password}
 *  GET/PATCH /settings          AccountSettings
 */
export interface UsersService {
  updateProfile(input: { name: string }): Promise<User>
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>
  endOtherSessions(): Promise<void>
  requestExport(): Promise<void>
  requestDeletion(password: string): Promise<void>
  getSettings(): Promise<AccountSettings>
  updateSettings(input: AccountSettings): Promise<AccountSettings>
}

const http: UsersService = {
  updateProfile: (input) => api.patch<User>(endpoints.users.me, input),
  changePassword: async (input) => void (await api.post(endpoints.users.password, input)),
  endOtherSessions: async () => void (await api.delete(endpoints.users.sessions)),
  requestExport: async () => void (await api.post(endpoints.users.exportData)),
  requestDeletion: async (password) => void (await api.post(endpoints.users.deletion, { password })),
  getSettings: () => api.get<AccountSettings>(endpoints.settings),
  updateSettings: (input) => api.patch<AccountSettings>(endpoints.settings, input),
}

function current() {
  const d = db()
  const u = d.users.find((x) => x.id === d.sessionUserId)
  if (!u) throw new ApiError('unauthorized', 'Sessão demonstrativa encerrada.', 401)
  return u
}

const mock: UsersService = {
  async updateProfile({ name }) {
    await delay()
    const u = current()
    u.name = name
    save()
    const { password: _p, ...rest } = u
    return rest
  },
  async changePassword({ currentPassword, newPassword }) {
    await delay()
    const u = current()
    if (u.password !== currentPassword) throw new ApiError('validation', 'Senha atual incorreta.', 422)
    u.password = newPassword
    save()
  },
  endOtherSessions: async () => void (await delay()),
  requestExport: async () => void (await delay()),
  async requestDeletion(password) {
    await delay()
    if (current().password !== password) throw new ApiError('validation', 'Senha incorreta.', 422)
  },
  async getSettings() {
    await delay(150)
    return structuredClone(db().settings)
  },
  async updateSettings(input) {
    await delay()
    db().settings = structuredClone(input)
    save()
    return input
  },
}

export const usersService: UsersService = config.useMocks ? mock : http
