import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from './app-sidebar'
import { AppHeader } from './app-header'
import { PageLoader } from '@/components/feedback/feedback'
import { config } from '@/lib/config'
import { FlaskConical } from 'lucide-react'
import { prefetchApp } from '@/app/route-loaders'

function DemoBanner() {
  if (!config.useMocks && config.engine !== 'mock') return null
  const partes = [
    config.useMocks && 'conta, créditos, pagamentos, API keys e notificações',
    config.engine === 'mock' && 'busca de faturas (simulador)',
  ].filter(Boolean)
  return (
    <div className="flex items-center justify-center gap-2 border-b border-success/20 bg-success/[0.08] px-4 py-1.5 text-center text-[12px] text-success">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>
        Ambiente de demonstração: {partes.join(' e ')} usam dados locais fictícios.
      </span>
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  useEffect(prefetchApp, [])
  return (
    <div className="relative flex min-h-dvh">
      <div className="bg-aurora pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <AppHeader />
        <main id="conteudo" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <Suspense fallback={<PageLoader />}>
            <div key={location.pathname} className="motion-safe:animate-[fade-in_120ms_ease-out]">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
