# MultiExtractor — faturas ENEL via n8n

As três extrações do multiextrator do Status Energy viraram modelos de n8n.
Quem integra manda os dados de login por API e recebe de volta o PDF da fatura
com o status `sucesso`, `atencao` ou `erro`, mais a observação.

| Fluxo        | Webhook                         | Entrada                    | Captcha                      |
|--------------|---------------------------------|----------------------------|------------------------------|
| Site ENEL    | `POST /webhook/enel/site-enel`  | usuário + senha (+ UC)     | reCAPTCHA → CapSolver        |
| 2 VIA ENEL   | `POST /webhook/enel/segunda-via`| UC + CPF/CNPJ + código OTP | hCaptcha → NoneCap           |
| Corporativo  | `POST /webhook/enel/corporativo`| usuário + senha + UC       | —                            |

As chaves do CapSolver e do NoneCap ficam no servidor (`.env`), e quem chama a
API não as envia.

## Como funciona

```
cliente ──HTTP──► n8n (webhook + workflow) ──HTTP interno──► worker (Python)
                                                              └─ subprocesso por extração:
                                                                 navegador + scripts do multiextrator
```

O n8n não tem nó que controle navegador. Também precisa de alguém que mantenha
o navegador aberto enquanto a 2 VIA espera o código. Por isso existe o
**worker**, um serviço Python que roda os mesmos scripts do multiextrator
(`worker/extratores/`, ver [ORIGEM.md](worker/extratores/ORIGEM.md)). O n8n
recebe a API, autentica, chama o worker e devolve a resposta.

## Subir

```bash
cp .env.example .env      # preencha N8N_ENCRYPTION_KEY, CAPSOLVER_API_KEY e NONECAP_API_KEY
docker compose up -d --build
```

No n8n (`http://localhost:5678`, ou a `N8N_URL`):

1. Crie a credencial **Header Auth** com o nome `MultiExtractor API Key`.
   *Name* é o header (ex.: `X-API-Key`) e *Value* é a chave que os clientes
   vão usar.
2. Importe os três arquivos de [n8n/workflows/](n8n/workflows/) (menu
   *Import from File*). Em cada um, abra o nó **Receber pedido** (e o
   **Esperar código**, na 2 VIA) e selecione a credencial do passo 1.
3. Ative os três workflows.

## API

Todas as chamadas levam o header da credencial (ex.: `X-API-Key: <chave>`).
A chamada fica aberta até a extração terminar, o que pode levar vários minutos
(fila + navegador + captcha). Configure o timeout do cliente HTTP para pelo
menos 30 min.

### Resposta final (os três fluxos)

```json
{
  "job_id": "3f2a...",
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
      "pdf_base64": "JVBERi0xLjQK..."
    }
  ],
  "duracao_s": 94.3
}
```

| `status`  | Quando                                                                                     |
|-----------|--------------------------------------------------------------------------------------------|
| `sucesso` | PDF(s) baixado(s), nada a observar                                                         |
| `atencao` | A ENEL respondeu sem fatura ou com ressalva: fatura zerada, ainda não gerada, impressão bloqueada no Corporativo, plano ativo… Pode vir com ou sem PDF |
| `erro`    | Login/senha, UC ou CPF/CNPJ inválidos, captcha não resolvido, código OTP não informado, falha técnica |

Uma fatura refaturada pode vir em dois PDFs: a cancelada, com sufixo ` Old`,
e a atual.

HTTP: `200` com resultado (inclusive `erro` da ENEL), `202` quando a 2 VIA pede
o código, `422` para dados inválidos (`{"status":"erro","observacao":"..."}`),
`403` sem a chave ou com chave errada e `502` se o worker estiver fora do ar.

### Site ENEL

```bash
curl -X POST "$N8N/webhook/enel/site-enel" -H "X-API-Key: $CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"usuario":"login@empresa.com","senha":"***","uc":"12345678","referencia":"07/2026","tipo_conta":"empresa"}'
```

| Campo         | Obrigatório | Descrição                                                    |
|---------------|-------------|--------------------------------------------------------------|
| `usuario`     | sim         | login do Site ENEL                                           |
| `senha`       | sim         |                                                              |
| `uc`          | não         | nº do cliente; sem ele, a conta padrão do login              |
| `referencia`  | não         | `MM/AAAA`; padrão: mês atual                                 |
| `referencias` | não         | lista de `MM/AAAA` (vários meses numa chamada)               |
| `tipo_conta`  | não         | `empresa` (padrão) ou `residencial`                          |

### Corporativo (Agência Virtual)

```bash
curl -X POST "$N8N/webhook/enel/corporativo" -H "X-API-Key: $CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"usuario":"login@empresa.com","senha":"***","uc":"12345678","referencia":"07/2026"}'
```

Campos: `usuario`, `senha`, `uc` (obrigatórios; a UC precisa estar no
agrupamento do login), `referencia` / `referencias` (opcionais).

### 2 VIA ENEL: em duas etapas, com o código de segurança

**1. Iniciar**

```bash
curl -X POST "$N8N/webhook/enel/segunda-via" -H "X-API-Key: $CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"uc":"12345678","cpf_cnpj":"12.345.678/0001-99","referencia":"07/2026","email_segunda_via":"financeiro@cliente.com.br"}'
```

