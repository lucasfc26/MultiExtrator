import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertOctagon,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Coins,
  FilePlus2,
  KeyRound,
  Layers,
  Loader,
  ScanText,
  ShoppingCart,
  TrendingDown,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { ButtonLink } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/form'
import { Skeleton, SkeletonRows } from '@/components/ui/misc'
import { StatCard } from '@/components/data-display/stat-card'
import { StatusBadge } from '@/components/data-display/status-badge'
import { DataTable } from '@/components/data-display/data-table'
import { EmptyState, ErrorState } from '@/components/feedback/feedback'
import { useAllHistory, useBalance, useTransactions } from '@/features/queries'
import { useSession } from '@/features/auth/session'
import { creditEstimate } from '@/features/extractions/exports'
import { loaders } from '@/app/route-loaders'
import { formatDate, formatNumber } from '@/lib/formatting'
import { FLUXO_LABEL } from '@/types/engine'
import type { ExtractionRecord } from '@/types/extraction'

const Charts = {
  Volume: lazy(() => loaders.charts().then((m) => ({ default: m.VolumeChart }))),
  Credits: lazy(() => loaders.charts().then((m) => ({ default: m.CreditsChart }))),
  Status: lazy(() => loaders.charts().then((m) => ({ default: m.StatusChart }))),
}

type Periodo = '7' | '30' | '90'

const dia = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

function buckets(dias: number) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(hoje)
    d.setDate(d.getDate() - (dias - 1 - i))
    return d
  })
}

function useStats(records: ExtractionRecord[] | undefined, dias: number, now: number) {
  return useMemo(() => {
    const desde = now - dias * 86_400_000
    const rs = (records ?? []).filter((r) => new Date(r.criadoEm).getTime() >= desde)
    const count = (f: (r: ExtractionRecord) => boolean) => rs.filter(f).length
    const ok = (r: ExtractionRecord) => r.uiStatus === 'success' || r.uiStatus === 'warning'
    const live = (r: ExtractionRecord) => ['pending', 'queued', 'processing', 'awaiting_code'].includes(r.uiStatus)
    const fail = (r: ExtractionRecord) => r.uiStatus === 'failed' || r.uiStatus === 'cancelled'
    const bs = buckets(dias)
    const volume = bs.map((d) => {
      const doDia = rs.filter((r) => new Date(r.criadoEm).toDateString() === d.toDateString())
      return { dia: dia(d), concluidas: doDia.filter(ok).length, falhas: doDia.filter(fail).length }
    })
    const status = [
      { name: 'Concluídas', value: count((r) => r.uiStatus === 'success'), color: 'hsl(var(--success))' },
      { name: 'Com atenção', value: count((r) => r.uiStatus === 'warning'), color: 'hsl(var(--warning))' },
      { name: 'Falhas', value: count(fail), color: 'hsl(var(--danger))' },
      { name: 'Em andamento', value: count(live), color: 'hsl(var(--accent))' },
    ].filter((s) => s.value > 0)
    return { total: rs.length, ok: count(ok), live: count(live), fail: count(fail), volume, status }
  }, [records, dias, now])
}

