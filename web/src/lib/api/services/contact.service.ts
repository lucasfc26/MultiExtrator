import { config } from '@/lib/config'
import { api } from '@/lib/api/client'
import { delay } from '@/mocks/db'

/**
 * Contato comercial (PROVISÓRIO):
 *  POST /contact/sales { name, email, company, phone?, volume, message } → 202 { protocol }
 * Modo demo: guarda no navegador e não envia nada.
 */
export interface SalesContactInput {
  name: string
  email: string
  company: string
  phone?: string
  volume: string
  message: string
}

export interface ContactService {
  sendSales(input: SalesContactInput): Promise<{ protocol: string; demo: boolean }>
}

const http: ContactService = {
  sendSales: async (input) => ({ ...(await api.post<{ protocol: string }>('/contact/sales', input)), demo: false }),
}

const mock: ContactService = {
  async sendSales(input) {
    await delay(200)
    const protocol = `DEMO-${Date.now().toString(36).toUpperCase()}`
    try {
      const all = JSON.parse(localStorage.getItem('me-demo-contacts') ?? '[]') as unknown[]
      localStorage.setItem('me-demo-contacts', JSON.stringify([...all, { ...input, protocol, at: new Date().toISOString() }]))
    } catch {
      /* sem armazenamento: segue */
    }
    return { protocol, demo: true }
  },
}

export const contactService: ContactService = config.useMocks ? mock : http
