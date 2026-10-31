# Arquitetura e decisões

## Visão geral

```
navegador ──► web (Vite) ──/api──► API NestJS ──► PostgreSQL
                                     │  ├──► worker Python (busca na ENEL)
                                     │  ├──► Mailpit / SMTP
                                     │  └──► storage (disco local no dev)
cliente da API ──Bearer ftt_live_…──┘
```

O frontend nunca chama o worker diretamente quando usa a API (`VITE_ENGINE=platform`).
É a API que reserva créditos, guarda arquivos e cobra.

## Autenticação

- **Senhas**: argon2id.
- **Sessão**:
  - access token JWT de 15 min, em cookie `ftt_at`;
  - refresh token opaco de 30 dias, em cookie `ftt_rt`;
  - os dois cookies são `HttpOnly`, `SameSite=Lax`, e `Secure` em produção;
  - nada fica em `localStorage`.
- **Renovação silenciosa**: com o access vencido e o refresh válido, o guard troca o refresh por um novo (rotação) e devolve cookies novos na mesma resposta.
- **Reuso de refresh**: um refresh já trocado, reapresentado depois de 20 s, revoga a família inteira, porque indica possível roubo. Abaixo de 20 s é tolerado, para abas e requisições paralelas.
- **Tokens de e-mail** (verificação e redefinição): de uso único, guardados só como hash, com expiração.
- **Rate limit**: 300 req/min por IP no geral; login 10/min; cadastro, recuperação e contato 3–5/min.
- **CSRF**: os cookies `SameSite=Lax` e o corpo JSON obrigatório impedem que outro site faça POST autenticado.
- **API keys**:
  - formato `ftt_live_…` (36 caracteres aleatórios);
  - guarda só o SHA-256 e um prefixo público;
  - aceitas apenas em rotas marcadas com `@AllowApiKey`: faturas, extrator e créditos;
  - limite de 10 chaves ativas por conta.

## Créditos (ledger)

- **Invariante**: `CreditAccount.available + reserved = Σ CreditTransaction.credits (CONFIRMED)`.
- **Ledger** (`CreditTransaction`): só movimentos definitivos (compra, consumo, estorno, ajuste). É imutável e cada linha tem uma `idempotencyKey` única.
- **Reservas** (`CreditReservation`): movem saldo de "disponível" para "reservado" na projeção, sem tocar o ledger.
- **Concorrência**: a reserva é um `UPDATE … WHERE available >= n` atômico. Duas requisições simultâneas nunca consomem o mesmo saldo (comprovado pelo teste e2e).
- **Liquidação**: troca de status condicional (`ACTIVE → CONSUMED/RELEASED`), então só a primeira chamada tem efeito. Retries não cobram duas vezes.
- **Bônus de cadastro**: `ADJUSTMENT` de +200, com a chave `signup-bonus:<userId>`.

## Cobrança (premissas configuráveis no `.env`)

| Operação | Reserva | Cobrança | Falha |
|---|---|---|---|
| Nova fatura · Corporativo | 2 × meses | 2 por PDF entregue | não cobra |
| Nova fatura · Enel | 3 × meses | 3 por PDF entregue | não cobra |
| Nova fatura · 2 VIA | 5 × meses | 5 por PDF entregue | não cobra |
| Extrator | 8 por arquivo | 5–8 (unidades informadas pelo conversor) | não cobra |

- **Diferença de custo por fluxo**: segue a dificuldade de cada um. O Corporativo não tem captcha, o Enel tem reCAPTCHA e a 2 VIA tem hCaptcha e código.
- **"Atenção" sem PDF**: a ENEL respondeu, mas não havia fatura. Não cobra.
- **Refaturamento**: a cópia " Old" do PDF não é cobrada.
- **Estorno de pagamento** (`REFUND`): debita os créditos comprados, mesmo que o saldo fique negativo, como acontece num chargeback.

## Pagamentos

- **`PaymentGateway`**: interface que um provedor real implementa (Mercado Pago, Pagar.me, Stripe…), usando checkout hospedado ou tokenização. A API nunca recebe dados de cartão.
- **Webhook**: a assinatura é calculada sobre o corpo cru. O evento é gravado em `PaymentWebhookEvent` (único por provedor + id) antes de ser processado, e eventos repetidos devolvem 200 sem efeito.
- **Créditos**: só entram depois do evento `payment.confirmed`, com a chave `payment:<orderId>`.
- **Gateway de dev (`fake`)**: não cobra nada. `POST /payments/orders/:id/simulate` gera um webhook **assinado** que passa pelo mesmo caminho de um provedor real. Pedidos vêm com `demo: true`.
- **Expiração**: cobranças sem pagamento expiram depois de `PAYMENT_EXPIRES_MIN`.

## Nova fatura (worker)

1. `POST /invoices`:
   - valida os campos por fluxo;
   - reserva os créditos e cria o registro na mesma transação;
   - envia ao worker com `aguardar=false`.
   - A senha vai direto ao worker e não é gravada. O CPF/CNPJ fica gravado só mascarado.
2. Um poller consulta o worker a cada 3 s e registra a linha do tempo (`InvoiceEvent`).
3. Na conclusão:
   - baixa os PDFs e os guarda com prazo de 30 dias;
   - cobra pelo que foi entregue e libera o resto da reserva;
   - notifica.
   - Tudo isso sob `pg_try_advisory_xact_lock`: só um processo finaliza cada busca.
4. Erros que chegam antes do motor (dados inválidos ou motor fora do ar) liberam toda a reserva.
5. `Idempotency-Key` evita buscas duplicadas em retries do cliente.

## Arquivos e retenção

- **Chaves**: geradas pelo sistema. O nome enviado pelo usuário nunca vira caminho, e há checagem contra path traversal.
- **Uploads**: o tipo real é conferido pelos bytes (`%PDF-`, PNG, JPEG), não pela extensão.
- **Download**: `GET …/link` confere o dono e a validade e devolve uma URL assinada (HMAC) de 5 min.
- **Retenção** (de hora em hora):
  - apaga os arquivos vencidos e marca `deletedAt`, de forma idempotente;
  - o histórico continua consultável;
  - um aviso diário sai quando faltam 5 dias para vencer.
- **Backups e logs**: logs não registram senha, token nem conteúdo de fatura. Backups devem ter prazo próprio e ser sobrescritos (ver `docs/` quando houver produção).

## Pendências conhecidas

- **Conversor do Extrator**: a explicar e implementar.
- **Gateway de pagamento real**: o PIX, o checkout de cartão e o boleto do provedor escolhido.
- **Armazenamento S3** (MinIO no dev): o mesmo contrato do `StorageService`.
- **Redis + BullMQ**: os pollers atuais (`@Interval`) atendem uma instância. Para rodar várias, mover a fila para BullMQ. A finalização já está protegida por advisory lock.
- **Logs estruturados (Pino)** e CI no GitHub Actions.
- **Histórico no frontend**: com a API, o painel ainda mantém uma cópia local (IndexedDB). Falta passar a listar o histórico por `GET /invoices`.
