import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FilePlus2, FileX2, History, Search, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/form'
import { Alert, SkeletonRows } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DataTable, Pagination, type Column } from '@/components/data-display/data-table'
import { StatusBadge, STATUS_META } from '@/components/data-display/status-badge'
import { EmptyState, ErrorState } from '@/components/feedback/feedback'
import { ExtractionPanel } from '@/features/extractions/extraction-panel'
import { creditEstimate } from '@/features/extractions/exports'
import { useExtraction, useHistoryList, isLive } from '@/features/queries'
import { useDebounce } from '@/hooks/use-timers'
import { historyRepo } from '@/lib/storage/history-repo'
import { daysUntil, formatDate, formatDuration } from '@/lib/formatting'
import { config } from '@/lib/config'
import { qk } from '@/app/query-client'
import { toast } from '@/stores/toast'
import { FLUXO_LABEL, type Fluxo } from '@/types/engine'
import type { ExtractionRecord, HistoryQuery, UiStatus } from '@/types/extraction'

function Availability({ r }: { r: ExtractionRecord }) {
  if (!r.arquivos.length) return <span className="text-subtle">—</span>
  if (!r.arquivosDisponiveis) return <Badge tone="neutral">Expirados</Badge>
  const d = r.expiraEm ? daysUntil(r.expiraEm) : null
  return (
    <Badge tone={d != null && d <= config.avisoExpiracaoDias ? 'warning' : 'success'}>
      {r.arquivos.length} PDF · {d != null ? `${d}d` : '—'}
    </Badge>
  )
}

const COLUMNS: Column<ExtractionRecord>[] = [
  { key: 'id', header: 'ID', cell: (r) => <code className="font-mono text-xs text-fg/80">{r.id.slice(0, 8)}</code>, hideOnMobile: true },
  {
    key: 'arquivo',
    header: 'Arquivo',
    cell: (r) => (
      <span className="block max-w-[220px] truncate text-fg" title={r.arquivos[0]?.nome}>
        {r.arquivos[0]?.nome ?? (r.uc ? `UC ${r.uc}` : 'Conta padrão')}
        {r.arquivos.length > 1 && <span className="text-subtle"> +{r.arquivos.length - 1}</span>}
      </span>
    ),
    hideOnMobile: true,
  },
  { key: 'data', header: 'Data', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.criadoEm)}</span> },
  { key: 'tipo', header: 'Tipo', cell: (r) => FLUXO_LABEL[r.fluxo] },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.uiStatus} /> },
  {
    key: 'creditos',
    header: 'Créditos',
    cell: (r) => {
      const e = creditEstimate(r)
      return (
        <span className="font-mono text-xs tabular-nums" title={e.hint}>
          {e.label}
        </span>
      )
    },
    hideOnMobile: true,
  },
  { key: 'duracao', header: 'Duração', cell: (r) => formatDuration(r.duracaoS) },
  { key: 'disp', header: 'Arquivos', cell: (r) => <Availability r={r} /> },
  {
    key: 'acoes',
    header: <span className="sr-only">Ações</span>,
    cell: () => <ArrowRight className="size-4 text-subtle" aria-label="Ver detalhes" />,
    className: 'w-10',
    hideOnMobile: true,
  },
]

