import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils/cn'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const focusables = () =>
      el
        ? Array.from(
            el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
          ).filter((x) => !x.hasAttribute('disabled'))
        : []
    requestAnimationFrame(() => (focusables()[0] ?? el)?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[hsl(0_0%_2%/0.72)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'glass-strong relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[var(--radius-card)] sm:rounded-[var(--radius-card)]',
              { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size],
            )}
          >
            <div className="flex items-start justify-between gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
              <div>
                <h2 id={titleId} className="text-base font-semibold text-fg">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1.5 text-sm text-muted">
                    {description}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon" className="-mt-2 -mr-2 size-9" onClick={onClose} aria-label="Fechar">
                <X className="size-4" />
              </Button>
            </div>
            {children && <div className="p-5 sm:p-6">{children}</div>}
            {footer && (
              <div className="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end sm:px-6">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  loading,
  confirmDisabled,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  confirmDisabled?: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          {tone === 'danger' && <AlertTriangle className="size-4 text-danger" aria-hidden />}
          {title}
        </span>
      }
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
