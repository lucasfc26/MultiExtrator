import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/errors'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof ApiError && ['unauthorized', 'forbidden', 'not_found', 'validation'].includes(err.kind))
          return false
        return count < 2
      },
    },
    mutations: { retry: false },
  },
})

export const qk = {
  session: ['session'] as const,
  history: ['history'] as const,
  historyList: (q: unknown) => ['history', 'list', q] as const,
  historyAll: ['history', 'all'] as const,
  extraction: (id: string) => ['history', 'item', id] as const,
  engineHealth: ['engine', 'health'] as const,
  engineLogs: (jobId: string) => ['engine', 'logs', jobId] as const,
  balance: ['credits', 'balance'] as const,
  transactions: (q: unknown) => ['credits', 'transactions', q] as const,
  packages: ['credits', 'packages'] as const,
  payment: (id: string) => ['payments', id] as const,
  apiKeys: ['api-keys'] as const,
  notifications: (q: unknown) => ['notifications', q] as const,
  notificationsAll: ['notifications'] as const,
  profile: ['profile'] as const,
  settings: ['settings'] as const,
}
