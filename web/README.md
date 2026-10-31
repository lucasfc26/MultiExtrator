# Fatturas — frontend (`web/`)

Painel e landing page do Fatturas em React + Vite + TypeScript. Ele chama
**as funções reais deste repositório** (o worker Python e os webhooks do n8n)
pelo proxy do Vite. Autenticação, créditos, pagamentos, API keys e
notificações ainda não têm backend, então rodam com dados demonstrativos, sempre
marcados como **Demo** na interface.

## Rodar localmente

```bash
cd web
cp .env.example .env.local   # já vem pronto para o modo worker
npm install
npm run dev                  # http://localhost:5173
```

Qualquer e-mail e senha entram (modo demo). A conta fica só no navegador.

### Escolha o motor (`VITE_ENGINE` no `.env.local`)

| Modo     | O que chama                                         | Quando usar |
|----------|-----------------------------------------------------|-------------|
| `worker` | `worker/app/main.py` direto, com `aguardar=false` e polling | Teste local completo: fila, status ao vivo, cancelamento e logs do extrator |
| `n8n`    | `POST /webhook/enel/*` e a `url_codigo` da 2 VIA     | Testar o caminho que os clientes da API usam (chamada síncrona) |
| `mock`   | Simulador no navegador                              | Mexer na interface sem Docker. Tudo aparece como "Simulador" |

Reinicie o `npm run dev` depois de mudar o `.env.local`.

**Modo `worker`.** O worker não publica porta por padrão. No
`docker-compose.yml` da raiz, descomente as duas linhas do serviço `worker`:

```yaml
    ports:
      - "127.0.0.1:8000:8000"
```

Depois rode `docker compose up -d --build`. O selo "Motor" no rodapé do menu
lateral fica verde quando o worker responde, e avisa se faltar
`CAPSOLVER_API_KEY` ou `NONECAP_API_KEY`.

**Modo `n8n`.** Importe e ative os workflows (README da raiz). Depois coloque no
`.env.local` o valor da credencial *MultiExtractor API Key*:

```
VITE_ENGINE=n8n
N8N_API_KEY_HEADER=X-API-Key
N8N_API_KEY=<a chave>
```

A chave **não** tem prefixo `VITE_`: quem injeta o header é o proxy do Vite, e
ela não vai para o navegador. No modo n8n a chamada fica aberta até o fim da
extração. Não recarregue a página no meio dela: o resultado se perde, mas a
execução continua no n8n. Na 2 VIA, a `url_codigo` fica salva e o código pode
ser enviado mesmo depois de recarregar.

## O que é real e o que é demonstrativo

| Área | Situação |
|------|----------|
| Nova fatura (Site ENEL, Corporativo, 2 VIA + código OTP) | **Real**: worker ou n8n |
| Extrator (upload de faturas e via API → dados em JSON/CSV) | **Simulado**: o motor que lê a fatura ainda não existe; o resultado é fictício e marcado como tal. Contrato previsto em `src/lib/api/services/extractor.service.ts` |
| Contato comercial | Demo (fica no navegador); com backend: `POST /contact/sales` |
| Status, linha do tempo, cancelamento e logs | **Real** no modo worker |
| PDFs, JSON e CSV | **Real**. O CSV é gerado no navegador a partir da resposta |
| Histórico, dashboard e gráficos de extração | **Real**, guardado no navegador (IndexedDB) por 30 dias, porque o motor não tem histórico |
| Login, cadastro, perfil e configurações da conta | Demo (`VITE_USE_MOCKS=true`) |
| Saldo, pacotes, checkout e pagamentos | Demo, com botões para simular o retorno do gateway |
| API keys da plataforma | Demo. A chave real hoje é a credencial do n8n |
| Notificações | Demo + eventos reais das extrações deste navegador |

Com `VITE_USE_MOCKS=false`, os serviços chamam `VITE_API_BASE_URL` (padrão
`/api/v1`, com proxy para `BACKEND_URL`). Não há fallback silencioso para os
mocks: se a API falhar, a tela mostra o erro. Os contratos esperados estão
documentados no topo de cada arquivo em `src/lib/api/services/` e em
`src/lib/api/endpoints.ts`. São **provisórios**, porque o backend NestJS ainda
não existe.

## Scripts

```bash
npm run dev        # servidor de desenvolvimento com proxy
npm run build      # typecheck + build de produção (dist/)
npm test           # Vitest + Testing Library (sempre em modo mock)
npm run lint
npm run format
```

## Estrutura

```
src/
  app/             router (rotas lazy), providers, query client
  components/      ui/ (botões, formulários, diálogos), layout/, data-display/, charts/ (lazy), feedback/
  features/
    extractions/   runner (orquestra as extrações fora dos componentes), painel, formulários, exportação
    auth/          sessão, rotas protegidas
    api-docs/      exemplos de código do contrato real
  lib/
    engine/        adaptadores do motor: worker.ts, n8n.ts, mock.ts
    api/           cliente HTTP, erros, serviços da plataforma (http | mock)
    storage/       histórico local em IndexedDB
    validation/    schemas Zod (espelham worker/app/fluxos.py)
  mocks/           dados demonstrativos
  pages/           public/, protected/, shared/
  stores/          Zustand: preferências (tema), toasts, UI
```

## Pontos de atenção

- **Nova fatura x Extrator.** "Nova fatura" busca o PDF na ENEL (motor real).
  O "Extrator" recebe faturas por upload ou API e devolve os dados; enquanto o
  motor de leitura não existir, roda em modo simulado. Formatos e limites
  (PDF/PNG/JPG, 10 MB, 20 por envio) são provisórios, em `src/config/extractor.ts`.
- **Páginas institucionais.** Termos, Privacidade, Retenção, Suporte e Contato
  têm trechos `[entre colchetes]` destacados (razão social, CNPJ, e-mails, foro,
  prazos) que precisam ser preenchidos antes de publicar.
- **Preços e custos.** Pacotes (400 créditos por R$ 49, 6.000 por R$ 599 e
  12.000 por R$ 999) e custo por operação (extração 2–5, conversão 5–8 créditos)
  ficam em `src/config/pricing.ts`. A interface mostra **estimativas** por essa
  tabela; o débito real depende do backend da plataforma.
- **Worker fora do Docker no Windows.** Precisa do pacote `tzdata` (por causa do
  fuso `America/Fortaleza`) além dos navegadores dos extratores.
