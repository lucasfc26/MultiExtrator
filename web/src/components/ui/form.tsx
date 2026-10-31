import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const control =
  'w-full rounded-[var(--radius-control)] border border-line bg-fg/[0.03] px-3.5 text-sm text-fg placeholder:text-subtle transition-[border,box-shadow,background] duration-200 hover:border-line-strong focus:border-accent/60 focus:bg-fg/[0.05] focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50 aria-[invalid=true]:border-danger/60 aria-[invalid=true]:focus:ring-danger/15'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-11', className)} {...props} />
})

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className, ...props }, ref) {
    const [show, setShow] = useState(false)
    return (
      <div className="relative">
        <Input ref={ref} type={show ? 'text' : 'password'} className={cn('pr-11', className)} {...props} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[var(--radius-control)] text-subtle hover:text-fg"
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, 'min-h-24 py-2.5', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        'h-11 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2394a3b8%27%20stroke-width=%272%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10 [&>option]:bg-elevated',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-[13px] font-medium text-fg/90', className)}>
      {children}
    </label>
  )
}

/** Rótulo + controle + ajuda + erro, com ids e aria ligados. */
export function FormField({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  optional?: boolean
  className?: string
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs text-subtle">opcional</span>}
      </div>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Checkbox({
  className,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-muted', className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-[hsl(var(--accent))]"
        {...props}
      />
      <span>{label}</span>
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50',
          checked ? 'border-accent/50 bg-accent' : 'border-line-strong bg-fg/10',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white shadow transition-transform duration-150 ease-[var(--ease-out-soft)]',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  )
}

/** Grupo de opções em "pílulas" (radio acessível). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-xl border border-line bg-fg/[0.03] p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-fg/[0.1] text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
