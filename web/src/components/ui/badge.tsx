import type { HTMLAttributes } from 'react'
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'yellow'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-fg/[0.06] text-muted border-line',
  accent: 'bg-accent/10 text-accent border-accent/25',
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  info: 'bg-info/10 text-info border-info/25',
  yellow: 'bg-accent-3/10 text-accent-3 border-accent-3/25',
}

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

/** Marca dados que não vêm de um backend real. */
export function DemoBadge({ className, label = 'Demo' }: { className?: string; label?: string }) {
  return (
    <Badge tone="success" className={className} title="Dados demonstrativos: não vêm de um backend real">
      <FlaskConical className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}
