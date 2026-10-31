/**
 * Teste de ponta a ponta contra a API rodando (docker compose -f docker-compose.dev.yml up).
 *
 *   node backend/test/smoke.e2e.mjs
 *
 * Usa o banco real e o Mailpit. Cria usuários novos a cada execução.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'

const API = process.env.API ?? 'http://localhost:3000/api/v1'
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025'
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-troque'

let falhas = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`)
  if (!cond) falhas++
}

/** Cliente com "pote" de cookies (sessão por usuário). */
function client() {
  const jar = new Map()
  return async function call(method, path, body, headers = {}) {
    const isForm = body instanceof FormData
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';')
      const [k, ...v] = pair.split('=')
      const val = v.join('=')
      if (val) jar.set(k, val)
      else jar.delete(k)
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: res.status, json }
  }
}

async function tokenFromMail(email, pathPart) {
  for (let i = 0; i < 20; i++) {
    const list = await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`).then((r) => r.json())
    for (const m of list.messages ?? []) {
      const msg = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`).then((r) => r.json())
      const match = new RegExp(`${pathPart}\\?token=([\\w-]+)`).exec(msg.Text ?? '')
      if (match) return match[1]
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

function sql(q) {
  return execSync(`docker compose -f docker-compose.dev.yml exec -T postgres psql -U fatturas -d fatturas -tAc "${q.replace(/"/g, '\\"')}"`, {
    cwd: new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  })
    .toString()
    .trim()
}

const pdf = () => new Blob([Buffer.from('%PDF-1.4\n% teste\n')], { type: 'application/pdf' })

async function main() {
  const email = `teste+${Date.now()}@fatturas.local`
  const senha = 'Senha12345'
  const a = client()

  // ── Cadastro, validação e bônus ────────────────────────────────────────────
  let r = await a('POST', '/auth/register', { name: 'Ana', email, password: 'curta', acceptTerms: true })
  ok(r.status === 400 && JSON.stringify(r.json.message).includes('8+'), 'cadastro recusa senha fraca (400)')
  r = await a('POST', '/auth/register', { name: 'Ana Teste', email, password: senha, acceptTerms: true })
  ok(r.status === 201, 'cadastro cria a conta (201)')
  r = await a('POST', '/auth/register', { name: 'Ana', email, password: senha, acceptTerms: true })
  ok(r.status === 409, 'e-mail repetido é recusado (409)')

  const verify = await tokenFromMail(email, 'verificar-email')
  ok(!!verify, 'e-mail de verificação chegou no Mailpit')
  r = await a('POST', '/auth/email/verify', { token: verify })
  ok(r.status === 204, 'verificação de e-mail aceita o token')
  r = await a('POST', '/auth/email/verify', { token: verify })
  ok(r.status === 422, 'token de verificação não pode ser reutilizado')

  r = await a('POST', '/auth/login', { email, password: 'errada123' })
  ok(r.status === 401, 'login com senha errada → 401')
  r = await a('POST', '/auth/login', { email, password: senha })
  ok(r.status === 200 && r.json.emailVerified === true, 'login abre sessão e o e-mail aparece verificado')

  r = await a('GET', '/credits/balance')
  ok(r.json?.available === 200, `saldo inicial = bônus de 200 (veio ${r.json?.available})`)

  // ── Concorrência: 30 extrações simultâneas reservam 8 cada (240 > 200) ─────
  const uploads = await Promise.all(
    Array.from({ length: 30 }, () => {
      const f = new FormData()
      f.append('file', pdf(), 'fatura.pdf')
      return a('POST', '/extractions', f)
    }),
  )
  const aceitos = uploads.filter((u) => u.status === 202).length
  const recusados = uploads.filter((u) => u.status === 402).length
  ok(aceitos + recusados === 30 && recusados > 0, `concorrência: ${aceitos} aceitos, ${recusados} recusados com 402 (sem saldo)`)
  r = await a('GET', '/credits/balance')
  ok(r.json.available >= 0, `saldo nunca negativo (disponível ${r.json.available}, reservado ${r.json.reserved})`)

  const f = new FormData()
  f.append('file', new Blob(['texto qualquer'], { type: 'application/pdf' }), 'falso.pdf')
  r = await a('POST', '/extractions', f)
  ok(r.status === 415, 'arquivo com extensão .pdf mas conteúdo falso é recusado (415)')

  // O conversor ainda não existe: as extrações falham e devolvem os créditos.
  await new Promise((res) => setTimeout(res, 6000))
  r = await a('GET', '/credits/balance')
  ok(r.json.available === 200 && r.json.reserved === 0, `conversor não configurado não cobra nada (disponível ${r.json.available})`)
  const ex = uploads.find((u) => u.status === 202)
  r = await a('GET', `/extractions/${ex.json.id}`)
  ok(r.json.status === 'failed' && /não foi configurado/.test(r.json.error), 'extração falha com mensagem clara')

  // ── Pagamento: webhook idempotente ─────────────────────────────────────────
  r = await a('POST', '/payments/orders', { packageId: 'pkg-400', method: 'pix' })
  ok(r.status === 201 && r.json.state === 'awaiting_payment' && r.json.demo === true, 'pedido PIX criado aguardando pagamento')
  const orderId = r.json.id
  r = await a('POST', `/payments/orders/${orderId}/simulate`, { outcome: 'confirmed' })
  ok(r.json.state === 'confirmed', 'webhook confirma o pagamento')
  r = await a('POST', `/payments/orders/${orderId}/simulate`, { outcome: 'confirmed' })
  r = await a('GET', '/credits/balance')
  ok(r.json.available === 600, `webhook repetido não duplica créditos (saldo ${r.json.available}, esperado 600)`)

  const providerRef = sql(`select "providerRef" from "PaymentOrder" where id='${orderId}'`)
  const raw = JSON.stringify({ eventId: `evt_${randomUUID()}`, type: 'payment.confirmed', providerRef })
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')
  const hook = (s) =>
    fetch(`${API}/payments/webhooks/fake`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fatturas-signature': s }, body: raw }).then(
      async (x) => ({ status: x.status, json: await x.json() }),
    )
  r = await hook('00'.repeat(32))
  ok(r.status === 401, 'webhook com assinatura inválida → 401')
  r = await hook(sig)
  const r2 = await hook(sig)
  ok(r.status === 200 && r2.json.duplicate === true, 'mesmo evento entregue 2× é reconhecido como duplicado')

  // ── API keys ───────────────────────────────────────────────────────────────
  r = await a('POST', '/api-keys', { name: 'ERP teste' })
  const secret = r.json.secret
  ok(r.status === 201 && secret.startsWith('ftt_live_'), 'API key criada (segredo exibido uma vez)')
  r = await fetch(`${API}/credits/balance`, { headers: { Authorization: `Bearer ${secret}` } }).then((x) => x.json())
  ok(r.available === 600, 'API key autentica rota de API')
  let st = await fetch(`${API}/api-keys`, { headers: { Authorization: `Bearer ${secret}` } }).then((x) => x.status)
  ok(st === 403, 'API key não acessa rotas só do painel (403)')
  await a('POST', `/api-keys/${(await a('GET', '/api-keys')).json[0].id}/revoke`)
  st = await fetch(`${API}/credits/balance`, { headers: { Authorization: `Bearer ${secret}` } }).then((x) => x.status)
  ok(st === 401, 'API key revogada não autentica mais (401)')

  // ── Isolamento entre usuários ──────────────────────────────────────────────
  const b = client()
  const emailB = `outro+${Date.now()}@fatturas.local`
  await b('POST', '/auth/register', { name: 'Bruno', email: emailB, password: senha, acceptTerms: true })
  await b('POST', '/auth/login', { email: emailB, password: senha })
  r = await b('GET', `/payments/orders/${orderId}`)
  ok(r.status === 404, 'usuário B não vê o pedido do usuário A (404)')
  r = await b('GET', `/extractions/${ex.json.id}`)
  ok(r.status === 404, 'usuário B não vê a extração do usuário A (404)')

  // ── Nova fatura com o motor fora do ar: devolve a reserva ──────────────────
  const antes = (await a('GET', '/credits/balance')).json.available
  r = await a('POST', '/invoices', { flow: 'corporativo', usuario: 'x', senha: 'y', uc: '123' })
  const depois = (await a('GET', '/credits/balance')).json
  if (r.status === 502) {
    ok(depois.available === antes && depois.reserved === 0, 'motor fora do ar → 502 e créditos reservados devolvidos')
  } else {
    ok(r.status === 202, `busca aceita pelo motor (status ${r.status})`)
  }
  r = await a('POST', '/invoices', { flow: 'segunda_via', uc: '123', cpf_cnpj: '1' })
  ok(r.status === 400, 'validação por fluxo: CPF/CNPJ inválido na 2 VIA → 400')

  // ── Invariante do ledger ───────────────────────────────────────────────────
  const uid = sql(`select id from "User" where email='${email}'`)
  const soma = Number(sql(`select coalesce(sum(credits),0) from "CreditTransaction" where "userId"='${uid}' and status='CONFIRMED'`))
  const acc = sql(`select available + reserved from "CreditAccount" where "userId"='${uid}'`)
  ok(Number(acc) === soma, `invariante: disponível + reservado (${acc}) = soma do ledger (${soma})`)

  // ── Sessão ─────────────────────────────────────────────────────────────────
  r = await a('POST', '/auth/logout')
  r = await a('GET', '/auth/me')
  ok(r.status === 401, 'depois do logout a sessão não vale mais (401)')

  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.')
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
