import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Barcode,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  ExternalLink,
  Loader,
  QrCode,
  RotateCcw,
  TriangleAlert,
  Wallet,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { Badge, DemoBadge, type BadgeTone } from '@/components/ui/badge'
import { Select } from '@/components/ui/form'
import { Alert, CopyButton, Skeleton, SkeletonRows } from '@/components/ui/misc'
import { DataTable, Pagination } from '@/components/data-display/data-table'
import { StatCard } from '@/components/data-display/stat-card'
import { EmptyState, ErrorState } from '@/components/feedback/feedback'
import { useBalance, usePackages, useTransactions } from '@/features/queries'
import { creditsService } from '@/lib/api/services/credits.service'
import { userMessage } from '@/lib/api/errors'
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatting'
import { qk } from '@/app/query-client'
import { OPERATION_COSTS, formatUnitPrice, savingsVsBase } from '@/config/pricing'
import { cn } from '@/lib/utils/cn'
import type { CreditPackage, CreditTxStatus, CreditTxType, PaymentMethod, PaymentState } from '@/types/platform'

const TX_TYPE: Record<CreditTxType, string> = {
  purchase: 'Compra',
  consumption: 'Consumo',
  reservation: 'Reserva',
  release: 'Liberação',
  refund: 'Estorno',
  adjustment: 'Ajuste',
}
const TX_STATUS: Record<CreditTxStatus, { label: string; tone: BadgeTone }> = {
  confirmed: { label: 'Confirmada', tone: 'success' },
  pending: { label: 'Pendente', tone: 'info' },
  failed: { label: 'Falhou', tone: 'danger' },
  reversed: { label: 'Estornada', tone: 'neutral' },
}

export function CreditPackageCard({ pkg, onBuy }: { pkg: CreditPackage; onBuy: () => void }) {
  return (
    <GlassCard
      interactive
      strong={pkg.highlighted}
      className={cn('relative flex flex-col p-6', pkg.highlighted && 'border-accent/40')}
    >
      {pkg.highlighted && (
        <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">
          Mais escolhido
        </span>
      )}
      <p className="text-sm font-medium text-muted">{pkg.name}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-fg">{formatNumber(pkg.credits)}</p>
      <p className="text-[13px] text-subtle">créditos</p>
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-lg font-semibold text-fg">{formatCurrency(pkg.priceCents)}</span>
        <span className="text-xs text-subtle">{formatUnitPrice(pkg)}/crédito</span>
      </div>
      {savingsVsBase(pkg) > 0 && <p className="mt-1 text-right text-xs font-medium text-success">−{savingsVsBase(pkg)}% por crédito</p>}
      <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px] text-muted">
        {pkg.benefits.map((b) => (
          <li key={b} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-accent-2" /> {b}
          </li>
        ))}
      </ul>
      <Button variant={pkg.highlighted ? 'primary' : 'secondary'} className="mt-6 w-full" onClick={onBuy}>
        Comprar
      </Button>
    </GlassCard>
  )
}

