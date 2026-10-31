import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Coins,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  KeyRound,
  ScanText,
  Trash2,
  TriangleAlert,
  Upload,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { DemoBadge, Badge } from '@/components/ui/badge'
import { Alert, Skeleton, Tabs } from '@/components/ui/misc'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/data-display/status-badge'
import { DataTable } from '@/components/data-display/data-table'
import { CodeBlock } from '@/components/data-display/code-block'
import { EmptyState } from '@/components/feedback/feedback'
import { FileDropzone, FileList } from '@/features/extractor/file-dropzone'
import { EXTRACTOR_RESULT_SAMPLE, EXTRACTOR_SAMPLES } from '@/features/extractor/api-samples'
import { extractFiles, getOriginal, useExtractor } from '@/features/extractor/store'
import { useBalance } from '@/features/queries'
import { EXTRACTOR_LIMITS } from '@/config/extractor'
import { OPERATION_COSTS, estimate } from '@/config/pricing'
import { config } from '@/lib/config'
import { formatBytes, formatDate, formatDuration, formatNumber } from '@/lib/formatting'
import { toCsv } from '@/lib/utils/csv'
import { downloadBlob, downloadText } from '@/lib/utils/download'
import { toast } from '@/stores/toast'
import type { DataExtraction, DataExtractionStatus } from '@/types/extractor'
import type { UiStatus } from '@/types/extraction'

const JsonViewer = lazy(() => import('@/components/data-display/json-viewer'))

const UI_STATUS: Record<DataExtractionStatus, UiStatus> = {
  uploading: 'pending',
  queued: 'queued',
  processing: 'processing',
  completed: 'success',
  failed: 'failed',
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '')

function exportJson(x: DataExtraction) {
  downloadText(JSON.stringify(x.data ?? {}, null, 2), `${baseName(x.fileName)}.json`, 'application/json')
}
function exportCsv(x: DataExtraction) {
  const rows = x.fields.map((f) => ({ campo: f.label, chave: f.key, valor: f.value }))
  downloadText(toCsv(rows, ['campo', 'chave', 'valor']), `${baseName(x.fileName)}.csv`, 'text/csv')
}

function ResultModal({ item, onClose }: { item: DataExtraction | null; onClose: () => void }) {
  const [tab, setTab] = useState<'dados' | 'json'>('dados')
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="lg"
      title={item?.fileName ?? ''}
      description={item ? `Extraído em ${formatDate(item.completedAt)} · ${formatDuration(item.durationS)}` : undefined}
      footer={
        item && (
          <>
            <Button variant="secondary" size="sm" icon={<FileJson className="size-3.5" />} onClick={() => exportJson(item)}>
              Baixar JSON
            </Button>
            <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => exportCsv(item)}>
              Baixar CSV
            </Button>
          </>
        )
      }
    >
      {item && (
        <div className="flex flex-col gap-4">
          {item.demo && (
            <Alert tone="success" icon={<FlaskConical />} title="Resultado simulado">
              Estes dados são fictícios. O motor que lê a fatura ainda não está conectado.
            </Alert>
          )}
          <Tabs
            label="Resultado"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'dados', label: 'Dados', count: item.fields.length },
              { value: 'json', label: 'JSON' },
            ]}
          />
          {tab === 'dados' ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {item.fields.map((f) => (
                <div key={f.key} className="rounded-xl border border-line bg-fg/[0.02] px-4 py-3">
                  <dt className="text-xs text-subtle">{f.label}</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-fg tabular-nums">{f.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <JsonViewer data={item.data ?? {}} />
            </Suspense>
          )}
        </div>
      )}
    </Modal>
  )
}

