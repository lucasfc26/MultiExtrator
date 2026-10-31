import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { usePreferences } from '@/stores/preferences'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  /** Esconde no layout de cartões (celular). */
  hideOnMobile?: boolean
  /** Rótulo no layout de cartões. */
  mobileLabel?: string
}

/**
 * Tabela que vira lista de cartões abaixo de `md`. Linhas clicáveis são
 * acessíveis por teclado (Enter).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
  className,
  mobileTitle,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  caption?: string
  className?: string
  mobileTitle?: (row: T) => ReactNode
}) {
  const compact = usePreferences((s) => s.compactTables)
  return (
    <div className={className}>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line text-xs tracking-wide text-subtle uppercase">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3 font-medium first:pl-6 last:pr-6', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/70 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-fg/[0.03] focus-visible:bg-fg/[0.04] focus-visible:outline-none',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-4 text-muted first:pl-6 last:pr-6', compact ? 'py-2' : 'py-3.5', c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              className={cn('flex flex-col gap-2 px-5 py-4', onRowClick && 'active:bg-fg/[0.04]')}
            >
              {mobileTitle && <div className="text-sm font-medium text-fg">{mobileTitle(row)}</div>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                {columns
                  .filter((c) => !c.hideOnMobile)
                  .map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[11px] tracking-wide text-subtle uppercase">
                        {c.mobileLabel ?? (typeof c.header === 'string' ? c.header : c.key)}
                      </dt>
                      <dd className="truncate text-muted">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  className,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  className?: string
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav
      aria-label="Paginação"
      className={cn('flex items-center justify-between gap-4 border-t border-line px-5 py-3 sm:px-6', className)}
    >
      <p className="text-[13px] text-subtle tabular-nums">
        {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 text-[13px] text-muted tabular-nums" aria-current="page">
          {page} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  )
}
