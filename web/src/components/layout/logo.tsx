import { useId } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'

/**
 * Símbolo da Fatturas: a folha laranja dentro de cantos de enquadramento, com
 * a linha do scanner no meio. Em hover (dentro de `.group`), a linha varre a folha.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const grad = `lg-${id}`
  const scan = `ls-${id}`
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--accent-2))" />
          <stop offset="0.55" stopColor="hsl(var(--accent))" />
          <stop offset="1" stopColor="hsl(var(--accent-strong))" />
        </linearGradient>
        <linearGradient id={scan} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(var(--accent-2))" stopOpacity="0" />
          <stop offset="0.5" stopColor="hsl(var(--accent-2))" />
          <stop offset="1" stopColor="hsl(var(--accent-2))" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* cantos do scanner */}
      <g fill="none" stroke={`url(#${grad})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9V5.5A2.5 2.5 0 0 1 5.5 3H9" />
        <path d="M23 3h3.5A2.5 2.5 0 0 1 29 5.5V9" />
        <path d="M3 23v3.5A2.5 2.5 0 0 0 5.5 29H9" />
        <path d="M29 23v3.5a2.5 2.5 0 0 1-2.5 2.5H23" />
      </g>

      {/* folha */}
      <path
        d="M10.5 7.5h7.5l4 4v13H10.5z"
        fill="hsl(var(--accent) / 0.14)"
        stroke={`url(#${grad})`}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M18 7.5v4h4" fill="none" stroke={`url(#${grad})`} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 19.5h5M13.5 22h3" stroke={`url(#${grad})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />

      {/* linha do scanner */}
      <g className="motion-safe:group-hover:animate-[logo-scan_1.4s_ease-in-out_infinite]">
        <rect x="2" y="13.8" width="28" height="4.4" rx="2.2" fill={`url(#${scan})`} opacity="0.45" />
        <path d="M2.5 16h27" stroke={`url(#${scan})`} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M9 16h14" stroke="hsl(48 100% 85%)" strokeWidth="1" strokeLinecap="round" opacity="0.9" />
      </g>
    </svg>
  )
}

export function Logo({ to = '/', collapsed, className }: { to?: string; collapsed?: boolean; className?: string }) {
  return (
    <Link to={to} className={cn('group flex items-center gap-2.5 rounded-lg', className)} aria-label="Fatturas — início">
      <LogoMark />
      {!collapsed && <span className="text-[16px] font-semibold tracking-tight text-fg">Fatturas</span>}
    </Link>
  )
}
