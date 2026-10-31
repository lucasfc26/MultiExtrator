import { qk, queryClient } from '@/app/query-client'
import { ApiError, userMessage } from '@/lib/api/errors'
import { notificationsService } from '@/lib/api/services/notifications.service'
import { config } from '@/lib/config'
import { engine } from '@/lib/engine'
import { maskDocumento } from '@/lib/formatting'
import { historyRepo } from '@/lib/storage/history-repo'
import { base64ToBlob } from '@/lib/utils/download'
import type {
  EntradaCodigo,
  EntradaPorFluxo,
  EstadoJob,
  Fluxo,
  RespostaExtracao,
  StatusJob,
} from '@/types/engine'
import { FLUXO_LABEL } from '@/types/engine'
import type { ExtractionRecord, TimelineEvent, UiStatus } from '@/types/extraction'

/**
 * Orquestra as extrações fora dos componentes: a operação continua (e o
 * histórico é atualizado) mesmo que o usuário navegue para outra página.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const polling = new Set<string>()

export function uiStatusOf(estado: EstadoJob, status: StatusJob, observacao = ''): UiStatus {
  if (estado === 'na_fila') return 'queued'
  if (estado === 'executando') return 'processing'
  if (estado === 'aguardando_codigo') return 'awaiting_code'
  if (status === 'sucesso') return 'success'
  if (status === 'atencao') return 'warning'
  if (/^(\[demo\] )?Extração cancelada/.test(observacao)) return 'cancelled'
  return 'failed'
}

/** Resposta crua para o visualizador JSON, sem o base64 dos PDFs. */
export function sanitizeResponse(r: RespostaExtracao): unknown {
  return {
    ...r,
    ...(r.arquivos
      ? {
          arquivos: r.arquivos.map(({ pdf_base64, ...a }) =>
            pdf_base64 ? { ...a, pdf_base64: `<omitido: ${pdf_base64.length} caracteres>` } : a,
          ),
        }
      : {}),
    ...(r.logs ? { logs: undefined } : {}),
  }
}

export function resumoEntrada<F extends Fluxo>(fluxo: F, e: EntradaPorFluxo[F]): Record<string, string> {
  const r: Record<string, string> = {}
  if ('usuario' in e) r.usuario = e.usuario
  if ('uc' in e && e.uc) r.uc = e.uc
  if (fluxo === 'site_enel' && 'tipo_conta' in e) r.tipo_conta = e.tipo_conta ?? 'empresa'
  if ('cpf_cnpj' in e) r.cpf_cnpj = maskDocumento(e.cpf_cnpj)
  if ('email_segunda_via' in e && e.email_segunda_via) r.email_segunda_via = e.email_segunda_via
  if ('canal' in e) r.canal = e.canal ?? 'email'
  return r
}

function invalidate(id: string) {
  void queryClient.invalidateQueries({ queryKey: qk.history })
  void queryClient.invalidateQueries({ queryKey: qk.extraction(id) })
}

async function update(id: string, fn: (r: ExtractionRecord) => ExtractionRecord) {
  const rec = await historyRepo.get(id)
  if (!rec) return null
  const next = fn(rec)
  next.atualizadoEm = new Date().toISOString()
  await historyRepo.put(next)
  invalidate(id)
  return next
}

function event(estado: TimelineEvent['estado'], mensagem: string, status?: StatusJob): TimelineEvent {
  return { at: new Date().toISOString(), estado, status, mensagem }
}

async function notifyDone(rec: ExtractionRecord) {
  if (!config.useMocks) return // com backend real, quem cria notificações é o servidor
  const ok = rec.uiStatus === 'success' || rec.uiStatus === 'warning'
  await notificationsService.pushLocal({
    type: ok ? 'extraction_completed' : 'extraction_failed',
    title: ok ? `Extração concluída · ${FLUXO_LABEL[rec.fluxo]}` : `Extração com falha · ${FLUXO_LABEL[rec.fluxo]}`,
    body: rec.observacao,
    link: `/app/historico/${rec.id}`,
  })
}

