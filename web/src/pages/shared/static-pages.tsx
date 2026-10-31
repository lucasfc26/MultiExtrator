import { BookOpen, FileQuestion, LifeBuoy, Server } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard } from '@/components/ui/card'
import { ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/feedback/feedback'
import { EngineStatusPill } from '@/components/layout/engine-status'
import { SupportContent } from '@/pages/public/institutional-pages'

export function HelpPage() {
  return (
    <>
      <PageHeader
        title="Ajuda e suporte"
        actions={
          <ButtonLink to="/app/docs" variant="secondary" icon={<BookOpen className="size-4" />}>
            Documentação da API
          </ButtonLink>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <SupportContent />
        <div className="flex flex-col gap-4">
          <GlassCard className="p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <Server className="size-4" /> Diagnóstico
            </p>
            <p className="mt-1 text-[13px] text-muted">Estado do motor ao qual este painel está ligado.</p>
            <EngineStatusPill className="mt-4" />
          </GlassCard>
          <GlassCard className="p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <LifeBuoy className="size-4" /> Logs do extrator
            </p>
            <p className="mt-1 text-[13px] text-muted">
              No modo worker, abra uma busca de fatura em andamento e expanda "Logs do extrator".
            </p>
          </GlassCard>
        </div>
      </div>
    </>
  )
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-[70dvh] place-items-center px-6">
      <EmptyState
        icon={<FileQuestion />}
        title="Página não encontrada"
        description="O endereço pode ter mudado ou não existe."
        action={
          <>
            <ButtonLink to="/" variant="secondary">
              Início
            </ButtonLink>
            <ButtonLink to="/app">Ir para o painel</ButtonLink>
          </>
        }
      />
    </div>
  )
}
