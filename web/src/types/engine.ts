/**
 * Contrato REAL do motor de extração (worker/app/main.py e webhooks do n8n).
 * Mudou o worker? Atualize aqui.
 */

export type Fluxo = 'site_enel' | 'corporativo' | 'segunda_via'

/** Ciclo de vida no worker: na_fila → executando ⇄ aguardando_codigo → concluido. */
export type EstadoJob = 'na_fila' | 'executando' | 'aguardando_codigo' | 'concluido'

/** `status` da API. "processando" enquanto não conclui. */
export type StatusJob = 'processando' | 'aguardando_codigo' | 'sucesso' | 'atencao' | 'erro'

export interface ArquivoFatura {
  nome: string
  referencia: string | null
  tamanho_bytes: number
  pdf_base64?: string
}

export interface RespostaExtracao {
  job_id: string
  fluxo: Fluxo
  uc: string | null
  estado: EstadoJob
  status: StatusJob
  observacao: string
  arquivos?: ArquivoFatura[]
  duracao_s?: number
  expira_em_s?: number
  /** Só no n8n: URL do webhook que espera o código da 2 VIA. */
  url_codigo?: string
  como_enviar?: string
  logs?: string[]
}

/** Erro do worker/n8n: `{"status":"erro","observacao":"..."}` com HTTP 4xx/5xx. */
export interface RespostaErro {
  status: 'erro'
  observacao: string
}

export interface EntradaReferencias {
  referencia?: string
  referencias?: string[]
}

export interface EntradaSiteEnel extends EntradaReferencias {
  usuario: string
  senha: string
  uc?: string
  tipo_conta?: 'empresa' | 'residencial'
}

export interface EntradaCorporativo extends EntradaReferencias {
  usuario: string
  senha: string
  uc: string
}

export interface EntradaSegundaVia extends EntradaReferencias {
  uc: string
  cpf_cnpj: string
  email_segunda_via?: string
  canal?: 'email' | 'telefone'
}

export type EntradaPorFluxo = {
  site_enel: EntradaSiteEnel
  corporativo: EntradaCorporativo
  segunda_via: EntradaSegundaVia
}

export interface EntradaCodigo {
  codigo?: string
  reenviar?: boolean
}

export interface WorkerHealth {
  ok: boolean
  chaves: { capsolver: boolean; nonecap: boolean }
  navegadores: Record<string, string>
  max_jobs_simultaneos: number
}

export const FLUXO_LABEL: Record<Fluxo, string> = {
  site_enel: 'Enel',
  corporativo: 'Corporativo',
  segunda_via: '2 VIA ENEL',
}
