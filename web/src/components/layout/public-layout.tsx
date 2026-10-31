import { useEffect, useState } from 'react'
import { prefetchPublic } from '@/app/route-loaders'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Gift, Menu, X } from 'lucide-react'
import { SIGNUP_BONUS_CREDITS } from '@/config/pricing'
import { Logo } from './logo'
import { ThemeToggle } from './theme-toggle'
import { ButtonLink } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

const LINKS = [
  { href: '/#funcionalidades', label: 'Funcionalidades' },
  { href: '/#como-funciona', label: 'Como funciona' },
  { href: '/#api', label: 'API' },
  { href: '/#precos', label: 'Preços' },
  { href: '/#faq', label: 'FAQ' },
]

const BONUS_KEY = 'me-bonus-banner-fechado'

/** Faixa do bônus de cadastro: some na própria página de cadastro e quando o visitante fecha. */
function BonusBanner() {
  const { pathname } = useLocation()
  const [fechado, setFechado] = useState(() => {
    try {
      return localStorage.getItem(BONUS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (fechado || pathname === '/cadastro') return null
  return (
    <div className="relative border-b border-accent/25 bg-[linear-gradient(90deg,hsl(var(--accent-strong)/0.16),hsl(var(--accent)/0.12),hsl(var(--accent-2)/0.16))] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-10 py-2 text-center text-[13px] text-fg">
        <Gift className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="hidden sm:inline">
          Crie sua conta e ganhe <b className="font-semibold text-accent">{SIGNUP_BONUS_CREDITS} créditos</b> para
          experimentar.
        </span>
        <Link to="/cadastro" className="truncate sm:hidden">
          <b className="font-semibold text-accent">+{SIGNUP_BONUS_CREDITS} créditos</b> ao criar sua conta →
        </Link>
        <Link
          to="/cadastro"
          className="hidden shrink-0 items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline sm:inline-flex"
        >
          Criar conta <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <button
        onClick={() => {
          setFechado(true)
          try {
            localStorage.setItem(BONUS_KEY, '1')
          } catch {
            /* sem armazenamento: fecha só nesta visita */
          }
        }}
        className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-fg/[0.08] hover:text-fg"
        aria-label="Fechar aviso"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function PublicNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <BonusBanner />
      <div className="px-3 pt-3 sm:px-6">
      <div
        className={cn(
          'mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-2xl border px-3 transition-[background,border-color,box-shadow] duration-200 ease-[var(--ease-out-soft)] sm:px-4',
          scrolled ? 'glass-strong border-line-strong' : 'border-transparent bg-transparent',
        )}
      >
        <Logo />
        <nav aria-label="Seções" className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <ThemeToggle />
          <ButtonLink to="/entrar" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Entrar
          </ButtonLink>
          <ButtonLink to="/cadastro" size="sm" className="hidden sm:inline-flex">
            Começar agora
          </ButtonLink>
          <button
            className="grid size-10 place-items-center rounded-lg text-muted hover:text-fg md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-strong mx-auto mt-2 flex max-w-6xl flex-col gap-1 rounded-2xl p-2 md:hidden"
          >
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-[15px] text-muted hover:bg-fg/[0.05] hover:text-fg"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-1 grid grid-cols-2 gap-2 border-t border-line pt-3">
              <ButtonLink to="/entrar" variant="secondary">
                Entrar
              </ButtonLink>
              <ButtonLink to="/cadastro">Começar agora</ButtonLink>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
      </div>
    </header>
  )
}

export function PublicFooter() {
  const cols = [
    {
      title: 'Produto',
      links: [
        { to: '/#funcionalidades', label: 'Funcionalidades' },
        { to: '/#precos', label: 'Preços' },
        { to: '/docs', label: 'Documentação da API' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { to: '/termos', label: 'Termos de uso' },
        { to: '/privacidade', label: 'Privacidade' },
        { to: '/retencao', label: 'Retenção de arquivos' },
      ],
    },
    {
      title: 'Ajuda',
      links: [
        { to: '/suporte', label: 'Suporte' },
        { to: '/contato', label: 'Contato comercial' },
      ],
    },
  ]
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">
            Faturas da ENEL em PDF e dados estruturados, pela interface ou por API.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="text-[13px] font-semibold text-fg">{c.title}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.to.startsWith('/#') ? (
                    <a href={l.to} className="text-sm text-muted hover:text-fg">
                      {l.label}
                    </a>
                  ) : (
                    <Link to={l.to} className="text-sm text-muted hover:text-fg">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-6 py-5 text-center text-xs text-subtle">
        © {new Date().getFullYear()} Fatturas. Não é afiliado à ENEL.
      </div>
    </footer>
  )
}

export function PublicLayout() {
  useEffect(prefetchPublic, [])
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <PublicNavbar />
      <Outlet />
      <PublicFooter />
    </div>
  )
}
