import { config } from '@/lib/config'
import { ApiError } from '@/lib/api/errors'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { db, delay, save, uid } from '@/mocks/db'
import type { ApiKey, CreatedApiKey } from '@/types/platform'

/**
 * API keys da plataforma (PROVISÓRIO):
 *  GET  /api-keys               → ApiKey[]
 *  POST /api-keys {name}        → {key, secret} (segredo mostrado uma vez)
 *  POST /api-keys/:id/revoke    → ApiKey
 * Hoje, a chave real do n8n é a credencial "MultiExtractor API Key" configurada no próprio n8n.
 */
export interface ApiKeysService {
  list(): Promise<ApiKey[]>
  create(name: string): Promise<CreatedApiKey>
  revoke(id: string): Promise<ApiKey>
}

const http: ApiKeysService = {
  list: () => api.get<ApiKey[]>(endpoints.apiKeys.list),
  create: (name) => api.post<CreatedApiKey>(endpoints.apiKeys.list, { name }),
  revoke: (id) => api.post<ApiKey>(endpoints.apiKeys.revoke(id)),
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const mock: ApiKeysService = {
  async list() {
    await delay()
    return structuredClone(db().apiKeys).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },
  async create(name) {
    await delay(180)
    const secret = `me_demo_${randomSecret()}`
    const key: ApiKey = {
      id: uid('key'),
      name,
      prefix: secret.slice(0, 12),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active',
      scopes: ['extractions:write', 'extractions:read'],
    }
    db().apiKeys.push(key)
    save()
    return { key, secret }
  },
  async revoke(id) {
    await delay(150)
    const k = db().apiKeys.find((x) => x.id === id)
    if (!k) throw new ApiError('not_found', 'Chave não encontrada.', 404)
    k.status = 'revoked'
    save()
    return structuredClone(k)
  },
}

export const apiKeysService: ApiKeysService = config.useMocks ? mock : http
