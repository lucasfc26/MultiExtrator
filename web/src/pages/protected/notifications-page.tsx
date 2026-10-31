import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertOctagon,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { Select } from '@/components/ui/form'
import { SkeletonRows, Tabs } from '@/components/ui/misc'
import { Pagination } from '@/components/data-display/data-table'
import { EmptyState, ErrorState } from '@/components/feedback/feedback'
import { useNotifications } from '@/features/queries'
import { notificationsService } from '@/lib/api/services/notifications.service'
import { formatRelative } from '@/lib/formatting'
import { qk } from '@/app/query-client'
import { cn } from '@/lib/utils/cn'
import type { AppNotification, NotificationType } from '@/types/platform'

const TYPE_META: Record<NotificationType, { label: string; icon: LucideIcon; tone: string }> = {
  extraction_completed: { label: 'Extração concluída', icon: CheckCircle2, tone: 'text-success bg-success/10' },
  extraction_failed: { label: 'Extração com falha', icon: AlertOctagon, tone: 'text-danger bg-danger/10' },
  credits_low: { label: 'Créditos baixos', icon: Coins, tone: 'text-warning bg-warning/10' },
  purchase_confirmed: { label: 'Compra confirmada', icon: CreditCard, tone: 'text-success bg-success/10' },
  payment_pending: { label: 'Pagamento pendente', icon: Clock, tone: 'text-info bg-info/10' },
  payment_declined: { label: 'Pagamento recusado', icon: XCircle, tone: 'text-danger bg-danger/10' },
  files_expiring: { label: 'Arquivos expirando', icon: Clock, tone: 'text-warning bg-warning/10' },
  security: { label: 'Segurança', icon: ShieldAlert, tone: 'text-accent-3 bg-accent-3/10' },
}

export function NotificationItem({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const meta = TYPE_META[n.type]
  return (
    <li>
      <button
        onClick={() => onOpen(n)}
        className={cn(
          'flex w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-fg/[0.03] sm:px-6',
          !n.read && 'bg-accent/[0.03]',
        )}
      >
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', meta.tone)}>
          <meta.icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-sm', n.read ? 'text-muted' : 'font-semibold text-fg')}>{n.title}</span>
            {n.demo && <DemoBadge />}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.body}</span>
          <span className="mt-1 block text-xs text-subtle">{formatRelative(n.createdAt)}</span>
        </span>
        {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Não lida" />}
      </button>
    </li>
  )
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [type, setType] = useState<NotificationType | 'all'>('all')
  const [page, setPage] = useState(1)
  const list = useNotifications({ filter, type, page, pageSize: 8 })
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.notificationsAll })
  const markRead = useMutation({ mutationFn: notificationsService.markRead, onSuccess: invalidate })
  const markAll = useMutation({ mutationFn: notificationsService.markAllRead, onSuccess: invalidate })

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <PageHeader
        title="Notificações"
        description="Eventos das suas extrações, pagamentos e conta. Atualiza a cada 30 s."
        actions={
          <>
            <ButtonLink to="/app/configuracoes?aba=notificacoes" variant="ghost">
              Preferências
            </ButtonLink>
            <Button
              variant="secondary"
              icon={<CheckCheck className="size-4" />}
              loading={markAll.isPending}
              disabled={!list.data?.unread}
              onClick={() => markAll.mutate()}
            >
              Marcar todas como lidas
            </Button>
          </>
        }
      />
      <GlassCard>
        <div className="flex flex-col gap-3 border-b border-line px-5 pt-3 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <Tabs
            label="Filtro"
            className="border-0"
            value={filter}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
            tabs={[
              { value: 'all', label: 'Todas' },
              { value: 'unread', label: 'Não lidas', count: list.data?.unread },
            ]}
          />
          <Select
            aria-label="Tipo"
            value={type}
            onChange={(e) => {
              setType(e.target.value as NotificationType | 'all')
              setPage(1)
            }}
            className="mb-3 h-9 sm:w-52"
          >
            <option value="all">Todos os tipos</option>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        {list.isPending ? (
          <SkeletonRows className="p-6" rows={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={<Bell />} title={filter === 'unread' ? 'Tudo lido' : 'Sem notificações'} description="Avisos sobre extrações e pagamentos aparecem aqui." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {list.data.items.map((n) => (
                <NotificationItem key={n.id} n={n} onOpen={open} />
              ))}
            </ul>
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
          </>
        )}
      </GlassCard>
    </>
  )
}
