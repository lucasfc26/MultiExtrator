import { NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { NAV_SECTIONS } from '@/components/navigation/nav-items'
import { Logo } from './logo'
import { EngineStatusPill } from './engine-status'
import { usePreferences } from '@/stores/preferences'
import { useUi } from '@/stores/ui'
import { useUnreadCount } from '@/features/queries'
import { cn } from '@/lib/utils/cn'

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const unread = useUnreadCount()
  return (
    <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-subtle uppercase">{section.title}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive ? 'text-fg' : 'text-muted hover:bg-fg/[0.04] hover:text-fg',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute inset-0 rounded-[10px] border border-line-strong bg-fg/[0.06]" />
                      )}
                      {isActive && (
                        <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[linear-gradient(hsl(var(--accent-2)),hsl(var(--accent-strong)))]" />
                      )}
                      <item.icon className={cn('relative size-[18px] shrink-0', isActive && 'text-accent')} aria-hidden />
                      {!collapsed && <span className="relative truncate">{item.label}</span>}
                      {item.to === '/app/notificacoes' && unread > 0 && (
                        <span
                          className={cn(
                            'relative ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums',
                            collapsed && 'absolute top-1 right-1.5 ml-0 size-2 p-0 text-[0px]',
                          )}
                          aria-label={`${unread} não lidas`}
                        >
                          {unread}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AppSidebar() {
  const collapsed = usePreferences((s) => s.sidebarCollapsed)
  const setCollapsed = usePreferences((s) => s.setSidebarCollapsed)
  const mobileOpen = useUi((s) => s.mobileNavOpen)
  const setMobileOpen = useUi((s) => s.setMobileNavOpen)

  return (
    <>
      <aside
        className={cn(
          'glass sticky top-0 z-30 hidden h-dvh shrink-0 flex-col rounded-none border-y-0 border-l-0 transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:flex',
          collapsed ? 'w-[76px]' : 'w-[264px]',
        )}
      >
        <div className={cn('flex h-16 items-center border-b border-line px-5', collapsed && 'justify-center px-0')}>
          <Logo to="/app" collapsed={collapsed} />
        </div>
        <NavList collapsed={collapsed} />
        <div className={cn('flex flex-col gap-2 border-t border-line p-3', collapsed && 'items-center')}>
          {!collapsed && <EngineStatusPill />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] text-subtle hover:bg-fg/[0.04] hover:text-fg"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && 'Recolher'}
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-[hsl(0_0%_2%/0.72)] backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="glass-strong absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col rounded-none border-y-0 border-l-0"
              aria-label="Menu"
            >
              <div className="flex h-16 items-center justify-between border-b border-line px-5">
                <Logo to="/app" />
                <button
                  onClick={() => setMobileOpen(false)}
                  className="grid size-10 place-items-center rounded-lg text-muted hover:text-fg"
                  aria-label="Fechar menu"
                >
                  <X className="size-5" />
                </button>
              </div>
              <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
              <div className="border-t border-line p-3">
                <EngineStatusPill />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