| Campo               | Obrigatório | Descrição                                                                  |
|---------------------|-------------|----------------------------------------------------------------------------|
| `uc`                | sim         | nº do cliente                                                              |
| `cpf_cnpj`          | sim         | do titular (com ou sem pontuação)                                          |
| `referencia(s)`     | não         | `MM/AAAA`; padrão: mês atual                                               |
| `email_segunda_via` | não         | e-mail que deve receber o código. A ENEL mostra os e-mails mascarados e este campo escolhe o certo |
| `canal`             | não         | `email` (padrão) ou `telefone` (SMS)                                       |

Depois do hCaptcha, a ENEL envia o código ao cliente e a resposta chega com
**HTTP 202**:

```json
{
  "job_id": "9c1e...",
  "estado": "aguardando_codigo",
  "status": "aguardando_codigo",
  "observacao": "A ENEL enviou o código de segurança para o cliente. Envie o código em até 10 minutos.",
  "expira_em_s": 598,
  "url_codigo": "https://n8n.suaempresa.com/webhook-waiting/1234",
  "como_enviar": "POST url_codigo com {\"codigo\": \"123456\"} ..."
}
```

Se a ENEL recusar os dados antes disso (UC/CPF inválidos, contrato
encerrado…), vem direto a resposta final com `erro`.

**2. Enviar o código** (até 10 min, mesmo header de autenticação)

```bash
curl -X POST "$URL_CODIGO" -H "X-API-Key: $CHAVE" \
  -H "Content-Type: application/json" -d '{"codigo":"123456"}'
```

- Resposta: o resultado final, com PDF.
- Se a ENEL recusar o código, ela mesma envia outro e a resposta é outro
  **202** com a mesma `url_codigo`. Basta mandar o novo código.
- Se o código não chegou, mande `{"reenviar": true}` para a ENEL enviar de novo.
- Sem código em 10 min, a extração é cancelada e o navegador fechado. Uma nova
  tentativa começa do passo 1.
- `409` ("running already") na `url_codigo` significa que o n8n ainda não
  voltou a esperar. Isso acontece em menos de 1 s depois do 202, ou enquanto o
  código anterior está sendo processado. Repita após 1–2 s. Depois do resultado
  final, a `url_codigo` não vale mais.

## Configuração (`.env`)

| Variável                                    | Padrão     | Para quê                                                   |
|---------------------------------------------|------------|------------------------------------------------------------|
| `CAPSOLVER_API_KEY`                         | —          | reCAPTCHA do Site ENEL                                     |
| `NONECAP_API_KEY`                           | —          | hCaptcha da 2 VIA                                          |
| `SEGUNDA_VIA_PROXY`                         | —          | proxy residencial da 2 VIA (IP de datacenter costuma ser barrado) |
| `NAVEGADOR_SITE_ENEL` / `NAVEGADOR_CORPORATIVO` | `camoufox` | `chrome` troca para o Google Chrome (Playwright)        |
| `MAX_JOBS_SIMULTANEOS`                      | `1`        | extrações em paralelo; as demais esperam na fila           |
| `JOB_TIMEOUT_S`                             | `1200`     | limite de cada extração (sem contar a espera do código)    |
| `OTP_TIMEOUT_S`                             | `600`      | espera pelo código da 2 VIA                                |
| `N8N_URL`                                   | `http://localhost:5678/` | URL pública: base dos webhooks e da `url_codigo` |

A 2 VIA usa sempre o Chrome, que é o caminho do NoneCap no multiextrator. No
Site ENEL e no Corporativo, o padrão é o Camoufox porque é o que passa pela
Imperva da ENEL hoje em produção. O `chrome` existe como alternativa e deve ser
testado antes de virar padrão.

**Capacidade:** cada extração abre um navegador inteiro. Numa VPS de 2 vCPU,
mais de uma por vez estrangula a CPU. Uma 2 VIA esperando o código segura a
vaga por até 10 min, e as outras chamadas esperam na fila.

## Segurança

- O worker não publica porta. Só o n8n, pela rede interna do compose, o alcança.
- Senhas e CPF/CNPJ passam pelo n8n. O compose desliga o salvamento de
  execuções com sucesso (que teriam o PDF), mas **execuções com erro ficam
  salvas com a entrada** por 7 dias. Restrinja o acesso ao editor do n8n.
- No worker, o payload com a senha só existe em disco enquanto o script lê.
  Os PDFs ficam 1 h (`JOB_TTL_S`) e depois são apagados.

## Ambiente de desenvolvimento completo (Docker)

Frontend + API (NestJS) + PostgreSQL + worker + Mailpit:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Painel em http://localhost:5173 (login `dev@fatturas.local` / `Fatturas123`),
API em http://localhost:3000/api/v1/docs e e-mails em http://localhost:8025.
Detalhes em [backend/README.md](backend/README.md).

## Frontend (`web/`)

Painel web que chama os três fluxos pelo worker ou pelo n8n, com histórico,
downloads e acompanhamento do código da 2 VIA. Veja [web/README.md](web/README.md):

```bash
cd web && npm install && npm run dev   # http://localhost:5173
```

## Depurar o worker

Descomente a porta do `worker` no `docker-compose.yml` e use
`http://localhost:8000/docs`. `GET /extracoes/{job_id}?logs=true` devolve as
últimas linhas de log do extrator.
