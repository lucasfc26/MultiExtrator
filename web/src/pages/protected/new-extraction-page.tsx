import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Building2, Coins, Globe, Plus, Server, Smartphone, TriangleAlert, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { DemoBadge } from '@/components/ui/badge'
import { Alert, Skeleton } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/dialog'
import { EngineStatusPill } from '@/components/layout/engine-status'
import { CorporativoFormView, SegundaViaFormView, SiteEnelFormView } from '@/features/extractions/flow-forms'
import { ExtractionPanel } from '@/features/extractions/extraction-panel'
import { startExtraction } from '@/features/extractions/runner'
import { useBalance, useEngineHealth, useExtraction } from '@/features/queries'
import { userMessage } from '@/lib/api/errors'
import { ENGINE_LABEL } from '@/lib/engine'
import { config } from '@/lib/config'
import { formatNumber } from '@/lib/formatting'
import { FLUXO_LABEL, type EntradaPorFluxo, type Fluxo } from '@/types/engine'
import { cn } from '@/lib/utils/cn'
import { OPERATION_COSTS, estimate } from '@/config/pricing'

const FLOWS: { id: Fluxo; icon: typeof Globe; desc: string; tag: string }[] = [
  { id: 'site_enel', icon: Globe, desc: 'Login e senha da área do cliente.', tag: 'reCAPTCHA' },
  { id: 'corporativo', icon: Building2, desc: 'Agência Virtual, UC do agrupamento.', tag: 'sem captcha' },
  { id: 'segunda_via', icon: Smartphone, desc: 'UC + CPF/CNPJ e código enviado ao cliente.', tag: 'hCaptcha + OTP' },
]

type Pending = { [F in Fluxo]: { fluxo: F; entrada: EntradaPorFluxo[F] } }[Fluxo]

function refsOf(p: Pending): string[] {
  const e = p.entrada as unknown as Record<string, unknown>
  return (e.referencias as string[] | undefined) ?? (e.referencia ? [e.referencia as string] : [])
}

function resumo(p: Pending): [string, string][] {
  const e = p.entrada as unknown as Record<string, unknown>
  const refs = refsOf(p)
  const est = estimate('fatura', refs.length)
  return [
    ['Fluxo', FLUXO_LABEL[p.fluxo]],
    ...(e.usuario ? [['Login', String(e.usuario)] as [string, string]] : []),
    ['UC', (e.uc as string) || 'conta padrão do login'],
    ['Referências', refs.length ? refs.join(', ') : 'mês atual'],
    ['Motor', ENGINE_LABEL[config.engine]],
    ['Créditos estimados', `${est.min} a ${est.max}`],
  ]
}

function ActiveRun({ id }: { id: string }) {
  const { data, isPending } = useExtraction(id)
  if (isPending) return <Skeleton className="h-72 w-full rounded-[var(--radius-card)]" />
  if (!data) return <Alert tone="warning">Fatura não encontrada no histórico local.</Alert>
  return <ExtractionPanel record={data} compact />
}

