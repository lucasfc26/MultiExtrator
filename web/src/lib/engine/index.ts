import { config } from '@/lib/config'
import { mockEngine } from './mock'
import { n8nEngine } from './n8n'
import { platformEngine } from './platform'
import type { ExtractionEngine } from './types'
import { workerEngine } from './worker'

const engines = { worker: workerEngine, n8n: n8nEngine, mock: mockEngine, platform: platformEngine } as const

export const engine: ExtractionEngine = engines[config.engine]

export const ENGINE_LABEL = {
  worker: 'Worker Python',
  n8n: 'Webhooks n8n',
  mock: 'Simulador (demo)',
  platform: 'API Fatturas',
} as const

export type { ExtractionEngine, EngineHealth } from './types'
