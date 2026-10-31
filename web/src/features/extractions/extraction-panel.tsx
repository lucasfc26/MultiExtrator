import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  FileDown,
  FileJson,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, DemoBadge } from '@/components/ui/badge'
import { Alert, CopyButton, Skeleton, Tabs } from '@/components/ui/misc'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/data-display/status-badge'
import { DataTable } from '@/components/data-display/data-table'
import { ExtractionProgress } from './extraction-progress'
import { CodeEntry } from './code-entry'
import { cancelExtraction } from './runner'
import { creditEstimate, downloadCsv, downloadJson, downloadPdf, pdfUrl, resultRows } from './exports'
import { isLive, useEngineLogs } from '@/features/queries'
import { useElapsed } from '@/hooks/use-timers'
import { engine, ENGINE_LABEL } from '@/lib/engine'
import { config } from '@/lib/config'
import { daysUntil, formatBytes, formatDate, formatDuration } from '@/lib/formatting'
import { userMessage } from '@/lib/api/errors'
import { toast } from '@/stores/toast'
import { FLUXO_LABEL } from '@/types/engine'
import type { ExtractionRecord } from '@/types/extraction'
import { cn } from '@/lib/utils/cn'

const JsonViewer = lazy(() => import('@/components/data-display/json-viewer'))

function LiveIndicator({ record }: { record: ExtractionRecord }) {
  const elapsed = useElapsed(record.criadoEm, true)
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-fg/[0.02] p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--accent)),transparent)] opacity-70" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative grid size-10 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/15" />
            <span className="absolute inset-1 rounded-full border-2 border-accent/30 border-t-accent motion-safe:animate-spin" />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">{record.observacao}</p>
            <p className="text-[13px] text-subtle">
              {formatDuration(elapsed)} desde o envio ·{' '}
              {engine.supportsPolling ? 'acompanhando pelo motor' : 'aguardando a resposta do n8n'}
            </p>
          </div>
        </div>
      </div>
      {!engine.supportsPolling && (
        <p className="mt-3 text-[12px] text-subtle">
          No modo n8n a chamada fica aberta até o fim (pode levar vários minutos). Não recarregue a página.
        </p>
      )}
    </div>
  )
}

function LogsPanel({ record }: { record: ExtractionRecord }) {
  const live = isLive(record)
  const [open, setOpen] = useState(false)
  const logs = useEngineLogs(record.jobId, open && live)
  if (!engine.supportsLogs || !record.jobId || record.engine !== engine.mode) return null
  return (
    <div className="rounded-xl border border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-muted hover:text-fg"
      >
        <Terminal className="size-4" /> Logs do extrator {live ? '(ao vivo)' : ''}
      </button>
      {open && (
        <div className="max-h-72 overflow-auto border-t border-line bg-code-bg p-4 font-mono text-[12px] leading-relaxed text-code-fg">
          {!live ? (
            <p className="text-code-muted">Os logs só ficam disponíveis enquanto a busca roda.</p>
          ) : logs.isPending ? (
            <p>Carregando…</p>
          ) : logs.isError ? (
            <p className="text-[hsl(0_84%_68%)]">{userMessage(logs.error)}</p>
          ) : logs.data.length === 0 ? (
            <p className="text-code-muted">Sem linhas ainda.</p>
          ) : (
            logs.data.slice(-120).map((l, i) => <div key={i}>{l}</div>)
          )}
        </div>
      )}
    </div>
  )
}

