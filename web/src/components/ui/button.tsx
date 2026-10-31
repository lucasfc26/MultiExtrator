import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const base =
  'relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none rounded-[var(--radius-control)] transition-[background,color,border,box-shadow,transform] duration-150 ease-[var(--ease-out-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]'

const variants: Record<ButtonVariant, string> = {
  primary:
    'text-white border border-white/20 bg-[linear-gradient(135deg,hsl(var(--accent))_0%,hsl(var(--accent-strong))_100%)] shadow-[0_4px_14px_hsl(var(--accent-strong)/0.35),inset_0_1px_0_hsl(0_0%_100%/0.25)] hover:shadow-[0_6px_20px_hsl(var(--accent)/0.45),inset_0_1px_0_hsl(0_0%_100%/0.25)] hover:brightness-110',
  secondary: 'bg-fg/[0.05] text-fg border border-line-strong hover:bg-fg/[0.08] hover:border-accent/40',
  outline: 'border border-line-strong text-fg hover:bg-fg/[0.05]',
  ghost: 'text-muted hover:text-fg hover:bg-fg/[0.06]',
  danger: 'bg-danger/90 text-white hover:bg-danger shadow-[0_8px_24px_-12px_hsl(var(--danger)/0.8)]',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
  icon: 'h-10 w-10 p-0',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  icon,
  children,
  ...props
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  )
}
