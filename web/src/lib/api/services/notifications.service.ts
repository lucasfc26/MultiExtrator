import { config } from '@/lib/config'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { db, delay, save, uid } from '@/mocks/db'
import type { Paginated } from '@/types/extraction'
import type { AppNotification, NotificationType } from '@/types/platform'

/**
 * Notificações (PROVISÓRIO):
 *  GET  /notifications?unread&type&page → Paginated<AppNotification> & {unread}
 *  POST /notifications/:id/read
 *  POST /notifications/read-all
 * Atualização por polling (30 s) até o backend oferecer SSE/WebSocket.
 */
export interface NotificationQuery {
  filter?: 'all' | 'unread'
  type?: NotificationType | 'all'
  page?: number
  pageSize?: number
}

export type NotificationPage = Paginated<AppNotification> & { unread: number }

export interface NotificationsService {
  list(q: NotificationQuery): Promise<NotificationPage>
  markRead(id: string): Promise<void>
  markAllRead(): Promise<void>
  /** Modo demo: eventos locais reais (ex.: extração concluída neste navegador). */
  pushLocal(n: Pick<AppNotification, 'type' | 'title' | 'body' | 'link'>): Promise<void>
}

const http: NotificationsService = {
  list: (q) =>
    api.get<NotificationPage>(endpoints.notifications.list, {
      query: {
        unread: q.filter === 'unread' ? true : undefined,
        type: q.type === 'all' ? undefined : q.type,
        page: q.page,
        pageSize: q.pageSize,
      },
    }),
  markRead: async (id) => void (await api.post(endpoints.notifications.read(id))),
  markAllRead: async () => void (await api.post(endpoints.notifications.readAll)),
  pushLocal: async () => undefined,
}

const mock: NotificationsService = {
  async list({ filter = 'all', type = 'all', page = 1, pageSize = 10 }) {
    await delay(250)
    const all = db()
      .notifications.filter((n) => (filter === 'unread' ? !n.read : true))
      .filter((n) => type === 'all' || n.type === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize))
    const p = Math.min(page, totalPages)
    return {
      items: all.slice((p - 1) * pageSize, p * pageSize),
      total: all.length,
      page: p,
      pageSize,
      totalPages,
      unread: db().notifications.filter((n) => !n.read).length,
    }
  },
  async markRead(id) {
    await delay(120)
    const n = db().notifications.find((x) => x.id === id)
    if (n) n.read = true
    save()
  },
  async markAllRead() {
    await delay(200)
    db().notifications.forEach((n) => (n.read = true))
    save()
  },
  async pushLocal(n) {
    db().notifications.unshift({ ...n, id: uid('n'), createdAt: new Date().toISOString(), read: false, demo: false })
    save()
  },
}

export const notificationsService: NotificationsService = config.useMocks ? mock : http