export default function DashboardPage() {
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const dias = Number(periodo)
  const navigate = useNavigate()
  const { data: session } = useSession()
  const history = useAllHistory()
  const balance = useBalance()
  const txs = useTransactions({ type: 'consumption', pageSize: 100 })
  // Referência de "agora" fixa na montagem: mantém o render puro.
  const [now] = useState(() => Date.now())
  const s = useStats(history.data, dias, now)

  const consumo = useMemo(() => {
    const desde = now - dias * 86_400_000
    const items = (txs.data?.items ?? []).filter((t) => new Date(t.createdAt).getTime() >= desde)
    const total = -items.reduce((acc, t) => acc + t.credits, 0)
    const bs = buckets(Math.min(dias, 14))
    const serie = bs.map((d) => ({
      dia: dia(d),
      creditos: -items.filter((t) => new Date(t.createdAt).toDateString() === d.toDateString()).reduce((a, t) => a + t.credits, 0),
    }))
    return { total, serie }
  }, [txs.data, dias, now])

  const recentes = history.data?.slice(0, 6) ?? []
  const firstName = session?.user.name.split(' ')[0]

  return (
    <>
      <PageHeader
        title={firstName ? `Olá, ${firstName}` : 'Visão geral'}
        description="Resumo das suas faturas, extrações e consumo de créditos."
        actions={
          <>
            <SegmentedControl
              label="Período"
              value={periodo}
              onChange={setPeriodo}
              options={[
                { value: '7', label: '7 dias' },
                { value: '30', label: '30 dias' },
                { value: '90', label: '90 dias' },
              ]}
            />
            <ButtonLink to="/app/nova-fatura" icon={<FilePlus2 className="size-4" />}>
              Nova fatura
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Saldo de créditos"
          icon={<Coins />}
          tone="cyan"
          loading={balance.isPending}
          value={balance.isError ? '—' : formatNumber(balance.data?.available)}
          badge={balance.data?.demo && <DemoBadge />}
        />
        <StatCard label="Requisições" icon={<Layers />} loading={history.isPending} value={formatNumber(s.total)} hint={`Últimos ${dias} dias`} />
        <StatCard label="Concluídas" icon={<CheckCircle2 />} tone="success" loading={history.isPending} value={formatNumber(s.ok)} hint="Inclui com atenção" />
        <StatCard label="Em andamento" icon={<Loader />} tone="accent" loading={history.isPending} value={formatNumber(s.live)} />
        <StatCard label="Com falha" icon={<AlertOctagon />} tone="danger" loading={history.isPending} value={formatNumber(s.fail)} />
        <StatCard
          label="Créditos consumidos"
          icon={<TrendingDown />}
          tone="yellow"
          loading={txs.isPending}
          value={txs.isError ? '—' : formatNumber(consumo.total)}
          badge={balance.data?.demo && <DemoBadge />}
          hint={`Últimos ${dias} dias`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <GlassCard>
          <CardHeader title="Volume de requisições" description="Concluídas e com falha por dia" />
          <CardBody className="pt-4">
            {history.isPending ? (
              <Skeleton className="h-[240px] w-full" />
            ) : history.isError ? (
              <ErrorState error={history.error} onRetry={() => history.refetch()} />
            ) : s.total === 0 ? (
              <EmptyState icon={<Activity />} title="Sem faturas no período" className="py-10" />
            ) : (
              <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
                <Charts.Volume data={s.volume} />
              </Suspense>
            )}
          </CardBody>
        </GlassCard>
        <GlassCard>
          <CardHeader title="Distribuição de status" />
          <CardBody>
            {history.isPending ? (
              <Skeleton className="h-[160px] w-full" />
            ) : s.total === 0 ? (
              <EmptyState icon={<Activity />} title="Sem dados" className="py-10" />
            ) : (
              <Suspense fallback={<Skeleton className="h-[160px] w-full" />}>
                <Charts.Status data={s.status} />
              </Suspense>
            )}
          </CardBody>
        </GlassCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <GlassCard>
          <CardHeader
            title="Últimas requisições"
            action={
              <Link to="/app/historico" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                Ver todas <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          <div className="mt-3">
            {history.isPending ? (
              <SkeletonRows rows={4} className="px-6 pb-6" />
            ) : recentes.length === 0 ? (
              <EmptyState
                icon={<FilePlus2 />}
                title="Nenhuma fatura ainda"
                description="Comece pela Enel, Corporativo ou 2 VIA."
                action={<ButtonLink to="/app/nova-fatura">Buscar a primeira</ButtonLink>}
              />
            ) : (
              <DataTable
                caption="Últimas requisições"
                rows={recentes}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(`/app/historico/${r.id}`)}
                columns={[
                  {
                    key: 'arq',
                    header: 'Arquivo',
                    cell: (r) => (
                      <span className="block max-w-[240px] truncate text-fg">
                        {r.arquivos[0]?.nome ?? `${FLUXO_LABEL[r.fluxo]}${r.uc ? ` · UC ${r.uc}` : ''}`}
                      </span>
                    ),
                  },
                  { key: 'data', header: 'Data', cell: (r) => formatDate(r.criadoEm) },
                  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.uiStatus} /> },
                  {
                    key: 'cred',
                    header: 'Créditos',
                    cell: (r) => <span className="font-mono text-xs tabular-nums" title={creditEstimate(r).hint}>{creditEstimate(r).label}</span>,
                    hideOnMobile: true,
                  },
                  {
                    key: 'ver',
                    header: <span className="sr-only">Ação</span>,
                    cell: () => <span className="text-[13px] font-medium text-accent">Detalhes</span>,
                    hideOnMobile: true,
                  },
                ]}
              />
            )}
          </div>
        </GlassCard>

        <div className="flex flex-col gap-6">
          <GlassCard>
            <CardHeader title="Consumo de créditos" action={balance.data?.demo && <DemoBadge />} />
            <CardBody className="pt-4">
              {txs.isPending ? (
                <Skeleton className="h-[200px] w-full" />
              ) : txs.isError ? (
                <ErrorState error={txs.error} onRetry={() => txs.refetch()} />
              ) : (
                <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
                  <Charts.Credits data={consumo.serie} />
                </Suspense>
              )}
            </CardBody>
          </GlassCard>
          <GlassCard className="p-2">
            <nav aria-label="Atalhos" className="grid grid-cols-2 gap-1">
              {[
                { to: '/app/nova-fatura', label: 'Nova fatura', icon: FilePlus2 },
                { to: '/app/extrator', label: 'Extrator', icon: ScanText },
                { to: '/app/creditos', label: 'Comprar créditos', icon: ShoppingCart },
                { to: '/app/api', label: 'API keys', icon: KeyRound },
                { to: '/app/docs', label: 'Documentação', icon: BookOpen },
              ].map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="group flex items-center gap-3 rounded-xl p-3 text-sm font-medium text-muted transition-colors hover:bg-fg/[0.04] hover:text-fg"
                >
                  <span className="grid size-9 place-items-center rounded-lg border border-line bg-fg/[0.03] text-accent group-hover:border-accent/30">
                    <a.icon className="size-4" />
                  </span>
                  {a.label}
                </Link>
              ))}
            </nav>
          </GlassCard>
        </div>
      </div>
    </>
  )
}
