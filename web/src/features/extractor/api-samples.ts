import type { CodeSample } from '@/components/data-display/code-block'

/**
 * Contrato PREVISTO do Extrator na API da plataforma. O endpoint ainda não
 * existe; a página sinaliza isso. Ajuste quando a OpenAPI for publicada.
 */
export const EXTRACTOR_SAMPLES: CodeSample[] = [
  {
    lang: 'bash',
    label: 'cURL',
    code: `# 1. Enviar a fatura (multipart) → 202 com o id
curl -X POST "$API/api/v1/extractions" \\
  -H "Authorization: Bearer $API_KEY" \\
  -F "file=@fatura-07-2026.pdf"

# 2. Consultar o status: queued | processing | completed | failed
curl "$API/api/v1/extractions/$ID" \\
  -H "Authorization: Bearer $API_KEY"

# 3. Baixar os dados extraídos
curl "$API/api/v1/extractions/$ID/result" \\
  -H "Authorization: Bearer $API_KEY"`,
  },
  {
    lang: 'typescript',
    label: 'TypeScript',
    code: `const headers = { Authorization: \`Bearer \${process.env.API_KEY}\` }

const form = new FormData()
form.append('file', new Blob([await fs.readFile('fatura.pdf')]), 'fatura.pdf')

const { id } = await fetch(\`\${API}/api/v1/extractions\`, {
  method: 'POST',
  headers,
  body: form,
}).then((r) => r.json())

let status = 'queued'
while (status === 'queued' || status === 'processing') {
  await new Promise((r) => setTimeout(r, 2000))
  ;({ status } = await fetch(\`\${API}/api/v1/extractions/\${id}\`, { headers }).then((r) => r.json()))
}

const { data } = await fetch(\`\${API}/api/v1/extractions/\${id}/result\`, { headers }).then((r) => r.json())
console.log(data.valor_total, data.vencimento)`,
  },
  {
    lang: 'python',
    label: 'Python',
    code: `import time, requests

H = {"Authorization": f"Bearer {API_KEY}"}

with open("fatura.pdf", "rb") as f:
    r = requests.post(f"{API}/api/v1/extractions", headers=H, files={"file": f})
job = r.json()

while True:
    st = requests.get(f"{API}/api/v1/extractions/{job['id']}", headers=H).json()
    if st["status"] in ("completed", "failed"):
        break
    time.sleep(2)

dados = requests.get(f"{API}/api/v1/extractions/{job['id']}/result", headers=H).json()
print(dados["data"]["valor_total"])`,
  },
]

export const EXTRACTOR_RESULT_SAMPLE: CodeSample = {
  lang: 'json',
  label: 'Resultado',
  code: `{
  "data": {
    "distribuidora": "ENEL",
    "numero_cliente": "12345678",
    "referencia": "07/2026",
    "vencimento": "20/07/2026",
    "valor_total": 412.37,
    "consumo_kwh": 350,
    "tributos": { "icms": 56.07, "pis": 3.24, "cofins": 14.89 },
    "itens": [{ "descricao": "Consumo de energia", "quantidade_kwh": 350, "valor": 311.50 }]
  },
  "fields": [{ "key": "valor_total", "label": "Valor total", "value": "R$ 412,37" }]
}`,
}
