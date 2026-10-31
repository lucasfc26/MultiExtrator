import { z } from 'zod'

const email = z.string().trim().min(1, 'Informe o e-mail.').email('E-mail inválido.')
const password = z
  .string()
  .min(8, 'Use pelo menos 8 caracteres.')
  .regex(/[A-Za-z]/, 'Inclua ao menos uma letra.')
  .regex(/\d/, 'Inclua ao menos um número.')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Informe a senha.'),
})

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome.'),
    email,
    password,
    confirmPassword: z.string().min(1, 'Confirme a senha.'),
    acceptTerms: z.boolean().refine((v) => v, 'É preciso aceitar os termos e a política de privacidade.'),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem.' })

export const forgotSchema = z.object({ email })

export const resetSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem.' })

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Informe a senha atual.'), newPassword: password, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem.' })

export const profileSchema = z.object({ name: z.string().trim().min(2, 'Informe seu nome.') })

// ─── Extrações (espelha as validações do worker em worker/app/fluxos.py) ──────

/** "07/2026", "7/2026", "072026", "2026-07" → "07/2026". */
export function normalizarReferencia(valor: string): string | null {
  const t = valor.trim()
  let m = /^(\d{4})-(\d{1,2})$/.exec(t)
  let mes: number
  let ano: string
  if (m) {
    ano = m[1]
    mes = Number(m[2])
  } else {
    m = /^(\d{1,2})[/.-](\d{4})$/.exec(t) ?? /^(\d{2})(\d{4})$/.exec(t)
    if (!m) return null
    mes = Number(m[1])
    ano = m[2]
  }
  if (mes < 1 || mes > 12) return null
  return `${String(mes).padStart(2, '0')}/${ano}`
}

/** Janela da ENEL: os últimos 12 meses (incluindo o atual). */
export function ultimos12Meses(hoje = new Date()): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  })
}

const referencias = z
  .array(z.string())
  .max(12, 'No máximo 12 meses.')
  .superRefine((refs, ctx) => {
    const janela = new Set(ultimos12Meses())
    const fora = refs.filter((r) => !janela.has(r))
    if (fora.length)
      ctx.addIssue({ code: 'custom', message: `A ENEL só disponibiliza os últimos 12 meses (fora: ${fora.join(', ')}).` })
  })

const digitos = (campo: string) =>
  z
    .string()
    .trim()
    .refine((v) => /\d/.test(v), `${campo} deve ter números.`)

export const siteEnelSchema = z.object({
  usuario: z.string().trim().min(1, 'Informe o login da Enel.'),
  senha: z.string().min(1, 'Informe a senha.'),
  uc: z
    .string()
    .trim()
    .refine((v) => v === '' || /\d/.test(v), 'A UC deve ter números.'),
  tipo_conta: z.enum(['empresa', 'residencial']),
  referencias,
})

export const corporativoSchema = z.object({
  usuario: z.string().trim().min(1, 'Informe o login da Agência Virtual.'),
  senha: z.string().min(1, 'Informe a senha.'),
  uc: digitos('A UC').pipe(z.string().min(1, 'Informe a UC do agrupamento.')),
  referencias,
})

export const segundaViaSchema = z.object({
  uc: digitos('A UC'),
  cpf_cnpj: z
    .string()
    .trim()
    .refine((v) => [11, 14].includes(v.replace(/\D/g, '').length), 'CPF (11) ou CNPJ (14) dígitos.'),
  email_segunda_via: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'E-mail inválido.'),
  canal: z.enum(['email', 'telefone']),
  referencias,
})

export const codigoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(4, 'Informe o código recebido.')
    .max(12, 'Código longo demais.'),
})

export type SiteEnelForm = z.infer<typeof siteEnelSchema>
export type CorporativoForm = z.infer<typeof corporativoSchema>
export type SegundaViaForm = z.infer<typeof segundaViaSchema>
