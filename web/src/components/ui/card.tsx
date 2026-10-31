import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export function GlassCard({
  className,
  strong,
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { strong?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        strong ? 'glass-strong' : 'glass',
        'rounded-[var(--radius-card)]',
        interactive &&
          'transition-[transform,border-color,box-shadow] duration-150 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-line-strong',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />
}