function UploadTab() {
  const balance = useBalance()
  const [files, setFiles] = useState<File[]>([])
  const [rejects, setRejects] = useState<string[]>([])
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)

  const total = files.reduce((s, f) => s + f.size, 0)
  const est = estimate('extracao', files.length)
  const saldo = balance.data?.available
  const insuficiente = saldo != null && files.length > 0 && saldo < est.min
  const curto = saldo != null && files.length > 0 && saldo < est.max

  const enviar = async () => {
    setSending(true)
    const lote = files
    setFiles([])
    setConfirm(false)
    await extractFiles(lote)
    setSending(false)
    toast.success(`${lote.length} arquivo(s) enviados`, 'Acompanhe o processamento logo abaixo.')
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <GlassCard>
        <CardHeader
          title="Enviar faturas"
          description="Cada arquivo vira uma extração independente, com status e resultado próprios."
        />
        <CardBody className="flex flex-col gap-4">
          <FileDropzone
            remaining={EXTRACTOR_LIMITS.maxFiles - files.length}
            onFiles={(fs) => setFiles((cur) => [...cur, ...fs].slice(0, EXTRACTOR_LIMITS.maxFiles))}
            onReject={setRejects}
          />
          {rejects.length > 0 && (
            <Alert tone="warning" icon={<TriangleAlert />} title="Alguns arquivos não foram adicionados">
              <ul className="mt-1 list-disc pl-4">
                {rejects.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Alert>
          )}
          <FileList files={files} onRemove={(i) => setFiles((cur) => cur.filter((_, j) => j !== i))} />
        </CardBody>
      </GlassCard>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-24 xl:self-start">
        <GlassCard className="p-5">
          <p className="text-sm font-semibold text-fg">Antes de enviar</p>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Arquivos</dt>
              <dd className="font-mono font-semibold text-fg tabular-nums">{files.length}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Tamanho total</dt>
              <dd className="font-mono text-fg tabular-nums">{formatBytes(total)}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted">
                <Coins className="size-4" /> Estimativa
              </dt>
              <dd className="text-right">
                <span className="font-mono font-semibold text-fg tabular-nums">
                  {files.length ? `${est.min}–${est.max}` : `${OPERATION_COSTS.extracao.min}–${OPERATION_COSTS.extracao.max}`}
                </span>
                <span className="block text-[11px] text-subtle">{files.length ? 'créditos no total' : 'créditos por arquivo'}</span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted">
                <Wallet className="size-4" /> Saldo
              </dt>
              <dd className="flex items-center gap-2 font-mono font-semibold text-fg tabular-nums">
                {balance.isPending ? <Skeleton className="h-4 w-10" /> : formatNumber(saldo)}
                {balance.data?.demo && <DemoBadge />}
              </dd>
            </div>
          </dl>
          {insuficiente ? (
            <Alert tone="danger" icon={<TriangleAlert />} className="mt-4" title="Saldo insuficiente">
              São necessários pelo menos {est.min} créditos.{' '}
              <Link to="/app/creditos" className="text-accent hover:underline">
                Comprar créditos
              </Link>
            </Alert>
          ) : (
            curto && (
              <Alert tone="warning" icon={<TriangleAlert />} className="mt-4">
                O saldo pode não cobrir o máximo estimado ({est.max}).
              </Alert>
            )
          )}
          <Button
            size="lg"
            className="mt-5 w-full"
            icon={<ScanText className="size-4" />}
            disabled={!files.length || insuficiente}
            loading={sending}
            onClick={() => setConfirm(true)}
          >
            Extrair dados
          </Button>
        </GlassCard>
      </aside>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={enviar}
        loading={sending}
        tone="primary"
        title="Confirmar extração de dados"
        description={`${files.length} arquivo(s), ${formatBytes(total)}. Estimativa: ${est.min} a ${est.max} créditos; o valor final é confirmado pelo servidor.`}
        confirmLabel="Extrair dados"
      />
    </div>
  )
}

