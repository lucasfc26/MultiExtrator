import { Badge, type BadgeTone } from '@/components/ui/badge'
import type { UiStatus } from '@/types/extraction'
import { cn } from '@/lib/utils/cn'

export const STATUS_META: Record<UiStatus, { label: string; tone: BadgeTone; live?: boolean }> = {
  pending: { label: 'Pendente', tone: 'neutral', live: true },
  queued: { label: 'Na fila', tone: 'info', live: true },
  processing: { label: 'Em processamento', tone: 'accent', live: true },
  awaiting_code: { label: 'Aguardando código', tone: 'yellow', live: true },
  success: { label: 'Concluída', tone: 'success' },
  warning: { label: 'Com atenção', tone: 'warning' },
  failed: { label: 'Falha', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
}

const dot: Record<BadgeTone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  yellow: 'bg-accent-3',
}

export function StatusBadge({ status, className }: { status: UiStatus; className?: string }) {
  const m = STATUS_META[status]
  return (
    <Badge tone={m.tone} className={className}>
      <span className={cn('size-1.5 rounded-full', dot[m.tone], m.live && 'animate-[pulse-dot_1.6s_ease-in-out_infinite]')} />
      {m.label}
    </Badge>
  )
}
