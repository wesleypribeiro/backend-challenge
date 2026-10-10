# Arquitetura — Jungle Gaming

Estado: fundação P0 + F1 (`implement-money-wallet-ledger`) + F2 (`implement-wagering-transactions`) + F6 (`implement-financial-api-reconciliation`) implementadas. F3 (inbox/consumer), F4 (publisher outbox), F5 (scheduler de referências) e P1 permanecem abertos. O [README](README.md) é fonte de verdade; evidências executadas ficam em [implementation-notes.md](openspec/changes/implement-financial-api-reconciliation/implementation-notes.md).

## D1 — Monólito modular, processos independentes

Um repositório e uma imagem compilada, com entrypoints NestJS separados para API e worker. API usa Express; worker usa application context, sem listener HTTP ou consumers. Não há coordenação em memória entre processos. Camadas: `domain` puro (sem Nest/MikroORM/AWS SDK), `application` (use cases com EntityManager explícito), `platform` (infra), `modules/*/http` (controllers). O use case `ProcessWagerTransaction` é a única porta de escrita de transações — o consumer SQS futuro (F3) o reutilizará sem duplicar regras. Não existem interfaces genéricas ou repositórios abstraídos por antecipação.

## D2 — Build e compatibilidade verificáveis

Bun 1.4.2 é runtime, package manager e test runner. TypeScript 5.9.3 compila ESM sem bundling, com `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, decorators legados e metadata; imports locais terminam em `.js`. `reflect-metadata` precede a composição NestJS. NestJS, MikroORM 7 (driver PostgreSQL, pg) e AWS SDK v3 estão fixados no manifest/lockfile.

O Docker usa Bun fixado por digest, instalação congelada e estágios separados. Runtime contém `dist/`, dependências de produção e manifest, executando como usuário `bun`. Testes exercitam o JavaScript compilado, inclusive na imagem final. Typecheck sozinho não comprova o runtime.

## D3 — Configuração e lifecycle

Configuração imutável é validada por papel antes de abrir recursos. API/worker rejeitam credenciais migrator; provision não precisa de banco. Endpoint/região/credenciais SQS locais são explícitos. Clientes lazy permitem liveness mesmo com dependências indisponíveis.

SIGTERM/SIGINT ativam draining, cancelam probes, param aceite HTTP, aguardam requests e fecham contexto NestJS, pools e clientes. Prazo padrão máximo de 25 s com grace period Compose de 30 s; sucesso retorna 0, erro/timeout retorna 1.

## D4 — Compose e preparação explícita

`postgres` e `localstack` possuem healthchecks de acesso real. Jobs independentes `migrate` e `provision` antecedem API/worker por `service_completed_successfully`. Não existe schema sync ou provisionamento implícito nos processos de aplicação. Migrations financeiras (F1) criam tabelas `wagering.wallet`, `wagering.wallet_ledger_entry`, `wagering.wager_transaction`, `wagering.inbox_message`, `wagering.outbox_event` com constraints SQL (CHECK de aritmética de ledger, unicidade de efeitos, FKs) e triggers que negam UPDATE/DELETE/TRUNCATE no ledger (append-only imposto no banco). `wagering_app` não executa DDL; histórico de migrations fica em `public`.

Desenvolvimento e testes usam projetos/redes/volumes/databases/portas/filas separados; o harness gera UUIDs e confere ownership antes de limpar.

## D5 — MikroORM, PostgreSQL e concorrência

MikroORM fornece Unit of Work, Identity Map e transações explícitas. A API registra RequestContext por request (ALS); o worker usa `WorkerDatabaseContext.run` com fork/contexto limpo em `finally`. `allowGlobalContext` é falso. O use case controla a transação SQL: `ProcessWagerTransaction` abre transação explícita, aplica `SELECT ... FOR UPDATE` na wallet (pessimistic lock sob READ COMMITTED), valida regras de negócio e grava wallet + transação + ledger + outbox em um único flush (all-or-nothing). Wallets distintas avançam em paralelo; não existe mutex local nem lock global. Erros de transação abortada exigem novo contexto — o use case refaz o caminho em contexto limpo após rollback.

Decisão de contrato (F1 D6/F6): `Money` é imutável, encapsula decimal exato (`decimal.js`), recebe/serializa strings de escala 2 e persiste em `NUMERIC(20,2)` + moeda; `number`/`parseFloat` nunca tocam o dinheiro. Wallet única por (player, moeda) com saldo não negativo; ledger append-only reconstrói o saldo; unicidade de idempotência (`provider_id, external_transaction_id`) e unicidade de efeitos (outbox/inbox por `eventId`) protegidas por constraints SQL. Referências (`WIN/REFUND/ROLLBACK`) usam estado `PENDING_REFERENCE` quando a referência ainda não existe; F5 tratará expiração/scheduler.

## D6 — Domínio financeiro (F1/F2)

- `Wallet` (aggregate root) expõe `open`, `credit`, `debit`; cada movimento gera `LedgerEntry` com `balanceBefore/After` e incrementa `version` somente quando o saldo muda.
- `WagerTransaction` cobre BET/WIN/LOSS/REFUND/ROLLBACK/OPENING com máquina de estados (`PENDING_REFERENCE` → `PROCESSED`/`REJECTED`); replay idempotente preserva o `result_balance` original.
- `ProcessWagerTransaction` (F2): idempotência por `(providerId, externalTransactionId)` + hash do payload (replay idêntico é 200; payload divergente é conflito 409), referências obrigatórias para REFUND/ROLLBACK, WIN opcionalmente referenciada, saldo insuficiente rejeitado com `failureCode`, LOSS sem movimentação de dinheiro. Cada transação aplicada emite `WagerTransactionProcessed`; cada movimento de saldo emite `WalletBalanceChanged` — ambos enfileirados na outbox na mesma transação (publicação é F4).
- Identificadores de negócio (F6.4/F6.5): rejeitam campo vazio, string só de espaços, tamanho acima do limite e `providerId === "internal"` (literal exato, reservado para operações internas como OPENING).

## D7 — API HTTP (F6)

A API financeira expõe (README §9) os sete endpoints:

| Método/rota | Sucesso | Notas |
|---|---|---|
| `POST /wallets` | 201 | criação atômica (wallet + OPENING + outbox); `(playerId, currency)` duplicado → 409 |
| `GET /wallets/:walletId` | 200 | 404 se desconhecida |
| `GET /wallets/:walletId/ledger?cursor&limit` | 200 | paginação keyset sobre `(created_at, id)`; cursor opaco base64url; `limit` 1–100 (default 50) |
| `POST /wagering/transactions` | 200/202 | header `Idempotency-Key` obrigatório (fonte da verdade, fora do body); 409 conflito de payload; 422 regra de negócio (`failureCode`) |
| `GET /wagering/transactions/:transactionId` | 200 | 404 se desconhecida |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | 200 | 404 se desconhecida |
| `POST /wallets/:walletId/reconciliation` | 200 | **somente leitura**: compara saldo materializado com a soma exata do ledger em SQL; divergência → log `reconciliation.divergence` (warn) + `consistent=false`; nunca corrige |

Contrato de erro único (filter global `FinancialExceptionFilter`): corpo `{statusCode, error, code, message, field?}`. Mapeamento: 400 `INVALID_PAYLOAD` (DTO/estrutura/identificador/cursor/limit/`Idempotency-Key` ausente), 404 `NOT_FOUND`, 409 `WALLET_ALREADY_EXISTS`/`IDEMPOTENCY_CONFLICT`, 422 `TRANSACTION_REJECTED`, 202 `PENDING_REFERENCE`, 503 `SERVICE_UNAVAILABLE` (falhas transitórias de conexão/driver), 500 `INTERNAL_ERROR` (corpo genérico; stack/SQL/credenciais nunca chegam ao cliente — log server-side com correlation id). Erros `HttpException` do Nest (status dinâmicos) são repassados pelo filter.

Replay de submissão preserva o saldo original observado (`idempotentReplay: true`), mesmo após movimentações posteriores à primeira observação.

Autenticação: sem pontuação no README §2; cada controller carrega um `NoopAuthGuard` como ponto de extensão documentado para um provider real (OIDC/JWT de IdP externo ou API key interna). Health permanece público e sem guard.

## D8 — SQS e topologia

SDK usa endpoint/credenciais locais explícitos, descoberta de QueueUrl/QueueArn, retries limitados e timeout real. Provisionamento cria DLQ antes da principal; ambas FIFO com `ContentBasedDeduplication=false`. Reexecução compatível só lê e preserva mensagens. Consumer (F3), publisher (F4) e scheduler (F5) não existem ainda; F6 deliberadamente não publica nem consome mensagens — a outbox permanece não publicada até F4.

## D9 — Health e logs

Health público separa processo vivo e dependências prontas; readiness usa conexões dedicadas e orçamento de I/O. Logs JSON usam allowlist estrita de campos e correlation id validado/gerado; nunca expõem URL, senha, token, payload ou stack. Eventos de domínio financeiro: `http.completed` (com statusCode em falhas 5xx) e `reconciliation.divergence` (warn, com walletId e valores exatos). Métricas/OTel permanecem fora do escopo.

## D10 — Evidências e testes

Bun Test é o único runner. Camada unitária cobre domínio puro, use cases com EntityManager fake, parsers de DTO, mapeamento de status de submissão e o exception filter. Integração usa PostgreSQL real descartável via `TestInfrastructure` e sobe a aplicação Nest (`createApiApplication`) em porta efêmera, exercitando os endpoints HTTP com `fetch` — inclusive replay idempotente, conflito de payload, `PENDING_REFERENCE`, rejeição 422, paginação do ledger, reconciliação divergente seedada (que permanece inalterada — a rota não escreve) e 503 com `DATABASE_URL` apontando porta fechada. Smoke preserva o 404 de rota inexistente (o filter repassa `HttpException`). Docker/Compose e migrations reversíveis continuam cobertos por testes próprios.

## Organização dos arquivos

```text
src/
  bootstrap/          # api, worker, migrate, provision, health-worker
  composition/        # raízes NestJS (ApiModule, WorkerModule)
  domain/
    wallet/           # Money, Wallet, LedgerEntry (puro)
    wagering/         # WagerTransaction, business-identifiers, payload-hash, events, outbox-message (puro)
  modules/
    wallet/           # application (open/get/list-ledger/reconcile), http (controller + dto), wallet.module
    wagering/         # application (process/get-transaction), http (controller + dto), wagering-http.module
  platform/
    auth/             # noop-auth.guard (ponto de extensão)
    config/           # validação por papel
    database/         # MikroORM, entidades, wallet.repository, migrations, contextos
    health/           # checks compartilhados e controllers públicos
    http/             # exception filter, invalid-payload, path-params
    lifecycle/        # draining e encerramento limitado
    logging/          # JSON, correlação e allowlist
    messaging/sqs/    # cliente, topologia e provisionamento
scripts/              # build e aceite da infraestrutura
tests/                # unit, smoke, integration, docker, support
docker/postgres/      # bootstrap idempotente de database/papéis
openspec/changes/     # mudanças OpenSpec (F1, F2, F6 e futuras)
```

## Pendências e próxima etapa

F3 (inbox + consumer SQS reutilizando `ProcessWagerTransaction`), F4 (publisher de outbox com claim/lease `FOR UPDATE SKIP LOCKED`), F5 (scheduler de `PENDING_REFERENCE` com expiração) e F7 (consolidação de concorrência/recuperação) permanecem abertos. P1 da fundação (migrations concorrentes, drift SQS, visibility/redrive, matriz adversarial de shutdown, cleanup) segue pendente e antecede fechamento/entrega final.

Autenticação real (OIDC/JWT) entra quando o escopo pontuar; o `NoopAuthGuard` é o swap point. Métricas financeiras/OTel e double-entry permanecem fora do timebox.
