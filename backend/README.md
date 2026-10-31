# Fatturas — API (`backend/`)

API da plataforma em **NestJS 11 + Prisma 6 + PostgreSQL 16**. Cuida de contas,
créditos, pagamentos, API keys, notificações, histórico, arquivos e da
orquestração do motor de busca de faturas (o worker Python deste repositório).
O conversor do Extrator ainda não existe: a estrutura está pronta e ele entra
por uma interface (ver "Extrator").

## Subir em desenvolvimento (Docker)

Na raiz do repositório:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

| Serviço | Endereço |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/api/v1/docs |
| E-mails (Mailpit) | http://localhost:8025 |
| PostgreSQL | `localhost:5432` · usuário/senha/banco `fatturas` |
| Worker | http://localhost:8000/docs |

Usuário de teste: **dev@fatturas.local / Fatturas123**, criado pelo seed com
200 créditos.

As chaves dos captchas (`CAPSOLVER_API_KEY`, `NONECAP_API_KEY`) e o proxy da
2 VIA vêm do `.env` da raiz. Sem elas, só o fluxo Corporativo consegue rodar.

A API aplica as migrações e o seed ao subir. O código fica montado por volume,
então salvar um arquivo recarrega a API.

### Comandos úteis

```bash
docker compose -f docker-compose.dev.yml logs -f api            # logs
docker compose -f docker-compose.dev.yml exec api npx prisma studio --port 5555 --browser none
docker compose -f docker-compose.dev.yml exec api npx prisma migrate dev --name minha_mudanca
docker compose -f docker-compose.dev.yml down                   # para (mantém o banco)
docker compose -f docker-compose.dev.yml down -v                # apaga banco e arquivos
```

## Testes

```bash
npm test                 # unitários (Jest)
npm run test:e2e         # ponta a ponta contra a API rodando no Docker
```

O `test:e2e` cria usuários novos a cada execução e verifica:

- cadastro com validação e verificação de e-mail pelo Mailpit;
- bônus de 200 créditos;
- **concorrência**: 30 reservas simultâneas com saldo para 25 → 25 aceitas e 5 recusadas com 402, sem saldo negativo;
- arquivo com conteúdo falso recusado (415);
- **webhook de pagamento repetido** que não duplica créditos, e assinatura inválida recusada;
- API key: só nas rotas permitidas e inválida depois de revogada;
- isolamento entre usuários;
- motor fora do ar devolvendo a reserva;
- invariante do ledger;
- logout.

## Módulos

| Módulo | Responsabilidade |
|---|---|
| `auth` | Cadastro (bônus de boas-vindas), login, logout, verificação de e-mail, recuperação de senha, guard global |
| `users` | Perfil, troca de senha, encerrar sessões, exportação (LGPD), pedido de exclusão, preferências |
| `credits` | Ledger imutável, reservas, saldo, pacotes, regras de cobrança (`BillingService`) |
| `payments` | Pedidos, gateway (interface + gateway de dev), webhooks assinados e idempotentes, expiração |
| `api-keys` | Criação (segredo exibido uma vez, guarda só o SHA-256), revogação |
| `invoices` | **Nova fatura**: reserva → worker → acompanhamento → PDFs → cobrança |
| `extractions` | **Extrator**: upload validado, fila, conversor plugável, resultado |
| `storage` | Arquivos (disco local no dev), chaves internas, links de download assinados |
| `retention` | Apaga arquivos vencidos (mantém o histórico) e avisa antes |
| `notifications` | Central de notificações e e-mails conforme as preferências |
| `audit` | Registro de operações sensíveis |
| `misc` | Contato comercial, health check |

As decisões de arquitetura, cobrança, segurança e retenção estão em
[docs/arquitetura.md](docs/arquitetura.md).

## Extrator: onde entra o conversor

Implemente `ConverterAdapter` (`src/extractions/converter.ts`) e registre-o
no lugar de `NotConfiguredConverter` em `extractions.module.ts`:

```ts
export interface ConverterAdapter {
  convert(input: { extractionId; fileName; mimeType; data: Buffer }): Promise<{
    data: Record<string, unknown>   // JSON estruturado
    fields: ExtractedField[]        // campos principais para a prévia
    billableUnits?: number          // ex.: páginas — a cobrança fica entre 5 e 8
  }>
}
```

Lance `ConversionError` para falhas esperadas, como arquivo ilegível ou layout
não suportado: a extração vira `failed` com a mensagem e nada é cobrado. Fila,
reserva e liquidação de créditos, retenção do arquivo original e notificações já
estão prontas.
