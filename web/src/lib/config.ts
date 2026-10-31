const env = import.meta.env

export type EngineMode = 'worker' | 'n8n' | 'mock' | 'platform'

function engineMode(): EngineMode {
  const v = env.VITE_ENGINE
  return v === 'n8n' || v === 'mock' || v === 'platform' ? v : 'worker'
}

export const config = {
  /** Motor de extração real (worker Python ou webhooks do n8n) ou simulado. */
  engine: engineMode(),
  /** Plataforma (auth, créditos, pagamentos...) com dados demonstrativos. */
  useMocks: env.VITE_USE_MOCKS === 'true',
  apiBaseUrl: env.VITE_API_BASE_URL || '/api/v1',
  apiTimeoutMs: Number(env.VITE_API_TIMEOUT_MS) || 30_000,
  /** Prefixos do proxy do Vite (ver vite.config.ts). */
  workerBase: '/engine/worker',
  n8nBase: '/engine/n8n',
  /** Por quanto tempo o histórico local guarda os PDFs baixados. */
  retencaoLocalDias: 30,
  /** Aviso de expiração próxima. */
  avisoExpiracaoDias: 5,
  isDev: env.DEV,
} as const
