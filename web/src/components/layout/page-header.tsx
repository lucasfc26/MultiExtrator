import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
  badge,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: { label: string; to?: string }[]
  className?: string
  badge?: ReactNode
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Trilha" className="mb-2 flex items-center gap-1 text-[13px] text-subtle">
            {breadcrumbs.map((b, i) => (
              <span key={b.label} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-fg">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-muted">
                    {b.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
