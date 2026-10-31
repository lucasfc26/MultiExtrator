import { ApiError } from '@/lib/api/errors'
import type { EntradaPorFluxo, Fluxo, RespostaExtracao } from '@/types/engine'
import type { ExtractionEngine } from './types'

/**
 * Simulador do worker (VITE_ENGINE=mock) para trabalhar na interface sem
 * Docker. Tudo que ele produz é marcado como demonstração. Regras:
 *  - usuário/UC contendo "erro" → status erro;
 *  - UC contendo "0000" → atenção (fatura não gerada);
 *  - 2 VIA pede código; "000000" é recusado e a ENEL "envia outro".
 */

interface MockJob {
  resp: RespostaExtracao
  criado: number
  fase: 'fila' | 'exec' | 'codigo' | 'fim'
  faseDesde: number
  entrada: EntradaPorFluxo[Fluxo]
  referencias: string[]
  logs: string[]
  codigoOk?: boolean
}

const jobs = new Map<string, MockJob>()
const FILA_MS = 1500
const EXEC_MS = 5000

function mesAtual(): string {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function demoPdf(titulo: string): string {
  const texto = `(DEMONSTRACAO - ${titulo.replace(/[()\\]/g, '')}) Tj`
  const stream = `BT /F1 18 Tf 60 760 Td ${texto} ET BT /F1 11 Tf 60 730 Td (Documento gerado pelo simulador do Fatturas. Nao e uma fatura real.) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return btoa(pdf)
}

function avancar(job: MockJob) {
  const agora = Date.now()
  const r = job.resp
  if (job.fase === 'fila' && agora - job.faseDesde > FILA_MS) {
    job.fase = 'exec'
    job.faseDesde = agora
    r.estado = 'executando'
    r.observacao = 'Extração em andamento.'
    job.logs.push('[demo] Abrindo navegador…', '[demo] Resolvendo captcha…')
  }
  if (job.fase === 'exec' && agora - job.faseDesde > EXEC_MS) {
    if (r.fluxo === 'segunda_via' && !job.codigoOk) {
      job.fase = 'codigo'
      job.faseDesde = agora
      r.estado = 'aguardando_codigo'
      r.status = 'aguardando_codigo'
      r.observacao =
        '[demo] A ENEL enviou o código de segurança para o cliente. Envie o código em até 10 minutos.'
      r.expira_em_s = 600
      job.logs.push('[demo] Código solicitado ao cliente.')
      return
    }
    finalizar(job)
  }
  if (job.fase === 'codigo') {
    r.expira_em_s = Math.max(0, 600 - Math.round((agora - job.faseDesde) / 1000))
  }
}

function finalizar(job: MockJob) {
  const r = job.resp
  const e = job.entrada as unknown as Record<string, string | undefined>
  const chave = `${e.usuario ?? ''} ${e.uc ?? ''}`.toLowerCase()
  job.fase = 'fim'
  r.estado = 'concluido'
  r.duracao_s = Math.round((Date.now() - job.criado - FILA_MS) / 100) / 10
  delete r.expira_em_s
  if (chave.includes('erro')) {
    r.status = 'erro'
    r.observacao = '[demo] Login ou senha inválidos.'
    r.arquivos = []
  } else if (chave.includes('0000')) {
    r.status = 'atencao'
    r.observacao = `[demo] ${job.referencias[0]}: Fatura ainda não gerada.`
    r.arquivos = []
  } else {
    const uc = r.uc ?? '00000000'
    r.arquivos = job.referencias.map((ref) => {
      const nome = `${ref.replace('/', '.')} - ${uc} (DEMO).pdf`
      const b64 = demoPdf(nome)
      return { nome, referencia: ref, tamanho_bytes: Math.round((b64.length * 3) / 4), pdf_base64: b64 }
    })
    r.status = 'sucesso'
    r.observacao = `[demo] ${r.arquivos.length} fatura(s) baixada(s).`
  }
  job.logs.push(`[demo] Concluído: ${r.status}.`)
}

function snapshot(job: MockJob, pdf: boolean, logs: boolean): RespostaExtracao {
  const r = structuredClone(job.resp)
  if (r.arquivos && !pdf) r.arquivos = r.arquivos.map(({ pdf_base64: _pdf, ...a }) => a)
  if (logs) r.logs = [...job.logs]
  return r
}

function obter(jobId: string): MockJob {
  const job = jobs.get(jobId)
  if (!job) throw new ApiError('not_found', 'Extração não encontrada (id inválido ou expirada).', 404)
  return job
}

export const mockEngine: ExtractionEngine = {
  mode: 'mock',
  supportsPolling: true,
  supportsCancel: true,
  supportsLogs: true,

  async start(fluxo, entrada) {
    const refs = [entrada.referencia, ...(entrada.referencias ?? [])].filter(Boolean) as string[]
    const id = `demo${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`
    const uc = 'uc' in entrada && entrada.uc ? entrada.uc.replace(/\D/g, '') : null
    const job: MockJob = {
      criado: Date.now(),
      fase: 'fila',
      faseDesde: Date.now(),
      entrada,
      referencias: refs.length ? Array.from(new Set(refs)) : [mesAtual()],
      logs: ['[demo] Extração na fila.'],
      resp: { job_id: id, fluxo, uc, estado: 'na_fila', status: 'processando', observacao: 'Extração na fila.' },
    }
    jobs.set(id, job)
    return snapshot(job, false, false)
  },

  async poll(jobId, opts = {}) {
    const job = obter(jobId)
    avancar(job)
    return snapshot(job, opts.pdf ?? false, opts.logs ?? false)
  },

  async sendCode({ jobId }, entrada) {
    const job = obter(jobId)
    if (job.fase !== 'codigo')
      throw new ApiError('conflict', `a extração não está aguardando código (estado: ${job.resp.estado})`, 409)
    job.fase = 'exec'
    job.faseDesde = Date.now()
    job.resp.estado = 'executando'
    job.resp.status = 'processando'
    job.resp.observacao = 'Extração em andamento.'
    if (entrada.reenviar || entrada.codigo === '000000') {
      job.logs.push('[demo] Código recusado — a ENEL envia outro.')
    } else {
      job.codigoOk = true
      job.logs.push('[demo] Código aceito.')
    }
    return snapshot(job, false, false)
  },

  async cancel(jobId) {
    const job = obter(jobId)
    if (job.fase !== 'fim') {
      job.fase = 'fim'
      Object.assign(job.resp, {
        estado: 'concluido',
        status: 'erro',
        observacao: 'Extração cancelada.',
        arquivos: [],
      })
    }
    return snapshot(job, false, false)
  },

  async health() {
    return { online: true, mode: 'mock', detalhe: 'Simulador local: nenhuma chamada sai do navegador.' }
  },
}