async function apply(id: string, resp: RespostaExtracao) {
  // PDFs vão para o IndexedDB antes de o registro dizer que existem.
  const comPdf = resp.arquivos?.filter((a) => a.pdf_base64) ?? []
  for (const a of comPdf) await historyRepo.saveFile(id, a.nome, base64ToBlob(a.pdf_base64!))

  let terminou = false
  const rec = await update(id, (r) => {
    const mudou = r.estado !== resp.estado || r.status !== resp.status || r.observacao !== resp.observacao
    const concluido = resp.estado === 'concluido'
    terminou = concluido && r.estado !== 'concluido'
    const arquivos = resp.arquivos?.map(({ pdf_base64: _b, ...a }) => a) ?? r.arquivos
    return {
      ...r,
      jobId: resp.job_id ?? r.jobId,
      uc: resp.uc ?? r.uc,
      estado: resp.estado,
      status: resp.status,
      uiStatus: uiStatusOf(resp.estado, resp.status, resp.observacao),
      observacao: resp.observacao,
      duracaoS: resp.duracao_s ?? r.duracaoS,
      arquivos,
      arquivosDisponiveis: comPdf.length > 0 || r.arquivosDisponiveis,
      expiraEm:
        comPdf.length > 0
          ? new Date(Date.now() + config.retencaoLocalDias * 86_400_000).toISOString()
          : r.expiraEm,
      concluidoEm: concluido ? (r.concluidoEm ?? new Date().toISOString()) : null,
      expiraCodigoEm:
        resp.estado === 'aguardando_codigo' && resp.expira_em_s != null
          ? new Date(Date.now() + resp.expira_em_s * 1000).toISOString()
          : null,
      urlCodigo: resp.url_codigo ?? (resp.estado === 'aguardando_codigo' ? r.urlCodigo : null),
      respostaBruta: sanitizeResponse(resp),
      timeline: mudou ? [...r.timeline, event(resp.estado, resp.observacao, resp.status)] : r.timeline,
    }
  })
  if (rec && terminou) await notifyDone(rec)
  return rec
}

async function fail(id: string, err: unknown) {
  const msg = userMessage(err)
  const rec = await update(id, (r) => ({
    ...r,
    estado: 'concluido',
    status: 'erro',
    uiStatus: 'failed',
    observacao: msg,
    concluidoEm: new Date().toISOString(),
    expiraCodigoEm: null,
    respostaBruta: err instanceof ApiError ? (err.body ?? { erro: msg, http: err.status }) : { erro: msg },
    timeline: [...r.timeline, event('erro_http', err instanceof ApiError && err.status ? `HTTP ${err.status}: ${msg}` : msg, 'erro')],
  }))
  if (rec) await notifyDone(rec)
}

async function pollLoop(id: string, jobId: string) {
  if (polling.has(id)) return
  polling.add(id)
  let falhasSeguidas = 0
  try {
    for (;;) {
      const atual = await historyRepo.get(id)
      if (!atual || atual.estado === 'concluido') return
      await sleep(atual.estado === 'aguardando_codigo' ? 4000 : 2000)
      try {
        const resp = await engine.poll(jobId)
        falhasSeguidas = 0
        if (resp.estado === 'concluido') {
          await apply(id, await engine.poll(jobId, { pdf: true }))
          return
        }
        await apply(id, resp)
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'not_found') {
          await fail(
            id,
            new ApiError('not_found', 'O motor não conhece mais esta extração (reiniciado ou expirada após 1 h).', 404),
          )
          return
        }
        // Worker reiniciando/rede instável: tenta por ~1 min antes de desistir.
        if (++falhasSeguidas >= 30) {
          await fail(id, e)
          return
        }
      }
    }
  } finally {
    polling.delete(id)
  }
}

