import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk } from '@/app/query-client'
import { creditsService, type TxQuery } from '@/lib/api/services/credits.service'
import { notificationsService, type NotificationQuery } from '@/lib/api/services/notifications.service'
import { engine } from '@/lib/engine'
import { historyRepo } from '@/lib/storage/history-repo'
import type { ExtractionRecord, HistoryQuery } from '@/types/extraction'

const LIVE = new Set(['pending', 'queued', 'processing', 'awaiting_code'])
export const isLive = (r: Pick<ExtractionRecord, 'uiStatus'>) => LIVE.has(r.uiStatus)

export function useHistoryList(q: HistoryQuery) {
  return useQuery({
    queryKey: qk.historyList(q),
    queryFn: () => historyRepo.list(q),
    placeholderData: keepPreviousData,
    staleTime: 0,
  })
}

export function useAllHistory() {
  return useQuery({ queryKey: qk.historyAll, queryFn: () => historyRepo.all(), staleTime: 0 })
}

export function useExtraction(id: string | undefined) {
  return useQuery({
    queryKey: qk.extraction(id ?? ''),
    queryFn: async () => (await historyRepo.get(id!)) ?? null,
    enabled: !!id,
    staleTime: 0,
  })
}

/** Logs ao vivo do worker enquanto a extração roda. */
export function useEngineLogs(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.engineLogs(jobId ?? ''),
    queryFn: async () => (await engine.poll(jobId!, { logs: true })).logs ?? [],
    enabled: !!jobId && enabled && engine.supportsLogs,
    refetchInterval: 3000,
    retry: false,
  })
}

export function useEngineHealth() {
  return useQuery({
    queryKey: qk.engineHealth,
    queryFn: ({ signal }) => engine.health(signal),
    refetchInterval: (q) => (q.state.data?.online ? 30_000 : 8000),
    staleTime: 10_000,
  })
}

export function useBalance() {
  return useQuery({ queryKey: qk.balance, queryFn: () => creditsService.balance() })
}

export function useTransactions(q: TxQuery) {
  return useQuery({
    queryKey: qk.transactions(q),
    queryFn: () => creditsService.transactions(q),
    placeholderData: keepPreviousData,
  })
}

export function usePackages() {
  return useQuery({ queryKey: qk.packages, queryFn: () => creditsService.packages(), staleTime: 10 * 60_000 })
}

export function useNotifications(q: NotificationQuery) {
  return useQuery({
    queryKey: qk.notifications(q),
    queryFn: () => notificationsService.list(q),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
}

export function useUnreadCount() {
  const q = useNotifications({ filter: 'unread', pageSize: 1 })
  return q.data?.unread ?? 0
}