export function CreditsPage() {
  const navigate = useNavigate()
  const balance = useBalance()
  const packages = usePackages()
  const [type, setType] = useState<CreditTxType | 'all'>('all')
  const [page, setPage] = useState(1)
  const txs = useTransactions({ type, page, pageSize: 8 })
  const demo = balance.data?.demo

  return (
    <>
      <PageHeader
        title="Créditos"
        description="Saldo, compras e movimentações da sua carteira."
        badge={demo && <DemoBadge label="Dados demonstrativos" />}
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
        <GlassCard strong className="relative overflow-hidden p-6">
          <div className="absolute -top-20 -right-16 size-56 rounded-full bg-accent/25 blur-3xl" aria-hidden />
          <div className="relative">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Wallet className="size-4" /> Saldo disponível
            </p>
            {balance.isPending ? (
              <Skeleton className="mt-3 h-12 w-40" />
            ) : balance.isError ? (
              <ErrorState error={balance.error} className="py-4" onRetry={() => balance.refetch()} />
            ) : (
              <>
                <p className="mt-2 text-5xl font-semibold tracking-tight text-fg tabular-nums">{formatNumber(balance.data.available)}</p>
                <p className="mt-1 text-sm text-subtle">
                  créditos{balance.data.reserved > 0 && ` · ${formatNumber(balance.data.reserved)} reservados`}
                </p>
              </>
            )}
          </div>
        </GlassCard>
        <StatCard label="Comprados" icon={<ArrowDownLeft />} tone="success" loading={balance.isPending} value={formatNumber(balance.data?.purchased)} />
        <StatCard label="Consumidos" icon={<ArrowUpRight />} tone="yellow" loading={balance.isPending} value={formatNumber(balance.data?.consumed)} />
      </div>

      <section className="mt-10" aria-labelledby="pacotes">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="pacotes" className="text-lg font-semibold text-fg">
              Comprar créditos
            </h2>
            <p className="text-sm text-muted">O saldo só muda depois que o pagamento é confirmado pelo servidor.</p>
          </div>
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {Object.values(OPERATION_COSTS).map((op) => (
            <div key={op.label} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-fg/[0.02] px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{op.label}</p>
                <p className="text-[13px] text-muted">{op.desc}</p>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-accent tabular-nums">
                {op.min}–{op.max} créditos
              </span>
            </div>
          ))}
        </div>
        {packages.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-80 rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : packages.isError ? (
          <GlassCard>
            <ErrorState error={packages.error} onRetry={() => packages.refetch()} />
          </GlassCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {packages.data.map((p) => (
              <CreditPackageCard key={p.id} pkg={p} onBuy={() => navigate(`/app/creditos/comprar/${p.id}`)} />
            ))}
          </div>
        )}
      </section>

      <GlassCard className="mt-10">
        <CardHeader
          title="Histórico financeiro"
          action={
            <Select
              aria-label="Tipo de movimentação"
              value={type}
              onChange={(e) => {
                setType(e.target.value as CreditTxType | 'all')
                setPage(1)
              }}
              className="h-9 w-44"
            >
              <option value="all">Todos os tipos</option>
              {Object.entries(TX_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          }
        />
        <div className="mt-4">
          {txs.isPending ? (
            <SkeletonRows className="px-6 pb-6" />
          ) : txs.isError ? (
            <ErrorState error={txs.error} onRetry={() => txs.refetch()} />
          ) : txs.data.total === 0 ? (
            <EmptyState icon={<Coins />} title="Sem movimentações" description="Compras e consumos aparecem aqui." />
          ) : (
            <>
              <DataTable
                caption="Movimentações de créditos"
                rows={txs.data.items}
                rowKey={(t) => t.id}
                mobileTitle={(t) => t.description}
                columns={[
                  { key: 'data', header: 'Data', cell: (t) => formatDate(t.createdAt) },
                  { key: 'desc', header: 'Descrição', cell: (t) => <span className="text-fg">{t.description}</span>, hideOnMobile: true },
                  { key: 'tipo', header: 'Tipo', cell: (t) => TX_TYPE[t.type] },
                  {
                    key: 'cred',
                    header: 'Créditos',
                    cell: (t) => (
                      <span className={cn('font-medium tabular-nums', t.credits >= 0 ? 'text-success' : 'text-fg')}>
                        {t.credits > 0 ? '+' : ''}
                        {formatNumber(t.credits)}
                      </span>
                    ),
                  },
                  { key: 'valor', header: 'Valor', cell: (t) => (t.amountCents != null ? formatCurrency(t.amountCents) : '—') },
                  { key: 'status', header: 'Status', cell: (t) => <Badge tone={TX_STATUS[t.status].tone}>{TX_STATUS[t.status].label}</Badge> },
                  { key: 'ref', header: 'Referência', cell: (t) => <code className="font-mono text-xs">{t.reference}</code>, hideOnMobile: true },
                ]}
              />
              <Pagination page={txs.data.page} totalPages={txs.data.totalPages} total={txs.data.total} pageSize={txs.data.pageSize} onPage={setPage} />
            </>
          )}
        </div>
      </GlassCard>
    </>
  )
}

const METHODS: { id: PaymentMethod; label: string; desc: string; icon: typeof QrCode }[] = [
  { id: 'pix', label: 'PIX', desc: 'Confirmação em segundos', icon: QrCode },
  { id: 'card', label: 'Cartão de crédito', desc: 'Checkout seguro do provedor', icon: CreditCard },
  { id: 'boleto', label: 'Boleto', desc: 'Compensação em até 3 dias úteis', icon: Barcode },
]

export function CheckoutPage() {
  const { packageId } = useParams()
  const navigate = useNavigate()
  const packages = usePackages()
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const pkg = packages.data?.find((p) => p.id === packageId)
  const create = useMutation({
    mutationFn: () => creditsService.createOrder(packageId!, method),
    onSuccess: (o) => navigate(`/app/creditos/pagamento/${o.id}`, { replace: true }),
  })

  return (
    <>
      <PageHeader title="Checkout" breadcrumbs={[{ label: 'Créditos', to: '/app/creditos' }, { label: 'Checkout' }]} />
      {packages.isPending ? (
        <Skeleton className="h-80 w-full rounded-[var(--radius-card)]" />
      ) : packages.isError ? (
        <ErrorState error={packages.error} onRetry={() => packages.refetch()} />
      ) : !pkg ? (
        <GlassCard>
          <EmptyState icon={<Coins />} title="Pacote não encontrado" action={<ButtonLink to="/app/creditos">Ver pacotes</ButtonLink>} />
        </GlassCard>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <GlassCard>
            <CardHeader title="Forma de pagamento" description="Os dados de pagamento são tratados pelo provedor. Nada de cartão passa por aqui." />
            <CardBody>
              <div role="radiogroup" aria-label="Forma de pagamento" className="flex flex-col gap-3">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={method === m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'flex items-center gap-4 rounded-xl border p-4 text-left transition-colors',
                      method === m.id ? 'border-accent/50 bg-accent/[0.06]' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="grid size-10 place-items-center rounded-lg bg-fg/[0.05] text-accent">
                      <m.icon className="size-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-fg">{m.label}</span>
                      <span className="block text-[13px] text-muted">{m.desc}</span>
                    </span>
                    <span
                      className={cn('grid size-5 place-items-center rounded-full border', method === m.id ? 'border-accent bg-accent' : 'border-line-strong')}
                    >
                      {method === m.id && <Check className="size-3 text-white" />}
                    </span>
                  </button>
                ))}
              </div>
            </CardBody>
          </GlassCard>
          <GlassCard strong className="self-start p-6">
            <p className="text-sm text-muted">Resumo</p>
            <p className="mt-2 text-lg font-semibold text-fg">Pacote {pkg.name}</p>
            <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Créditos</dt>
                <dd className="text-fg tabular-nums">{formatNumber(pkg.credits)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Valor</dt>
                <dd className="text-fg">{formatCurrency(pkg.priceCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Taxas</dt>
                <dd className="text-subtle">definidas pelo provedor</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-line pt-3 text-base font-semibold">
                <dt className="text-fg">Total</dt>
                <dd className="text-fg">{formatCurrency(pkg.priceCents)}</dd>
              </div>
            </dl>
            {create.isError && (
              <Alert tone="danger" icon={<TriangleAlert />} className="mt-4">
                {userMessage(create.error)}
              </Alert>
            )}
            <Button size="lg" className="mt-6 w-full" loading={create.isPending} onClick={() => create.mutate()}>
              Continuar para pagamento
            </Button>
          </GlassCard>
        </div>
      )}
    </>
  )
}

const PAY_STATE: Record<PaymentState, { label: string; tone: BadgeTone; icon: typeof Clock; text: string }> = {
  awaiting_payment: { label: 'Aguardando pagamento', tone: 'info', icon: Clock, text: 'Assim que o provedor confirmar, os créditos entram no saldo.' },
  processing: { label: 'Processando', tone: 'accent', icon: Loader, text: 'O provedor está processando o pagamento.' },
  confirmed: { label: 'Confirmado', tone: 'success', icon: CheckCircle2, text: 'Pagamento confirmado. Os créditos já estão no saldo.' },
  declined: { label: 'Recusado', tone: 'danger', icon: XCircle, text: 'O pagamento foi recusado. Tente outro meio de pagamento.' },
  expired: { label: 'Expirado', tone: 'neutral', icon: Clock, text: 'O prazo para pagar acabou. Gere um novo pedido.' },
  refunded: { label: 'Estornado', tone: 'warning', icon: RotateCcw, text: 'O pagamento foi estornado e os créditos, revertidos.' },
}

export function PaymentStatusPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const order = useQuery({
    queryKey: qk.payment(id!),
    queryFn: () => creditsService.getOrder(id!),
    refetchInterval: (q) => (q.state.data && ['awaiting_payment', 'processing'].includes(q.state.data.state) ? 5000 : false),
  })
  const simulate = useMutation({
    mutationFn: (o: 'confirmed' | 'declined' | 'expired') => creditsService.simulateGateway!(id!, o),
    onSuccess: (o) => {
      qc.setQueryData(qk.payment(id!), o)
      void qc.invalidateQueries({ queryKey: ['credits'] })
      void qc.invalidateQueries({ queryKey: qk.notificationsAll })
    },
  })

  return (
    <>
      <PageHeader
        title="Pagamento"
        breadcrumbs={[{ label: 'Créditos', to: '/app/creditos' }, { label: 'Pagamento' }]}
        badge={order.data?.demo && <DemoBadge label="Sem gateway (demo)" />}
      />
      {order.isPending ? (
        <Skeleton className="h-80 w-full rounded-[var(--radius-card)]" />
      ) : order.isError ? (
        <GlassCard>
          <ErrorState error={order.error} onRetry={() => order.refetch()} />
        </GlassCard>
      ) : (
        (() => {
          const o = order.data
          const st = PAY_STATE[o.state]
          const waiting = o.state === 'awaiting_payment' || o.state === 'processing'
          return (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <GlassCard>
                <CardBody className="flex flex-col items-center py-10 text-center">
                  <span
                    className={cn(
                      'grid size-14 place-items-center rounded-2xl',
                      { info: 'bg-info/10 text-info', accent: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger', neutral: 'bg-fg/[0.06] text-muted', warning: 'bg-warning/10 text-warning', yellow: 'bg-accent-3/10 text-accent-3' }[st.tone],
                    )}
                  >
                    <st.icon className={cn('size-6', o.state === 'processing' && 'animate-spin')} />
                  </span>
                  <Badge tone={st.tone} className="mt-4">
                    {st.label}
                  </Badge>
                  <p className="mt-3 max-w-md text-sm text-muted">{st.text}</p>

                  {waiting && o.method === 'pix' && (
                    <div className="mt-8 w-full max-w-sm">
                      {o.pix?.qrCodeImage ? (
                        <img src={o.pix.qrCodeImage} alt="QR Code PIX" className="mx-auto size-52 rounded-xl bg-white p-3" />
                      ) : (
                        <div className="mx-auto grid size-52 place-items-center rounded-xl border border-dashed border-line-strong text-center text-[13px] text-subtle">
                          <span className="px-6">
                            <QrCode className="mx-auto mb-2 size-6" />
                            O QR Code aparece aqui quando o gateway o fornecer.
                          </span>
                        </div>
                      )}
                      {o.pix?.copyPaste && (
                        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-fg/[0.03] p-2 pl-3">
                          <code className="flex-1 truncate font-mono text-xs">{o.pix.copyPaste}</code>
                          <CopyButton value={o.pix.copyPaste} label="Copiar código" />
                        </div>
                      )}
                    </div>
                  )}
                  {waiting && o.method === 'card' &&
                    (o.checkoutUrl ? (
                      <a href={o.checkoutUrl} className="mt-8" target="_blank" rel="noreferrer">
                        <Button icon={<ExternalLink className="size-4" />}>Abrir checkout seguro</Button>
                      </a>
                    ) : (
                      <p className="mt-8 text-[13px] text-subtle">O link do checkout hospedado aparece aqui quando o gateway o fornecer.</p>
                    ))}
                  {waiting && o.method === 'boleto' &&
                    (o.boletoUrl ? (
                      <a href={o.boletoUrl} className="mt-8" target="_blank" rel="noreferrer">
                        <Button icon={<Barcode className="size-4" />}>Abrir boleto</Button>
                      </a>
                    ) : (
                      <p className="mt-8 text-[13px] text-subtle">O boleto aparece aqui quando o gateway o fornecer.</p>
                    ))}

                  {!waiting && (
                    <div className="mt-8 flex gap-2">
                      <ButtonLink to="/app/creditos" variant="secondary">
                        Voltar aos créditos
                      </ButtonLink>
                      {o.state !== 'confirmed' && <ButtonLink to={`/app/creditos/comprar/${o.packageId}`}>Tentar de novo</ButtonLink>}
                    </div>
                  )}
                </CardBody>
              </GlassCard>
              <div className="flex flex-col gap-4">
                <GlassCard className="p-5">
                  <dl className="flex flex-col gap-2.5 text-sm">
                    {[
                      ['Pedido', <code className="font-mono text-xs">{o.id}</code>],
                      ['Créditos', formatNumber(o.credits)],
                      ['Valor', formatCurrency(o.amountCents)],
                      ['Método', METHODS.find((m) => m.id === o.method)?.label],
                      ['Criado em', formatDate(o.createdAt)],
                      ['Expira em', o.expiresAt ? formatDate(o.expiresAt) : '—'],
                    ].map(([k, v], i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </GlassCard>
                {o.demo && waiting && creditsService.simulateGateway && (
                  <GlassCard className="p-5">
                    <p className="flex items-center gap-2 text-sm font-medium text-fg">
                      Simular retorno do gateway <DemoBadge />
                    </p>
                    <p className="mt-1 text-[13px] text-muted">Sem gateway configurado. Use para testar os estados da tela.</p>
                    <div className="mt-4 grid gap-2">
                      <Button size="sm" variant="secondary" loading={simulate.isPending && simulate.variables === 'confirmed'} onClick={() => simulate.mutate('confirmed')}>
                        Confirmar pagamento
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => simulate.mutate('declined')} disabled={simulate.isPending}>
                        Recusar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => simulate.mutate('expired')} disabled={simulate.isPending}>
                        Expirar
                      </Button>
                    </div>
                  </GlassCard>
                )}
              </div>
            </div>
          )
        })()
      )}
    </>
  )
}