async function run(id: string, call: () => Promise<RespostaExtracao>) {
  try {
    const resp = await call()
    await apply(id, resp)
    if (engine.supportsPolling && resp.estado !== 'concluido') void pollLoop(id, resp.job_id)
    else if (engine.supportsPolling && resp.estado === 'concluido' && resp.arquivos?.length)
      await apply(id, await engine.poll(resp.job_id, { pdf: true }))
  } catch (e) {
    await fail(id, e)
  }
}

export async function startExtraction<F extends Fluxo>(fluxo: F, entrada: EntradaPorFluxo[F]): Promise<string> {
  const id = crypto.randomUUID()
  const agora = new Date().toISOString()
  const refs = [entrada.referencia, ...(entrada.referencias ?? [])].filter((x): x is string => !!x)
  const rec: ExtractionRecord = {
    id,
    jobId: null,
    fluxo,
    engine: engine.mode,
    uc: 'uc' in entrada && entrada.uc ? entrada.uc.replace(/\D/g, '') : null,
    referencias: Array.from(new Set(refs)),
    entradaResumo: resumoEntrada(fluxo, entrada),
    criadoEm: agora,
    atualizadoEm: agora,
    concluidoEm: null,
    estado: 'na_fila',
    status: 'processando',
    uiStatus: 'pending',
    observacao: 'Enviando pedido ao motor…',
    duracaoS: null,
    arquivos: [],
    expiraEm: null,
    arquivosDisponiveis: false,
    timeline: [event('enviado', `Pedido enviado (${engine.mode}).`)],
    expiraCodigoEm: null,
    urlCodigo: null,
    respostaBruta: null,
    demo: engine.mode === 'mock',
  }
  await historyRepo.put(rec)
  invalidate(id)
  void run(id, () => engine.start(fluxo, entrada))
  return id
}

export async function sendCode(id: string, entrada: EntradaCodigo) {
  const rec = await historyRepo.get(id)
  if (!rec?.jobId || rec.estado !== 'aguardando_codigo')
    throw new ApiError('conflict', 'Esta extração não está aguardando código.')
  const job = { jobId: rec.jobId, urlCodigo: rec.urlCodigo }
  const msg = entrada.reenviar ? 'Pedido de reenvio do código.' : 'Código de segurança enviado.'
  if (engine.supportsPolling) {
    const resp = await engine.sendCode(job, entrada)
    await update(id, (r) => ({ ...r, timeline: [...r.timeline, event('enviado', msg)] }))
    await apply(id, resp)
    void pollLoop(id, rec.jobId)
    return
  }
  // n8n: a chamada fica aberta até o resultado ou o próximo 202.
  await update(id, (r) => ({
    ...r,
    estado: 'executando',
    status: 'processando',
    uiStatus: 'processing',
    observacao: 'Extração em andamento.',
    expiraCodigoEm: null,
    timeline: [...r.timeline, event('enviado', msg)],
  }))
  void run(id, () => engine.sendCode(job, entrada))
}

export async function cancelExtraction(id: string) {
  const rec = await historyRepo.get(id)
  if (!rec?.jobId || !engine.supportsCancel) throw new ApiError('unknown', 'Cancelamento indisponível neste modo.')
  const resp = await engine.cancel(rec.jobId)
  await apply(id, resp)
}

/** Na abertura do app: retoma o acompanhamento das extrações que ficaram no meio. */
export async function resumePending() {
  await historyRepo.purgeExpired()
  for (const r of await historyRepo.all()) {
    if (r.estado === 'concluido') continue
    if (r.engine !== engine.mode) continue
    if (engine.supportsPolling && r.jobId) {
      void pollLoop(r.id, r.jobId)
    } else if (!engine.supportsPolling && !(r.estado === 'aguardando_codigo' && r.urlCodigo)) {
      await fail(
        r.id,
        new Error(
          'A página foi recarregada com a chamada ao n8n aberta. A execução pode ter continuado no n8n, mas o resultado não volta mais para esta tela.',
        ),
      )
    }
  }
}