function ResultsSection() {
  const { items, remove, clear } = useExtractor()
  const [open, setOpen] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const selected = useMemo(() => items.find((i) => i.id === open) ?? null, [items, open])

  return (
    <GlassCard className="mt-6">
      <CardHeader
        title="Extrações de dados"
        description="Resultados guardados neste navegador. O arquivo original só fica disponível até fechar a aba."
        action={
          items.length > 0 && (
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmClear(true)}>
              Limpar
            </Button>
          )
        }
      />
      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<ScanText />}
            title="Nenhuma extração de dados ainda"
            description="Envie uma fatura acima e os dados extraídos aparecem aqui."
          />
        ) : (
          <DataTable
            caption="Extrações de dados"
            rows={items}
            rowKey={(r) => r.id}
            onRowClick={(r) => r.status === 'completed' && setOpen(r.id)}
            mobileTitle={(r) => r.fileName}
            columns={[
              {
                key: 'arq',
                header: 'Arquivo',
                hideOnMobile: true,
                cell: (r) => (
                  <span className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-subtle" />
                    <span className="block max-w-[260px] truncate text-fg">{r.fileName}</span>
                    {r.demo && <DemoBadge label="Simulado" />}
                  </span>
                ),
              },
              { key: 'data', header: 'Data', cell: (r) => formatDate(r.createdAt) },
              {
                key: 'status',
                header: 'Status',
                cell: (r) =>
                  r.status === 'uploading' && r.uploadProgress != null ? (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-fg/10">
                        <span className="block h-full bg-accent transition-[width]" style={{ width: `${r.uploadProgress}%` }} />
                      </span>
                      <span className="font-mono text-xs">{r.uploadProgress}%</span>
                    </span>
                  ) : (
                    <span title={r.error ?? undefined}>
                      <StatusBadge status={UI_STATUS[r.status]} />
                    </span>
                  ),
              },
              {
                key: 'cred',
                header: 'Créditos',
                hideOnMobile: true,
                cell: (r) => (
                  <span className="font-mono text-xs tabular-nums" title="Estimativa pela tabela; o valor final é do servidor">
                    {r.status === 'completed' ? `${OPERATION_COSTS.extracao.min}–${OPERATION_COSTS.extracao.max}` : '—'}
                  </span>
                ),
              },
              { key: 'dur', header: 'Duração', cell: (r) => formatDuration(r.durationS) },
              { key: 'tam', header: 'Tamanho', hideOnMobile: true, cell: (r) => formatBytes(r.fileSize) },
              {
                key: 'acoes',
                header: <span className="sr-only">Ações</span>,
                mobileLabel: 'Ações',
                cell: (r) => (
                  <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'completed' && (
                      <>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Ver dados" onClick={() => setOpen(r.id)}>
                          <Eye className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Baixar JSON" onClick={() => exportJson(r)}>
                          <FileJson className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Baixar CSV" onClick={() => exportCsv(r)}>
                          <FileSpreadsheet className="size-4" />
                        </Button>
                      </>
                    )}
                    {getOriginal(r.id) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="Baixar arquivo original"
                        onClick={() => downloadBlob(getOriginal(r.id)!, r.fileName)}
                      >
                        <Download className="size-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Remover" onClick={() => remove(r.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )}
        {items.some((i) => i.status === 'failed') && (
          <p className="px-6 py-3 text-[13px] text-subtle">Passe o mouse sobre "Falha" para ver o motivo.</p>
        )}
      </div>
      <ResultModal key={selected?.id} item={selected} onClose={() => setOpen(null)} />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear()
          setConfirmClear(false)
        }}
        title="Limpar extrações de dados?"
        description="Os resultados guardados neste navegador serão apagados."
        confirmLabel="Limpar"
      />
    </GlassCard>
  )
}

function ApiTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Alert tone="warning" icon={<TriangleAlert />} title="Contrato previsto">
          O endpoint do Extrator ainda não existe no servidor. Os exemplos mostram o formato planejado e podem mudar.
        </Alert>
        <GlassCard className="p-5">
          <p className="text-sm font-semibold text-fg">Como funciona</p>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-muted">
            <li>
              <code className="font-mono text-[13px] text-fg">POST /api/v1/extractions</code> com o arquivo em multipart
              (campo <code className="font-mono text-[13px] text-fg">file</code>). Resposta <b className="text-fg">202</b> com o{' '}
              <code className="font-mono text-[13px] text-fg">id</code>.
            </li>
            <li>
              Consulte <code className="font-mono text-[13px] text-fg">GET /api/v1/extractions/:id</code> até o status ser{' '}
              <code className="font-mono text-[13px] text-fg">completed</code> ou <code className="font-mono text-[13px] text-fg">failed</code>.
            </li>
            <li>
              Baixe os dados em <code className="font-mono text-[13px] text-fg">GET /api/v1/extractions/:id/result</code>.
            </li>
          </ol>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-xs text-subtle">Custo</dt>
              <dd className="font-mono font-semibold text-fg">
                {OPERATION_COSTS.extracao.min}–{OPERATION_COSTS.extracao.max} créditos/arquivo
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Formatos</dt>
              <dd className="text-fg">PDF, PNG, JPG · até {formatBytes(EXTRACTOR_LIMITS.maxFileBytes)}</dd>
            </div>
          </dl>
          <ButtonLink to="/app/api" variant="secondary" size="sm" className="mt-5" icon={<KeyRound className="size-3.5" />}>
            Gerenciar API keys
          </ButtonLink>
        </GlassCard>
        <CodeBlock samples={[EXTRACTOR_RESULT_SAMPLE]} />
      </div>
      <div className="min-w-0">
        <CodeBlock samples={EXTRACTOR_SAMPLES} title="POST /api/v1/extractions" />
      </div>
    </div>
  )
}

export default function ExtractorPage() {
  const [tab, setTab] = useState<'upload' | 'api'>('upload')
  return (
    <>
      <PageHeader
        title="Extrator"
        description="Envie faturas que você já tem e receba os dados estruturados em JSON ou CSV, pela tela ou pela API."
        badge={config.useMocks && <Badge tone="success">Simulador</Badge>}
      />
      {config.useMocks && (
        <Alert tone="success" icon={<FlaskConical />} className="mb-6" title="Extrator em modo de demonstração">
          O motor que lê as faturas ainda não existe. Os resultados são <b className="text-fg">fictícios</b> e servem só para
          testar o fluxo. Arquivos com "erro" no nome simulam uma falha.
        </Alert>
      )}
      <Tabs
        label="Modo de envio"
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'upload', label: <span className="flex items-center gap-2"><Upload className="size-4" /> Upload</span> },
          { value: 'api', label: <span className="flex items-center gap-2"><KeyRound className="size-4" /> Via API</span> },
        ]}
      />
      {tab === 'upload' ? (
        <>
          <UploadTab />
          <ResultsSection />
        </>
      ) : (
        <ApiTab />
      )}
    </>
  )
}
