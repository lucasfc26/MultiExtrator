import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertOctagon, CheckCircle2, Info, RotateCw, TriangleAlert, X } from 'lucide-react'
import { useToasts, type ToastTone } from '@/stores/toast'
import { userMessage } from '@/lib/api/errors'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'

const toastIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-success" />,
  error: <AlertOctagon className="size-4 text-danger" />,
  info: <Info className="size-4 text-info" />,
  warning: <TriangleAlert className="size-4 text-warning" />,
}

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            className="glass-strong pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl p-3.5"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="mt-0.5">{toastIcon[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] break-words text-muted">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg" aria-label="Fechar aviso">
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-xl" aria-hidden />
        <div className="relative grid size-14 place-items-center rounded-2xl border border-line-strong bg-fg/[0.04] text-accent [&>svg]:size-6">
          {icon}
        </div>
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  title = 'Não foi possível carregar',
  onRetry,
  className,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-danger/25 bg-danger/10 text-danger">
        <AlertOctagon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted">{userMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry} icon={<RotateCw className="size-3.5" />}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-label="Carregando página">
      <div className="flex items-center gap-2 text-sm text-subtle">
        <span className="size-1.5 animate-[pulse-dot_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
        <span className="size-1.5 animate-[pulse-dot_1.2s_ease-in-out_0.2s_infinite] rounded-full bg-accent-2" />
        <span className="size-1.5 animate-[pulse-dot_1.2s_ease-in-out_0.4s_infinite] rounded-full bg-accent-3" />
      </div>
    </div>
  )
}
