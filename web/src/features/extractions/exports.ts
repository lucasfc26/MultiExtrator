import { historyRepo } from '@/lib/storage/history-repo'
import { toCsv } from '@/lib/utils/csv'
import { downloadBlob, downloadText } from '@/lib/utils/download'
import { FLUXO_LABEL } from '@/types/engine'
import type { ExtractionRecord } from '@/types/extraction'
import { estimate } from '@/config/pricing'

/**
 * Créditos estimados de uma extração pela tabela (2–5 por fatura). O valor
 * final é do servidor; sem PDF, a política de cobrança de falhas também é dele.
 */
export function creditEstimate(r: ExtractionRecord): { label: string; hint: string } {
  const live = !r.concluidoEm
  if (live) {
    const e = estimate('fatura', r.referencias.length)
    return { label: `${e.min}–${e.max}`, hint: 'Estimativa pela tabela (2–5 créditos por fatura)' }
  }
  const faturas = r.arquivos.filter((a) => !a.nome.endsWith(' Old.pdf')).length
  if (!faturas) return { label: '—', hint: 'Sem fatura baixada: a cobrança de falhas é definida pelo servidor' }
  const e = estimate('fatura', faturas)
  return { label: `${e.min}–${e.max}`, hint: `Estimativa para ${faturas} fatura(s); o valor final é confirmado pelo servidor` }
}

/** Linhas da prévia tabular / CSV: uma por PDF (ou uma só, sem PDF). */
export function resultRows(r: ExtractionRecord) {
  const base = {
    id: r.id,
    job_id: r.jobId ?? '',
    fluxo: FLUXO_LABEL[r.fluxo],
    uc: r.uc ?? '',
    status: r.status,
    observacao: r.observacao,
    duracao_s: r.duracaoS ?? '',
    criado_em: r.criadoEm,
  }
  if (!r.arquivos.length)
    return [{ ...base, referencia: r.referencias.join(', '), arquivo: '', tamanho_bytes: null as number | null }]
  return r.arquivos.map((a) => ({
    ...base,
    referencia: a.referencia ?? '',
    arquivo: a.nome,
    tamanho_bytes: a.tamanho_bytes as number | null,
  }))
}

const slug = (r: ExtractionRecord) => `extracao-${r.fluxo}-${r.uc ?? 'sem-uc'}-${r.id.slice(0, 8)}`

export function downloadJson(r: ExtractionRecord) {
  const payload = {
    id: r.id,
    job_id: r.jobId,
    fluxo: r.fluxo,
    uc: r.uc,
    referencias: r.referencias,
    estado: r.estado,
    status: r.status,
    observacao: r.observacao,
    duracao_s: r.duracaoS,
    criado_em: r.criadoEm,
    concluido_em: r.concluidoEm,
    arquivos: r.arquivos,
    timeline: r.timeline,
    resposta_motor: r.respostaBruta,
  }
  downloadText(JSON.stringify(payload, null, 2), `${slug(r)}.json`, 'application/json')
}

export function downloadCsv(r: ExtractionRecord) {
  downloadText(toCsv(resultRows(r)), `${slug(r)}.csv`, 'text/csv')
}

export async function downloadPdf(r: ExtractionRecord, nome: string) {
  const blob = await historyRepo.getFile(r.id, nome)
  if (!blob) throw new Error('O PDF não está mais disponível neste navegador.')
  downloadBlob(blob, nome)
}

export async function pdfUrl(r: ExtractionRecord, nome: string) {
  const blob = await historyRepo.getFile(r.id, nome)
  return blob ? URL.createObjectURL(blob) : null
}
