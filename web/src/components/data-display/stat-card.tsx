import type { ReactNode } from 'react'
import { GlassCard } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { cn } from '@/lib/utils/cn'

export function StatCard({
  label,
  value,
  icon,
  hint,
  loading,
  tone = 'accent',
  badge,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  hint?: ReactNode
  loading?: boolean
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'yellow' | 'cyan'
  badge?: ReactNode
}) {
  const tones = {
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    yellow: 'text-accent-3',
    cyan: 'text-accent-2',
  }
  return (
    <GlassCard className="relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={cn('shrink-0 [&>svg]:size-[18px]', tones[tone])}>{icon}</span>
      </div>
      <div className="mt-3 flex items-end gap-2">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-[28px] leading-none font-semibold tracking-tight text-fg tabular-nums">{value}</p>
        )}
        {badge}
      </div>
      {hint && <p className="mt-2 text-xs text-subtle">{hint}</p>}
    </GlassCard>
  )
}
