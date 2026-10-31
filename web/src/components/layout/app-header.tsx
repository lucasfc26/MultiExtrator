import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Coins, LogOut, Menu, Search, Settings, UserRound } from 'lucide-react'
import { ROUTE_TITLES } from '@/components/navigation/nav-items'
import { ThemeToggle } from './theme-toggle'
import { DemoBadge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/misc'
import { useLogout, useSession } from '@/features/auth/session'
import { useBalance, useUnreadCount } from '@/features/queries'
import { useUi } from '@/stores/ui'
import { formatNumber } from '@/lib/formatting'
import { cn } from '@/lib/utils/cn'

function titleFor(path: string) {
  if (ROUTE_TITLES[path]) return ROUTE_TITLES[path]
  const match = Object.keys(ROUTE_TITLES)
    .filter((k) => k !== '/app' && path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return match ? ROUTE_TITLES[match] : 'Fatturas'
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

function AccountMenu() {
  const { data: session } = useSession()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const user = session?.user
  if (!user) return null
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu da conta"
        className="grid size-9 place-items-center rounded-full bg-[linear-gradient(135deg,hsl(var(--accent-2)),hsl(var(--accent-strong)))] text-[13px] font-semibold text-white ring-2 ring-line-strong transition hover:ring-accent/50"
      >
        {initials(user.name) || <UserRound className="size-4" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass-strong absolute right-0 z-40 mt-2 w-64 origin-top-right rounded-xl p-1.5"
          >
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-sm font-medium text-fg">{user.name}</p>
              <p className="truncate text-xs text-subtle">{user.email}</p>
              {session.demo && <DemoBadge className="mt-2" label="Sessão demo" />}
            </div>
            {[
              { to: '/app/perfil', label: 'Perfil', icon: UserRound },
              { to: '/app/creditos', label: 'Créditos', icon: Coins },
              { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
            ].map((i) => (
              <Link
                key={i.to}
                to={i.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-fg/[0.05] hover:text-fg"
              >
                <i.icon className="size-4" /> {i.label}
              </Link>
            ))}
            <button
              role="menuitem"
              onClick={() => logout.mutate()}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-line px-3 py-2 text-sm text-muted hover:bg-danger/10 hover:text-danger"
            >
              <LogOut className="size-4" /> Sair
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AppHeader() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const setMobileOpen = useUi((s) => s.setMobileNavOpen)
  const unread = useUnreadCount()
  const balance = useBalance()
  const [q, setQ] = useState('')

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    navigate(`/app/historico?q=${encodeURIComponent(q.trim())}`)
    setQ('')
  }

  return (
    <header className="glass sticky top-0 z-20 backdrop-blur-md flex h-16 items-center gap-3 rounded-none border-x-0 border-t-0 px-4 sm:px-6">
      <button
        className="grid size-10 place-items-center rounded-lg text-muted hover:text-fg lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menu"
      >
        <Menu className="size-5" />
      </button>
      <p className="truncate text-[15px] font-semibold text-fg">{titleFor(pathname)}</p>

      <form onSubmit={onSearch} className="ml-auto hidden max-w-xs flex-1 md:block" role="search">
        <label className="relative block">
          <span className="sr-only">Buscar no histórico</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por UC, arquivo ou ID…"
            className="h-9 w-full rounded-lg border border-line bg-fg/[0.03] pr-3 pl-9 text-[13px] text-fg placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent/10 focus:outline-none"
          />
        </label>
      </form>

      <div className={cn('flex items-center gap-1.5', 'ml-auto md:ml-0')}>
        <Link
          to="/app/creditos"
          className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-fg/[0.03] px-3 text-[13px] font-medium text-fg hover:border-line-strong sm:flex"
          aria-label="Saldo de créditos"
        >
          <Coins className="size-4 text-accent-2" />
          {balance.isPending ? <Skeleton className="h-4 w-8" /> : balance.isError ? '—' : formatNumber(balance.data.available)}
          {balance.data?.demo && <span className="text-[10px] font-semibold tracking-wide text-success uppercase">demo</span>}
        </Link>
        <ThemeToggle />
        <Link
          to="/app/notificacoes"
          className="relative grid size-10 place-items-center rounded-lg text-muted hover:bg-fg/[0.06] hover:text-fg"
          aria-label={unread ? `Notificações: ${unread} não lidas` : 'Notificações'}
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute top-2 right-2 size-2 rounded-full bg-accent ring-2 ring-[hsl(var(--bg))]" />
          )}
        </Link>
        <AccountMenu />
      </div>
    </header>
  )
}
