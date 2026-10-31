# Roadmap do frontend

Estado em 29/10/2026. Contexto: o backend de extração existe (worker Python +
n8n); o backend da plataforma (NestJS: auth, créditos, pagamentos, API keys,
notificações) ainda não.

## Auditoria (fase 1): feito

- Motor real mapeado: `worker/app/main.py` (POST `/extracoes/{fluxo}`,
  GET/DELETE `/extracoes/{id}`, POST `/extracoes/{id}/codigo`, `/health`) e
  webhooks n8n (`/webhook/enel/*`, `url_codigo` com 202/409).
- Formato de resultado: `status` sucesso/atencao/erro, `observacao`,
  `arquivos[].pdf_base64`, `duracao_s`. Não há upload, histórico nem cobrança.

## Fases 2–6: implementado

- [x] Vite + React 19 + TS strict, Tailwind v4 com tokens (cores, raios, sombras, animações), tema escuro/claro persistido
- [x] Componentes: botões, formulários (RHF + Zod), modal/confirmação com foco preso, tabela responsiva, paginação, badges, skeletons, toasts, estados vazio/erro, JSON viewer (lazy), blocos de código com cópia
- [x] Landing page (hero ilustrativo, funcionalidades, como funciona, API, preços demo, FAQ, footer) + termos, privacidade, suporte
- [x] Auth: login, cadastro, recuperação/redefinição, verificação de e-mail, sessão expirada, rotas protegidas
- [x] Layout autenticado: sidebar recolhível + drawer no celular, header com busca, saldo, notificações e menu da conta
- [x] Dashboard com indicadores, gráficos lazy (volume, consumo, status), filtro de período, últimas requisições e atalhos
- [x] Nova extração ligada ao motor real (3 fluxos, referências múltiplas, confirmação, acompanhamento, código OTP com contagem regressiva, cancelamento, logs)
- [x] Histórico com busca (debounce), filtros por status/tipo/período, ordenação, paginação na URL; detalhes com linha do tempo, JSON, tabela, downloads e expiração
- [x] Créditos: carteira, pacotes, checkout (PIX/cartão/boleto), status do pagamento, histórico financeiro
- [x] API keys (criar com segredo exibido uma vez, revogar com confirmação), documentação do contrato real
- [x] Perfil, configurações por categoria e central de notificações
- [x] 49 testes (Vitest + RTL): cliente HTTP, adaptadores, histórico, runner, schemas, auth, histórico/filtros, resultado, nova extração, tema, tabela, notificações, créditos

- [x] Renomeado o fluxo ENEL para **Nova fatura** (`/app/nova-fatura`; a rota antiga redireciona)
- [x] **Extrator**: upload (react-dropzone, validação de formato/tamanho, estimativa 5–8 créditos/arquivo, confirmação, acompanhamento, resultado em tabela/JSON, exportação JSON/CSV, arquivo original) e aba "Via API" com o contrato previsto
- [x] Páginas: Termos de uso, Privacidade, Retenção de arquivos, Suporte e Contato comercial (formulário validado)

## Pendências (dependem do backend da plataforma)

- [ ] Motor do Extrator (leitura de PDF/imagem) e endpoints `/api/v1/extractions`; trocar o simulador pelo serviço HTTP
- [ ] Preencher os dados `[entre colchetes]` das páginas legais e revisar com o jurídico

- [ ] Trocar `VITE_USE_MOCKS=false` e ajustar os serviços em `src/lib/api/services/` aos contratos reais (OpenAPI)
- [ ] Mover o histórico do IndexedDB para o backend (`GET /api/v1/extractions`), com paginação no servidor e retenção de 30 dias no storage
- [ ] Criar `lib/engine/platform.ts` para extrair via `/api/v1/extractions`, com reserva/consumo de créditos e estimativa antes do envio
- [ ] Gateway de pagamento: QR Code PIX, checkout hospedado e boleto vindos da API
- [ ] Notificações por SSE/WebSocket (hoje é polling a cada 30 s)
- [ ] Sessões ativas, troca de e-mail com confirmação e 2FA
- [ ] i18n, caso surjam outros idiomas
