import type { CodeSample } from '@/components/data-display/code-block'

/**
 * Exemplos do contrato REAL dos webhooks do n8n (README.md → API).
 * $N8N = URL pública do n8n; $CHAVE = valor da credencial "MultiExtractor API Key".
 */

export const SITE_ENEL_SAMPLES: CodeSample[] = [
  {
    lang: 'bash',
    label: 'cURL',
    code: `curl -X POST "$N8N/webhook/enel/site-enel" \\
  -H "X-API-Key: $CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "usuario": "login@empresa.com",
    "senha": "***",
    "uc": "12345678",
    "referencia": "07/2026",
    "tipo_conta": "empresa"
  }'`,
  },
  {
    lang: 'typescript',
    label: 'TypeScript',
    code: `const res = await fetch(\`\${N8N}/webhook/enel/site-enel\`, {
  method: 'POST',
  headers: { 'X-API-Key': CHAVE, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'login@empresa.com',
    senha: process.env.ENEL_SENHA,
    uc: '12345678',
    referencia: '07/2026',
  }),
  // a chamada fica aberta até a extração terminar (minutos)
  signal: AbortSignal.timeout(30 * 60_000),
})
const resultado = await res.json()
// resultado.status: "sucesso" | "atencao" | "erro"
for (const f of resultado.arquivos ?? []) {
  await fs.writeFile(f.nome, Buffer.from(f.pdf_base64, 'base64'))
}`,
  },
  {
    lang: 'python',
    label: 'Python',
    code: `import base64, requests

r = requests.post(
    f"{N8N}/webhook/enel/site-enel",
    headers={"X-API-Key": CHAVE},
    json={"usuario": "login@empresa.com", "senha": SENHA,
          "uc": "12345678", "referencia": "07/2026"},
    timeout=1800,  # fila + navegador + captcha
)
resultado = r.json()
for f in resultado.get("arquivos", []):
    with open(f["nome"], "wb") as fh:
        fh.write(base64.b64decode(f["pdf_base64"]))`,
  },
]

export const CORPORATIVO_SAMPLES: CodeSample[] = [
  {
    lang: 'bash',
    label: 'cURL',
    code: `curl -X POST "$N8N/webhook/enel/corporativo" \\
  -H "X-API-Key: $CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "usuario": "login@empresa.com",
    "senha": "***",
    "uc": "12345678",
    "referencia": "07/2026"
  }'`,
  },
  {
    lang: 'typescript',
    label: 'TypeScript',
    code: `const res = await fetch(\`\${N8N}/webhook/enel/corporativo\`, {
  method: 'POST',
  headers: { 'X-API-Key': CHAVE, 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario, senha, uc: '12345678', referencias: ['06/2026', '07/2026'] }),
  signal: AbortSignal.timeout(30 * 60_000),
})`,
  },
  {
    lang: 'python',
    label: 'Python',
    code: `r = requests.post(f"{N8N}/webhook/enel/corporativo",
                  headers={"X-API-Key": CHAVE},
                  json={"usuario": USUARIO, "senha": SENHA, "uc": "12345678"},
                  timeout=1800)`,
  },
]

export const SEGUNDA_VIA_SAMPLES: CodeSample[] = [
  {
    lang: 'bash',
    label: 'cURL',
    code: `# 1. Iniciar → HTTP 202 com url_codigo quando a ENEL envia o código
curl -X POST "$N8N/webhook/enel/segunda-via" -H "X-API-Key: $CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "uc": "12345678",
    "cpf_cnpj": "12.345.678/0001-99",
    "email_segunda_via": "financeiro@cliente.com.br"
  }'

# 2. Enviar o código (até 10 min). 409 = repita em 1–2 s
curl -X POST "$URL_CODIGO" -H "X-API-Key: $CHAVE" \\
  -H "Content-Type: application/json" -d '{"codigo":"123456"}'

# Código não chegou? peça outro
curl -X POST "$URL_CODIGO" -H "X-API-Key: $CHAVE" \\
  -H "Content-Type: application/json" -d '{"reenviar":true}'`,
  },
  {
    lang: 'typescript',
    label: 'TypeScript',
    code: `const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': CHAVE, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

let res = await post(\`\${N8N}/webhook/enel/segunda-via\`, { uc: '12345678', cpf_cnpj: CNPJ })
let json = await res.json()
while (res.status === 202) {
  const codigo = await perguntarAoCliente(json.observacao) // seu fluxo de OTP
  res = await post(json.url_codigo, { codigo })
  if (res.status === 409) { await new Promise(r => setTimeout(r, 1500)); continue }
  json = await res.json()
}
console.log(json.status, json.observacao)`,
  },
  {
    lang: 'python',
    label: 'Python',
    code: `r = requests.post(f"{N8N}/webhook/enel/segunda-via", headers=H,
                  json={"uc": "12345678", "cpf_cnpj": CNPJ}, timeout=1800)
while r.status_code == 202:
    pendente = r.json()
    codigo = input(pendente["observacao"] + " Código: ")
    r = requests.post(pendente["url_codigo"], headers=H,
                      json={"codigo": codigo}, timeout=1800)
print(r.json()["status"])`,
  },
]

export const RESPONSE_SAMPLE: CodeSample = {
  lang: 'json',
  label: 'Resposta',
  code: `{
  "job_id": "3f2a…",
  "fluxo": "site_enel",
  "uc": "12345678",
  "estado": "concluido",
  "status": "sucesso",
  "observacao": "1 fatura(s) baixada(s).",
  "arquivos": [
    {
      "nome": "07.2026 - 12345678.pdf",
      "referencia": "07/2026",
      "tamanho_bytes": 183214,
      "pdf_base64": "JVBERi0xLjQK…"
    }
  ],
  "duracao_s": 94.3
}`,
}
