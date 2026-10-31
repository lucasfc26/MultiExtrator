import { Global, HttpStatus, Inject, Injectable, Module } from '@nestjs/common'
import { ENV, type Env } from '../config/env'
import { AppError } from '../common/http'

/** Contrato do worker Python (worker/app/main.py). */
export type WorkerFluxo = 'site_enel' | 'corporativo' | 'segunda_via'
export interface WorkerArquivo {
  nome: string
  referencia: string | null
  tamanho_bytes: number
  pdf_base64?: string
}
export interface WorkerResposta {
  job_id: string
  fluxo: WorkerFluxo
  uc: string | null
  estado: 'na_fila' | 'executando' | 'aguardando_codigo' | 'concluido'
  status: 'processando' | 'aguardando_codigo' | 'sucesso' | 'atencao' | 'erro'
  observacao: string
  arquivos?: WorkerArquivo[]
  duracao_s?: number
  expira_em_s?: number
  logs?: string[]
}

export class WorkerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const ROTA: Record<WorkerFluxo, string> = { site_enel: 'site-enel', corporativo: 'corporativo', segunda_via: 'segunda-via' }

/**
 * Adaptador do motor de busca de faturas. O resto da API não conhece os
 * detalhes do worker: só este cliente. Sempre usa aguardar=false (o
 * acompanhamento é feito pelo InvoicesPoller).
 */
@Injectable()
export class WorkerClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.env.WORKER_URL}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new WorkerError(502, 'O motor de extração está fora do ar.')
    }
    const json = (await res.json().catch(() => ({}))) as { observacao?: string }
    if (!res.ok) throw new WorkerError(res.status, json.observacao ?? `Motor respondeu ${res.status}.`)
    return json as T
  }

  start(fluxo: WorkerFluxo, entrada: Record<string, unknown>) {
    return this.call<WorkerResposta>('POST', `/extracoes/${ROTA[fluxo]}?aguardar=false&incluir_pdf=false`, entrada)
  }

  status(jobId: string, opts: { pdf?: boolean; logs?: boolean } = {}) {
    return this.call<WorkerResposta>(
      'GET',
      `/extracoes/${jobId}?aguardar=false&incluir_pdf=${!!opts.pdf}&logs=${!!opts.logs}`,
      undefined,
      opts.pdf ? 120_000 : 30_000,
    )
  }

  sendCode(jobId: string, body: { codigo?: string; reenviar?: boolean }) {
    return this.call<WorkerResposta>('POST', `/extracoes/${jobId}/codigo?aguardar=false&incluir_pdf=false`, body)
  }

  cancel(jobId: string) {
    return this.call<WorkerResposta>('DELETE', `/extracoes/${jobId}`, undefined, 60_000)
  }

  async health() {
    try {
      return { online: true, ...(await this.call<Record<string, unknown>>('GET', '/health', undefined, 5000)) }
    } catch (e) {
      return { online: false, error: (e as Error).message }
    }
  }
}

export function asHttp(e: unknown): never {
  if (e instanceof WorkerError) {
    const status = e.status === 422 ? HttpStatus.UNPROCESSABLE_ENTITY : e.status === 409 ? HttpStatus.CONFLICT : HttpStatus.BAD_GATEWAY
    throw new AppError(status, status === HttpStatus.BAD_GATEWAY ? 'ENGINE_UNAVAILABLE' : 'ENGINE_REJECTED', e.message)
  }
  throw e
}

@Global()
@Module({ providers: [WorkerClient], exports: [WorkerClient] })
export class EngineModule {}
