import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Button } from './button'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-lg', className)} />
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

export function CopyButton({
  value,
  label = 'Copiar',
  className,
  size = 'sm',
}: {
  value: string
  label?: string
  className?: string
  size?: 'sm' | 'icon'
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button
      variant="ghost"
      size={size === 'icon' ? 'icon' : 'sm'}
      className={cn(size === 'icon' && 'size-8', className)}
      aria-label={copied ? 'Copiado' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          timer.current = setTimeout(() => setCopied(false), 1800)
        } catch {
          /* clipboard bloqueado: sem feedback falso */
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {size !== 'icon' && (copied ? 'Copiado' : label)}
    </Button>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label,
}: {
  tabs: { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (v: T) => void
  className?: string
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative -mb-px flex items-center gap-2 border-b-2 px-3 pt-2 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className="rounded-full bg-fg/[0.08] px-1.5 text-[11px] text-muted tabular-nums">{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-fg/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5', className)} aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
      <span className="relative size-2.5 rounded-full bg-accent" />
    </span>
  )
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  className,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'yellow'
  title?: ReactNode
  children?: ReactNode
  icon?: ReactNode
  className?: string
  action?: ReactNode
}) {
  const tones = {
    info: 'border-info/25 bg-info/[0.07] [--tone:hsl(var(--info))]',
    warning: 'border-warning/25 bg-warning/[0.07] [--tone:hsl(var(--warning))]',
    danger: 'border-danger/25 bg-danger/[0.07] [--tone:hsl(var(--danger))]',
    success: 'border-success/25 bg-success/[0.07] [--tone:hsl(var(--success))]',
    yellow: 'border-accent-3/25 bg-accent-3/[0.07] [--tone:hsl(var(--accent-3))]',
  }
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', tones[tone], className)}
    >
      {icon && <span className="mt-0.5 shrink-0 text-[var(--tone)] [&>svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={cn('text-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