export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debounced = useDebounce(search, 300)

  const q: HistoryQuery = {
    search: debounced || undefined,
    status: (params.get('status') as UiStatus | null) ?? 'all',
    fluxo: (params.get('fluxo') as Fluxo | null) ?? 'all',
    from: params.get('de') ?? undefined,
    to: params.get('ate') ?? undefined,
    sort: (params.get('ordem') as HistoryQuery['sort']) ?? 'recent',
    page: Number(params.get('pagina') ?? 1),
    pageSize: 10,
  }

  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v && v !== 'all') n.set(k, v)
        else n.delete(k)
        if (k !== 'pagina') n.delete('pagina')
        return n
      },
      { replace: true },
    )

  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) set('q', debounced || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Busca vinda do header com a página já aberta.
  const qParam = params.get('q') ?? ''
  const [lastQ, setLastQ] = useState(qParam)
  if (qParam !== lastQ) {
    setLastQ(qParam)
    if (qParam !== debounced) setSearch(qParam)
  }

  const list = useHistoryList(q)
  const hasFilters = !!(q.search || q.status !== 'all' || q.fluxo !== 'all' || q.from || q.to)

  return (
    <>
      <PageHeader
        title="Histórico"
        description="Todas as faturas buscadas neste navegador, com status, duração e arquivos."
        actions={
          <ButtonLink to="/app/nova-fatura" icon={<FilePlus2 className="size-4" />}>
            Nova fatura
          </ButtonLink>
        }
      />
      <Alert tone="info" className="mb-5" icon={<History />}>
        O motor de extração não guarda histórico. Até o backend da plataforma existir, os registros e os PDFs ficam
        guardados neste navegador (IndexedDB) por {config.retencaoLocalDias} dias.
      </Alert>

      <GlassCard>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Buscar por UC, arquivo ou ID</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por UC, arquivo ou ID…" className="h-10 pl-10" />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:flex">
            <Select aria-label="Status" value={q.status} onChange={(e) => set('status', e.target.value)} className="h-10 lg:w-40">
              <option value="all">Todos os status</option>
              {(Object.keys(STATUS_META) as UiStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </Select>
            <Select aria-label="Tipo" value={q.fluxo} onChange={(e) => set('fluxo', e.target.value)} className="h-10 lg:w-36">
              <option value="all">Todos os tipos</option>
              {(Object.keys(FLUXO_LABEL) as Fluxo[]).map((f) => (
                <option key={f} value={f}>
                  {FLUXO_LABEL[f]}
                </option>
              ))}
            </Select>
            <Input aria-label="De" type="date" value={q.from ?? ''} onChange={(e) => set('de', e.target.value || null)} className="h-10 lg:w-38" />
            <Input aria-label="Até" type="date" value={q.to ?? ''} onChange={(e) => set('ate', e.target.value || null)} className="h-10 lg:w-38" />
            <Select aria-label="Ordenação" value={q.sort} onChange={(e) => set('ordem', e.target.value)} className="col-span-2 h-10 sm:col-span-1 lg:w-40">
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              <option value="duration">Maior duração</option>
            </Select>
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="size-3.5" />}
              onClick={() => {
                setSearch('')
                setParams({}, { replace: true })
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        {list.isPending ? (
          <SkeletonRows rows={6} className="p-5" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.total === 0 ? (
          hasFilters ? (
            <EmptyState icon={<Search />} title="Nada encontrado" description="Nenhuma fatura corresponde aos filtros." />
          ) : (
            <EmptyState
              icon={<FileX2 />}
              title="Nenhuma fatura ainda"
              description="Busque a primeira fatura e ela aparece aqui com status e arquivos."
              action={<ButtonLink to="/app/nova-fatura">Nova fatura</ButtonLink>}
            />
          )
        ) : (
          <>
            <DataTable
              caption="Histórico de faturas"
              columns={COLUMNS}
              rows={list.data.items}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/app/historico/${r.id}`)}
              mobileTitle={(r) => (
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.arquivos[0]?.nome ?? (r.uc ? `UC ${r.uc}` : FLUXO_LABEL[r.fluxo])}</span>
                  <code className="font-mono text-xs text-subtle">{r.id.slice(0, 8)}</code>
                </span>
              )}
            />
            <Pagination
              page={list.data.page}
              totalPages={list.data.totalPages}
              total={list.data.total}
              pageSize={list.data.pageSize}
              onPage={(p) => set('pagina', String(p))}
            />
          </>
        )}
      </GlassCard>
    </>
  )
}

export function ExtractionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useExtraction(id)
  const [confirm, setConfirm] = useState(false)
  const remove = useMutation({
    mutationFn: () => historyRepo.remove(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.history })
      toast.success('Registro excluído', 'Metadados e PDFs foram apagados deste navegador.')
      navigate('/app/historico')
    },
  })

  return (
    <>
      <PageHeader
        title="Detalhes da fatura"
        breadcrumbs={[{ label: 'Histórico', to: '/app/historico' }, { label: id?.slice(0, 8) ?? '' }]}
        actions={
          data && (
            <Button
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              disabled={isLive(data)}
              title={isLive(data) ? 'Aguarde a busca terminar' : undefined}
              onClick={() => setConfirm(true)}
            >
              Excluir registro
            </Button>
          )
        }
      />
      {isPending ? (
        <SkeletonRows rows={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <GlassCard>
          <EmptyState
            icon={<FileX2 />}
            title="Fatura não encontrada"
            description="Ela pode ter sido excluída ou feita em outro navegador."
            action={<ButtonLink to="/app/historico" variant="secondary">Voltar ao histórico</ButtonLink>}
          />
        </GlassCard>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
          <ExtractionPanel record={data} />
          <GlassCard className="self-start">
            <CardHeader title="Dados enviados" description="Sem senha; CPF/CNPJ mascarado." />
            <CardBody>
              <dl className="flex flex-col gap-3 text-sm">
                {Object.entries(data.entradaResumo).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-subtle">{k}</dt>
                    <dd className="mt-0.5 break-all text-fg">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-subtle">Arquivos expiram</dt>
                  <dd className="mt-0.5 text-fg">{data.expiraEm ? formatDate(data.expiraEm) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">API key</dt>
                  <dd className="mt-0.5 text-muted">Interface web (sem chave)</dd>
                </div>
              </dl>
            </CardBody>
          </GlassCard>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Excluir este registro?"
        description="Os metadados e os PDFs desta fatura serão apagados deste navegador. Não dá para desfazer."
        confirmLabel="Excluir"
      />
    </>
  )
}