function PdfFrame({ record, nome }: { record: ExtractionRecord; nome: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let u: string | null = null
    let alive = true
    void pdfUrl(record, nome).then((x) => {
      u = x
      if (!alive) return
      if (x) setUrl(x)
      else setMissing(true)
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [record, nome])
  return missing ? (
    <Alert tone="warning" icon={<TriangleAlert />}>
      O PDF não está mais neste navegador.
    </Alert>
  ) : url ? (
    <iframe src={url} title={`Prévia de ${nome}`} className="h-[70dvh] w-full rounded-lg border border-line bg-white" />
  ) : (
    <Skeleton className="h-[70dvh] w-full" />
  )
}

function PdfPreview({ record, nome, onClose }: { record: ExtractionRecord; nome: string | null; onClose: () => void }) {
  return (
    <Modal open={!!nome} onClose={onClose} title={nome ?? ''} size="lg">
      {nome && <PdfFrame key={nome} record={record} nome={nome} />}
    </Modal>
  )
}

function ResultSummary({ record }: { record: ExtractionRecord }) {
  const tone = record.uiStatus === 'success' ? 'success' : record.uiStatus === 'warning' ? 'warning' : 'danger'
  const icon = tone === 'success' ? <CheckCircle2 /> : tone === 'warning' ? <TriangleAlert /> : record.uiStatus === 'cancelled' ? <Ban /> : <AlertOctagon />
  const title =
    record.uiStatus === 'success'
      ? 'Fatura obtida'
      : record.uiStatus === 'warning'
        ? 'Concluída com atenção'
        : record.uiStatus === 'cancelled'
          ? 'Busca cancelada'
          : 'A busca falhou'
  return (
    <Alert tone={tone} icon={icon} title={title}>
      {record.observacao}
    </Alert>
  )
}

function FilesSection({ record }: { record: ExtractionRecord }) {
  const [preview, setPreview] = useState<string | null>(null)
  const dias = record.expiraEm ? daysUntil(record.expiraEm) : null
  if (!record.arquivos.length)
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-subtle">
        Nenhum PDF retornado nesta busca.
      </p>
    )
  return (
    <div className="flex flex-col gap-3">
      {!record.arquivosDisponiveis ? (
        <Alert tone="warning" icon={<Clock />} title="Arquivos expirados">
          Os PDFs foram apagados após {config.retencaoLocalDias} dias. Os metadados continuam no histórico; faça uma nova
          busca para baixar de novo.
        </Alert>
      ) : (
        dias != null &&
        dias <= config.avisoExpiracaoDias && (
          <Alert tone="warning" icon={<Clock />}>
            Os PDFs expiram {dias <= 0 ? 'hoje' : `em ${dias} dia(s)`} ({formatDate(record.expiraEm, false)}).
          </Alert>
        )
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {record.arquivos.map((a) => (
          <li key={a.nome} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="grid size-9 place-items-center rounded-lg bg-danger/10 text-danger">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{a.nome}</p>
              <p className="text-xs text-subtle">
                {a.referencia ?? 'sem referência'} · {formatBytes(a.tamanho_bytes)}
                {a.nome.endsWith(' Old.pdf') && ' · fatura cancelada (refaturamento)'}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                icon={<Eye className="size-3.5" />}
                disabled={!record.arquivosDisponiveis}
                onClick={() => setPreview(a.nome)}
              >
                Ver
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileDown className="size-3.5" />}
                disabled={!record.arquivosDisponiveis}
                title={!record.arquivosDisponiveis ? 'Arquivo expirado' : undefined}
                onClick={() => downloadPdf(record, a.nome).catch((e) => toast.error('Download indisponível', userMessage(e)))}
              >
                PDF
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <PdfPreview record={record} nome={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function Timeline({ record }: { record: ExtractionRecord }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l border-line-strong pl-5">
      {record.timeline.map((e, i) => (
        <li key={i} className="relative">
          <span
            className={cn(
              'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-[hsl(var(--bg))]',
              e.estado === 'erro_http' || e.status === 'erro'
                ? 'bg-danger'
                : e.status === 'sucesso'
                  ? 'bg-success'
                  : e.status === 'atencao'
                    ? 'bg-warning'
                    : e.estado === 'aguardando_codigo'
                      ? 'bg-accent-3'
                      : 'bg-accent',
            )}
          />
          <p className="text-[13px] text-fg">{e.mensagem}</p>
          <p className="text-xs text-subtle">
            {formatDate(e.at)} · <span className="font-mono">{e.estado}</span>
          </p>
        </li>
      ))}
    </ol>
  )
}

export function ExtractionPanel({ record, compact }: { record: ExtractionRecord; compact?: boolean }) {
  const live = isLive(record)
  const [tab, setTab] = useState<'arquivos' | 'tabela' | 'json' | 'linha'>('arquivos')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancel = useMutation({
    mutationFn: () => cancelExtraction(record.id),
    onSuccess: () => {
      setConfirmCancel(false)
      toast.info('Cancelamento pedido', 'O navegador da busca será fechado.')
    },
    onError: (e) => toast.error('Não foi possível cancelar', userMessage(e)),
  })
  const canCancel = live && engine.supportsCancel && record.engine === engine.mode && !!record.jobId

  return (
    <GlassCard>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {FLUXO_LABEL[record.fluxo]}
            {record.uc && <span className="font-normal text-muted">· UC {record.uc}</span>}
            <StatusBadge status={record.uiStatus} />
            {record.demo && <DemoBadge label="Simulador" />}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              ID <code className="font-mono text-xs text-fg/80">{record.id.slice(0, 8)}</code>
              <CopyButton value={record.id} size="icon" label="Copiar ID" />
            </span>
            {record.jobId && (
              <span className="inline-flex items-center gap-1">
                job_id <code className="font-mono text-xs text-fg/80">{record.jobId.slice(0, 10)}…</code>
                <CopyButton value={record.jobId} size="icon" label="Copiar job_id" />
              </span>
            )}
            <span>{formatDate(record.criadoEm)}</span>
            <Badge>{ENGINE_LABEL[record.engine]}</Badge>
          </span>
        }
        action={
          canCancel && (
            <Button variant="ghost" size="sm" icon={<Ban className="size-3.5" />} onClick={() => setConfirmCancel(true)}>
              Cancelar
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-5">
        <ExtractionProgress record={record} />

        {record.uiStatus === 'awaiting_code' ? (
          <CodeEntry key={record.expiraCodigoEm ?? 'codigo'} record={record} />
        ) : live ? (
          <LiveIndicator record={record} />
        ) : (
          <ResultSummary record={record} />
        )}

        {live && compact && (
          <p className="flex items-center gap-2 text-[13px] text-subtle">
            <Info className="size-3.5" /> Pode sair desta tela: a busca continua e aparece no{' '}
            <Link to={`/app/historico/${record.id}`} className="text-accent hover:underline">
              histórico
            </Link>
            .
          </p>
        )}

        <LogsPanel record={record} />

        {!live && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Duração', formatDuration(record.duracaoS)],
                ['PDFs', String(record.arquivos.length)],
                ['Referências', record.referencias.length ? record.referencias.join(', ') : 'mês atual'],
                ['Créditos (estim.)', creditEstimate(record).label],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line bg-fg/[0.02] px-4 py-3">
                  <dt className="text-xs text-subtle">{k}</dt>
                  <dd className="mt-1 truncate text-sm font-medium text-fg" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<FileJson className="size-3.5" />} onClick={() => downloadJson(record)}>
                Baixar JSON
              </Button>
              <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => downloadCsv(record)}>
                Baixar CSV
              </Button>
              {compact && (
                <Link
                  to={`/app/historico/${record.id}`}
                  className="inline-flex h-8 items-center gap-2 px-3 text-[13px] font-medium text-muted hover:text-fg"
                >
                  <History className="size-3.5" /> Ver detalhes
                </Link>
              )}
            </div>

            <Tabs
              label="Resultado"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'arquivos', label: 'Arquivos', count: record.arquivos.length },
                { value: 'tabela', label: 'Prévia em tabela' },
                { value: 'json', label: 'JSON' },
                { value: 'linha', label: 'Linha do tempo', count: record.timeline.length },
              ]}
            />
            <div role="tabpanel">
              {tab === 'arquivos' && <FilesSection record={record} />}
              {tab === 'tabela' && (
                <div className="overflow-hidden rounded-xl border border-line">
                  <DataTable
                    caption="Prévia dos dados extraídos"
                    rows={resultRows(record)}
                    rowKey={(r) => `${r.arquivo}-${r.referencia}`}
                    columns={[
                      { key: 'ref', header: 'Referência', cell: (r) => r.referencia || '—' },
                      { key: 'arq', header: 'Arquivo', cell: (r) => <span className="text-fg">{r.arquivo || '—'}</span> },
                      { key: 'tam', header: 'Tamanho', cell: (r) => (r.tamanho_bytes ? formatBytes(Number(r.tamanho_bytes)) : '—') },
                      { key: 'uc', header: 'UC', cell: (r) => r.uc || '—' },
                      { key: 'st', header: 'Status', cell: (r) => <span className="font-mono text-xs">{r.status}</span> },
                    ]}
                  />
                </div>
              )}
              {tab === 'json' && (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <JsonViewer data={record.respostaBruta ?? {}} />
                </Suspense>
              )}
              {tab === 'linha' && <Timeline record={record} />}
            </div>
          </>
        )}
        {live && !compact && (
          <div>
            <p className="mb-3 text-[13px] font-medium text-muted">Linha do tempo</p>
            <Timeline record={record} />
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate()}
        loading={cancel.isPending}
        title="Cancelar a busca?"
        description="O navegador da busca será fechado. Nenhum PDF desta tentativa será entregue."
        confirmLabel="Cancelar busca"
      />
    </GlassCard>
  )
}
