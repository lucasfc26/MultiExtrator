import { z } from 'zod'

/**
 * Variáveis de ambiente validadas na inicialização: a API não sobe com
 * configuração inválida. Documentação de cada uma em backend/.env.example.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  API_PREFIX: z.string().default('api/v1'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de pelo menos 32 caracteres'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool,

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Fatturas <nao-responda@fatturas.local>'),
  MAIL_SALES_TO: z.string().default('comercial@fatturas.local'),

  WORKER_URL: z.string().url().default('http://worker:8000'),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(3000),

  STORAGE_DIR: z.string().default('./storage'),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  EXPIRY_WARNING_DAYS: z.coerce.number().int().positive().default(5),
  DOWNLOAD_URL_SECRET: z.string().min(32, 'DOWNLOAD_URL_SECRET precisa de pelo menos 32 caracteres'),
  DOWNLOAD_URL_TTL_S: z.coerce.number().int().positive().default(300),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  SIGNUP_BONUS_CREDITS: z.coerce.number().int().nonnegative().default(200),
  COST_SITE_ENEL: z.coerce.number().int().positive().default(3),
  COST_CORPORATIVO: z.coerce.number().int().positive().default(2),
  COST_SEGUNDA_VIA: z.coerce.number().int().positive().default(5),
  EXTRACTION_COST_MIN: z.coerce.number().int().positive().default(5),
  EXTRACTION_COST_MAX: z.coerce.number().int().positive().default(8),
  LOW_CREDITS_THRESHOLD: z.coerce.number().int().nonnegative().default(20),

  PAYMENT_PROVIDER: z.enum(['fake']).default('fake'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'PAYMENT_WEBHOOK_SECRET precisa de pelo menos 16 caracteres'),
  PAYMENT_EXPIRES_MIN: z.coerce.number().int().positive().default(30),
})

export type Env = z.infer<typeof schema>

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuração inválida:\n${msg}`)
  }
  return parsed.data
}

/** Token de injeção da configuração já validada. */
export const ENV = Symbol('ENV')