export default function NewExtractionPage() {
  const [params, setParams] = useSearchParams()
  const activeId = params.get('id')
  const [fluxo, setFluxo] = useState<Fluxo>('site_enel')
  const [pending, setPending] = useState<Pending | null>(null)
  const balance = useBalance()
  const health = useEngineHealth()

  const start = useMutation({
    mutationFn: (p: Pending) => startExtraction(p.fluxo, p.entrada as never),
    onSuccess: (id) => {
      setPending(null)
      setParams({ id })
    },
  })

  const { min: custoMin, max: custoMax } = OPERATION_COSTS.fatura
  const saldo = balance.data?.available
  const semSaldo = saldo != null && saldo < custoMin
  const estPendente = pending ? estimate('fatura', refsOf(pending).length) : null
  const saldoCurto = saldo != null && estPendente != null && saldo < estPendente.max
  const saldoInsuficiente = saldo != null && estPendente != null && saldo < estPendente.min
  const formId = `form-${fluxo}`
  const onSubmit = <F extends Fluxo>(entrada: EntradaPorFluxo[F]) => setPending({ fluxo, entrada } as Pending)

  if (activeId)
    return (
      <>
        <PageHeader
          title="Acompanhamento da fatura"
          breadcrumbs={[{ label: 'Nova fatura', to: '/app/nova-fatura' }, { label: 'Acompanhamento' }]}
          actions={
            <>
              <ButtonLink to="/app/historico" variant="secondary">
                Ver histórico
              </ButtonLink>
              <Button icon={<Plus className="size-4" />} onClick={() => setParams({})}>
                Nova fatura
              </Button>
            </>
          }
        />
        <ActiveRun id={activeId} />
      </>
    )

  return (
    <>
      <PageHeader
        title="Nova fatura"
        description="Busque a fatura direto na ENEL: escolha o fluxo, informe os dados de acesso e acompanhe em tempo real."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <div role="radiogroup" aria-label="Fluxo da ENEL" className="grid gap-3 sm:grid-cols-3">
            {FLOWS.map((f) => {
              const on = fluxo === f.id
              return (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFluxo(f.id)}
                  className={cn(
                    'glass relative rounded-[var(--radius-card)] p-4 text-left transition-[border,box-shadow] duration-100',
                    on ? 'border-accent/50 shadow-[0_0_0_1px_hsl(var(--accent)/0.35),0_18px_40px_-20px_hsl(var(--accent)/0.6)]' : 'hover:border-line-strong',
                  )}
                >
                  {on && <span className="absolute inset-0 -z-10 rounded-[var(--radius-card)] bg-accent/[0.06]" />}
                  <div className="flex items-center justify-between">
                    <f.icon className={cn('size-5', on ? 'text-accent' : 'text-muted')} />
                    <span className="text-[11px] text-subtle">{f.tag}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-fg">{FLUXO_LABEL[f.id]}</p>
                  <p className="mt-1 text-[13px] text-muted">{f.desc}</p>
                </button>
              )
            })}
          </div>

          <GlassCard>
            <CardHeader
              title={`Dados para o ${FLUXO_LABEL[fluxo]}`}
              description={
                fluxo === 'segunda_via'
                  ? 'Depois do hCaptcha, a ENEL envia um código ao cliente. Você informa o código aqui, em até 10 minutos.'
                  : 'As credenciais vão direto para o servidor e não são guardadas neste navegador.'
              }
            />
            <CardBody>
              {fluxo === 'site_enel' && <SiteEnelFormView key="s" formId={formId} onSubmit={onSubmit} />}
              {fluxo === 'corporativo' && <CorporativoFormView key="c" formId={formId} onSubmit={onSubmit} />}
              {fluxo === 'segunda_via' && <SegundaViaFormView key="v" formId={formId} onSubmit={onSubmit} />}
            </CardBody>
          </GlassCard>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-24 xl:self-start">
          <GlassCard className="p-5">
            <p className="text-sm font-semibold text-fg">Antes de enviar</p>
            <dl className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted">
                  <Wallet className="size-4" /> Saldo atual
                </dt>
                <dd className="flex items-center gap-2 font-medium text-fg tabular-nums">
                  {balance.isPending ? <Skeleton className="h-4 w-10" /> : balance.isError ? '—' : formatNumber(balance.data.available)}
                  {balance.data?.demo && <DemoBadge />}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted">
                  <Coins className="size-4" /> Custo
                </dt>
                <dd className="text-right">
                  <span className="font-mono text-sm font-semibold text-fg tabular-nums">
                    {custoMin}–{custoMax}
                  </span>
                  <span className="block text-[11px] text-subtle">créditos por fatura (mês)</span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted">
                  <Server className="size-4" /> Motor
                </dt>
                <dd className="font-medium text-fg">{ENGINE_LABEL[config.engine]}</dd>
              </div>
            </dl>

            {semSaldo && (
              <Alert tone="warning" icon={<TriangleAlert />} className="mt-4" title="Sem créditos">
                Cada fatura usa de {custoMin} a {custoMax} créditos.{' '}
                <Link to="/app/creditos" className="text-accent hover:underline">
                  Comprar créditos
                </Link>
              </Alert>
            )}
            {health.data && !health.data.online && (
              <Alert tone="danger" icon={<TriangleAlert />} className="mt-4" title="Motor fora do ar">
                {health.data.detalhe}
              </Alert>
            )}
            {start.isError && (
              <Alert tone="danger" icon={<TriangleAlert />} className="mt-4">
                {userMessage(start.error)}
              </Alert>
            )}

            <Button type="submit" form={formId} size="lg" className="mt-5 w-full" disabled={semSaldo}>
              Buscar fatura
            </Button>
          </GlassCard>
          <EngineStatusPill />
        </aside>
      </div>

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && start.mutate(pending)}
        loading={start.isPending}
        tone="primary"
        title="Confirmar busca da fatura"
        description="Um navegador será aberto no servidor para acessar a ENEL com estes dados."
        confirmLabel="Buscar fatura"
        confirmDisabled={saldoInsuficiente}
      >
        {saldoInsuficiente ? (
          <Alert tone="danger" icon={<TriangleAlert />} className="mb-3" title="Saldo insuficiente">
            Esta busca usa pelo menos {estPendente?.min} créditos e o saldo é {saldo}.{' '}
            <Link to="/app/creditos" className="text-accent hover:underline">
              Comprar créditos
            </Link>
          </Alert>
        ) : (
          saldoCurto && (
            <Alert tone="warning" icon={<TriangleAlert />} className="mb-3">
              O saldo ({saldo}) pode não cobrir o máximo estimado ({estPendente?.max}). Meses sem saldo podem ficar de fora.
            </Alert>
          )
        )}
        {pending && (
          <dl className="divide-y divide-line rounded-xl border border-line text-sm">
            {resumo(pending).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate text-right font-medium text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </ConfirmDialog>
    </>
  )
}
