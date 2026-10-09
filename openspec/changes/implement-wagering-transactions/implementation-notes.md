# Evidências de implementação — implement-wagering-transactions

Estado atual: **18/18 tarefas F2 concluídas** — 1.1–1.4 (domínio), 2.1–2.3 (persistência), 3.1–3.4 (use case), 4.1–4.3 (concorrência e invariantes) e 5.1–5.4 (correções da revisão independente do commit `5463e22`). Esta change entrega o processamento financeiro transacional: `WagerTransaction` com máquina de estados, `ProcessWagerTransaction` com lock pessimista (`SELECT FOR UPDATE`), idempotência persistente por chave e por `(providerId, externalTransactionId)`, validação estrutural de identificadores de negócio, criação atômica da transação interna `OPENING` com seus eventos de integração, referências `REFUND`/`ROLLBACK`/`WIN` com escopo validado e `PENDING_REFERENCE` (inclusive para WIN com referência opcional informada), detecção de divergência por hash canônico e outbox transacional. API pública, inbox/consumer SQS, publisher de outbox e scheduler de referências continuam fora do escopo (F3–F5). Nenhum commit, push ou PR foi criado; as alterações estão no working tree sobre o commit `d48b4b5`.

Comando para reproduzir as evidências:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bun run build
bun run test:unit
DOCKER_CONTEXT=default bun run test:integration
DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts
openspec validate implement-wagering-transactions --type change --strict --no-interactive
```

## Comandos e resultados observados (execução final)

| Comando/verificação | Resultado |
|---|---|
| `bun run typecheck` | Exit 0, TypeScript strict sem relaxamento |
| `bun run build` | Exit 0, ESM emitido em `dist/` |
| `bun run test:unit` (`./tests/unit ./tests/smoke`) | **150 pass, 0 fail, 574 asserções**, 15 arquivos |
| `DOCKER_CONTEXT=default bun run test:integration` | **56 pass, 0 fail, 530 asserções**, 7 arquivos, PostgreSQL/LocalStack reais (137,18 s) |
| `DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts` | **2 pass, 0 fail, 101 asserções**; três migrations no container |
| `openspec validate implement-wagering-transactions --type change --strict --no-interactive` | Change válida, exit 0 |

## Decisões implementadas

### Domínio (`src/domain/wagering/`, `src/domain/wallet/`)

- `FailureCode` (`failure-code.ts`): taxonomia fechada `INSUFFICIENT_FUNDS`, `ROLLBACK_INSUFFICIENT_FUNDS`, `WALLET_PLAYER_MISMATCH`, `CURRENCY_MISMATCH`, `REFERENCE_{PROVIDER,PLAYER,WALLET,CURRENCY,ROUND,MONEY}_MISMATCH`, `REFERENCE_KIND_NOT_ALLOWED`, `DUPLICATE_REVERSAL` e `REFERENCE_NOT_FOUND` (apenas F5). Erros estruturais (abertura via provider, kind `OPENING`) lançam exceção de domínio — nunca são persistidos como `REJECTED`.
- `WagerTransaction` (`wager-transaction.ts`): máquina de estados `PENDING` → `PROCESSED`/`REJECTED`/`PENDING_REFERENCE`/`FAILED` (transições terminais elevam); regras de referência por kind (`OPENING` é interno, REFUND/ROLLBACK exigem referência, WIN aceita referência opcional e — se informada e irresolvida — espera via `waitsForReference()`/`markPendingReference()`, BET/LOSS proíbem); `affectsBalance` (LOSS não move saldo), `ledgerDirectionFor`, `matchesPayload`; entidade **não** é congelada (transições são mutações legítimas, estilo `Wallet`); os eventos concretos são congelados nos factories `from()`.
- Identificadores de negócio (`business-identifiers.ts`): `assertValidBusinessIdentifiers` valida tipo string, não-vazio, limites de tamanho por campo (providerId 64, external/idempotency 128/255, round/game 64) e forma UUID para playerId/walletId; violação levanta `InvalidBusinessIdentifierError` com o campo ofensor — erro estrutural, nunca rejeição persistida.
- `canonicalPayloadHash` (`payload-hash.ts`): JSON de chaves ordenadas dos campos de negócio + SHA-256; campos de transporte/metadados excluídos; divergência de valor/moeda/referência altera o hash.
- Eventos (`events.ts`): `IntegrationEvent` abstrato com envelope `toJSON()` (`eventType`, `version`, `data`, decimal strings via `MoneyProps`); concretos `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`.
- `Wallet.debit`/`Wallet.credit` (`wallet.ts`): saldo não-negativo, incremento de `version`, aritmética via `Money` imutável.
- `OutboxMessage` (`outbox-message.ts`): agregado de publicação (status `PENDING`/`PUBLISHED`, `attempts >= 0`, payload JSONB).

### Persistência (`src/platform/database/`)

- `Migration20261009000300`: tabelas `wagering.wager_transaction` (UNIQUE `provider_id + external_transaction_id`, UNIQUE `idempotency_key`, CHECKs de kind/status, `amount > 0`, self-FK `reference_transaction_id` DEFERRABLE, FK de wallet DEFERRABLE, coluna `result_balance` como snapshot de replay) e `wagering.outbox_event` (status, payload JSONB, `attempts`); FK `wallet_ledger_entry.transaction_id → wager_transaction(id) DEFERRABLE INITIALLY DEFERRED` (padrão unit-of-work da F1); índice parcial `wager_transaction_reversal_unique (reference_transaction_id, kind) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')` — WIN pode referenciar BET livremente sem disputar o índice. Ciclo up/down/up verificado em ambientes descartáveis (nenhum banco persistente existe — sem volume nomeado, sem containers remanescentes).
- `EntitySchema` class-less (`wager-transaction.entity.ts`, `outbox-event.entity.ts`), registrados em `schemas.ts` e `orm-options.ts`; mappers `toWagerTransactionDomain`/`fromWagerTransactionDomain` incluem `resultBalance`.
- `WalletRepository.saveOpen` cria a transação `OPENING` no mesmo flush: provider `internal`, external `opening-{walletId}`, key `internal:opening-{walletId}`, round/game `internal`, status `PROCESSED`, id = `entry.transactionId`, `resultBalance` = saldo inicial — e, por README §11, enfileira `WagerTransactionProcessed` + `WalletBalanceChanged` no mesmo flush (correlation `internal:opening-{walletId}`); abertura de saldo zero não escreve transação, ledger nem eventos. O ledger nunca aponta para transaction id órfão.

### Use case (`src/modules/wagering/application/process-wagering-transaction.ts`)

- Dono da transação SQL (D5): validação estrutural de identificadores **antes** de qualquer transação → pre-lock lookup por `idempotencyKey` OU `(providerId, externalTransactionId)` → replay imediato sem lock quando já existe; caso contrário lock da wallet `FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) → re-lookup pós-lock → validação (player, moeda, amount, saldo, escopo de referência) → `Wallet.debit`/`credit` → **um único `em.flush()`** persistindo transaction + ledger + outbox.
- Ordem de ids no caminho BET: entity id, ledger id, processed-event id, balance-event id — seam `options.idGenerator` permite injetar falhas determinísticas nos testes.
- `23505` (corrida residual) → `recover()`: rollback e reprocessa uma vez em `em.fork()` novo com re-leitura fresca.
- Resultado é discriminated union (`processed`/`rejected`/`pendingReference`/`conflict`) com flag `idempotentReplay`; replay devolve o `resultBalance` original armazenado, não o saldo corrente.
- REFUND/ROLLBACK: referência resolvida por `(providerId, referenceExternalTransactionId)`; checagem de escopo provider→player→wallet→moeda→round; igualdade de valor só para REFUND/ROLLBACK; direção invertida pela referência; referência ausente ou não-`PROCESSED` → `PENDING_REFERENCE` persistido sem saldo/ledger (vale também para WIN com referência opcional informada); segunda reversão do mesmo par → `DUPLICATE_REVERSAL` (índice parcial + checagem).
- Outbox por outcome no mesmo flush; `conflict` e `replay` não geram eventos; linhas permanecem `PENDING` (publisher é F4).

### Concorrência e invariantes (`tests/integration/wager-concurrency.test.ts`, `tests/support/invariants.ts`)

- S13-C01: a mesma aposta enviada 50× em paralelo → exatamente 1 `PROCESSED` efetivo, 49 replays, um único débito, uma linha BET, um único `transactionId`; retry posterior não duplica.
- S13-C02: 80/80 vs 100 em paralelo → 1 `PROCESSED`, 1 `REJECTED INSUFFICIENT_FUNDS`, saldo 20.00, um único `DEBIT`.
- S13-C03: lock de wallet A mantido por conexão dedicada (`pg` Client próprio, transação aberta) → backend de A aparece em `pg_stat_activity` com `wait_event_type='Lock'` (barreira observável, sem sleep como prova) enquanto aposta em wallet B distinta completa; liberação do lock deixa A concluir.
- Adicional: 10 apostas de 15.00 contra 100.00 → exatamente 6 aplicadas, 4 rejeitadas, saldo 10.00, invariante reconstruída.
- Invariante S13-G01 (`tests/support/invariants.ts`, helper compartilhado): `wallet.balance == Σ(CREDIT) − Σ(DEBIT)` sobre **todos** os lançamentos, aplicado em todos os cenários com wallet persistida (processamento e concorrência).

## Testes executados (cobertura nova)

- Unit de wagering (`tests/unit/domain/wagering/`, 4 arquivos): máquina de estados e regras de kind/referência de `WagerTransaction` (incluindo `waitsForReference`/`markPendingReference` para WIN); validação de identificadores de negócio; independência de ordem de campos e exclusões do hash canônico; envelope dos quatro eventos concretos. `wallet.test.ts` estendido com `debit`/`credit` (versão, negativos).
- Integração `wager-transaction-processing.test.ts` (22 cenários): BET atômico (saldo, ledger, transaction, dois eventos); insuficiência sem efeito; replay idêntico com saldo observado original; divergência de payload → `conflict` sem nova linha; `(provider, external)` reutilizado com chave nova; LOSS sem ledger/saldo/evento; WIN com e sem referência; WIN com referência ausente → `PENDING_REFERENCE` + replay idempotente; mismatch moeda/jogador; OPENING estrutural; eventos do OPENING atômicos e abertura zero sem eventos; identificadores inválidos sem escritas; REFUND pendente permanece pendente (replay idempotente; submissão de chave nova é transação distinta — resolução é F5); `DUPLICATE_REVERSAL`; códigos próprios de REFUND inválida; `ROLLBACK` inverso + `ROLLBACK_INSUFFICIENT_FUNDS`; escopo de referência (wallet cruzada via wallet USD do mesmo player — `REFERENCE_WALLET_MISMATCH`; round cruzado); rollback atômico com falha injetada no ledger id (PK do `OPENING` existente → 23505 real; generator ímpar/par garante que até o retry de `recover()` re-incide e nada é commitado).
- Integração `wager-concurrency.test.ts` (novo, 4 cenários S13-C01/C02/C03 + overdraw).
- Fundação atualizada para três migrations e quatro tabelas: `postgresql-foundation.test.ts` (ciclo up/up/down×3/up, histórico, `COLLATE "C"`), `health.test.ts`, `wallet-ledger.test.ts` (assertOpeningPair com transação real, FK de `transaction_id` usando transação de outra wallet para não ser mascarada pelo `UNIQUE(wallet_id, transaction_id)`, FK composta), `docker/migrations.test.ts` e `docker/compose.test.ts` (listas e sequência de rollbacks).

Nenhum teste existente foi removido ou enfraquecido; as alterações em testes antigos corrigem expectativas para o terceiro modelo e para o `OPENING` atômico.

## Problemas encontrados e soluções

1. **`Object.freeze(this)` no construtor base de `IntegrationEvent`** quebrava subclasses (field initializers rodam depois do super; `Object.freeze` no `this` base não congela instâncias de subclasses, mas a intenção era congelar os eventos concretos) — congelamento movido para os factories `from()`.
2. **Mapper `toWagerTransactionDomain` não mapeava `resultBalance`** — replay retornava saldo errado; corrigido e coberto pelo teste de replay com movimentação posterior.
3. **Filtro de eventos por wallet errado** — o payload é `{data: {walletId, ...}}`; a query correta usa `payload->'data'->>'walletId'`.
4. **Injeção de falha por PK idêntica não gerava 23505** — o Unit of Work do MikroORM mescla creates com o mesmo PK em um único insert. A falha injetada agora colide com o **ledger id do `OPENING` já existente no banco** (call par do generator), e o generator ímpar/par garante que o retry de `recover()` re-incide e propaga o erro — nada é commitado (linhas, eventos e saldo inalterados).
5. **Ordem de eventos no teste BET** — ordenação alfabética real é `WagerTransactionProcessed` antes de `WalletBalanceChanged` (`g` < `l`); expectativas corrigidas.
6. **Saldo esperado dos testes de REFUND** — open 100 − BET 20 + REFUND 20 = 100.00 (não 120.00); expectativas corrigidas.
7. **`UNIQUE(player_id, currency)` impede duas wallets BRL do mesmo player** — o teste de `REFERENCE_WALLET_MISMATCH` usa a wallet USD do mesmo player (a checagem de wallet precede a de moeda da referência), com `openWalletWithCurrency`.
8. **Tipagem do spread de union em expectativa de replay** — `{...first, idempotentReplay: true}` produzia união inválida (`conflict` sem saldo); expectativa reescrita com `toMatchObject` explícito.
9. **`compose.test.ts` esqueceu a terceira migration** na lista de histórico — corrigido.

## Arquivos criados

```text
src/domain/wagering/events.ts
src/domain/wagering/failure-code.ts
src/domain/wagering/outbox-message.ts
src/domain/wagering/payload-hash.ts
src/domain/wagering/wager-transaction.ts
src/modules/wagering/application/process-wagering-transaction.ts
src/platform/database/entities/outbox-event.entity.ts
src/platform/database/entities/wager-transaction.entity.ts
src/platform/database/migrations/Migration20261009000300.ts
tests/integration/wager-concurrency.test.ts
tests/integration/wager-transaction-processing.test.ts
tests/support/invariants.ts
tests/unit/domain/wagering/events.test.ts
tests/unit/domain/wagering/payload-hash.test.ts
tests/unit/domain/wagering/wager-transaction.test.ts
openspec/changes/implement-wagering-transactions/implementation-notes.md
```

## Arquivos modificados (não commitados)

```text
src/domain/wallet/money.ts
src/domain/wallet/wallet.ts
src/platform/database/migration-catalog.ts
src/platform/database/migration-options.ts
src/platform/database/orm-options.ts
src/platform/database/schemas.ts
src/platform/database/wallet.repository.ts
tests/docker/compose.test.ts
tests/docker/migrations.test.ts
tests/integration/health.test.ts
tests/integration/postgresql-foundation.test.ts
tests/integration/wallet-ledger.test.ts
tests/unit/domain/wallet/money.test.ts
tests/unit/domain/wallet/wallet.test.ts
openspec/changes/implement-wagering-transactions/{tasks.md,design.md,specs/financial/transactions/spec.md,specs/financial/processing/spec.md,specs/financial/outbox/spec.md}
```

## Pendências reais

- API financeira pública, inbox/consumer SQS, publisher do outbox e scheduler de referências pendentes: fora do escopo desta change (F3–F5), conforme restrição explícita.
- `result_balance` é snapshot de replay, não saldo corrente — consumidores devem ler `wallet.balance` para o saldo presente.
- Nenhum commit foi criado; a validação final e este registro não substituem revisão/commit pelo responsável.

## Rodada de revisão independente (commit `5463e22`) — 4 pontos corrigidos

### 1. WIN com referência ainda inexistente (tarefa 5.1)

O use case já tentava marcar `PENDING_REFERENCE` para WIN com referência informada, mas o domínio proibia a transição (`markPendingReference` checava só `requiresReference()`). Contrato corrigido com o predicado `waitsForReference()` — verdadeiro para REFUND/ROLLBACK e para WIN com `referenceExternalTransactionId` informado; `markPendingReference()` permite exatamente esses casos. Testes em PostgreSQL real: WIN sem referência → `PROCESSED`; WIN com BET existente → `PROCESSED` (já coberto); WIN com referência ausente → linha `PENDING_REFERENCE` persistida, sem crédito nem ledger, um único evento `WagerTransactionPendingReference`; reenvio idempotente (mesma chave + payload) → mesmo resultado com `idempotentReplay: true`, mesma `transactionId`, nenhum evento novo. Specs de processing/transactions atualizadas; F5 (scheduler) não foi criado.

### 2. Semântica de referência fora de ordem (tarefa 5.2)

O teste anterior de REFUND pendente criava uma segunda REFUND após a BET chegar e o título sugeria resolução da primeira — impreciso. Agora são dois cenários independentes e nomeados com precisão: (a) a REFUND antecipada **permanece** `PENDING_REFERENCE` após a BET chegar; o reenvio idempotente da mesma submissão faz replay do resultado pendente (mesma linha, mesmos eventos); (b) uma submissão **distinta** (chave nova) da mesma referência aplica after a BET — é outra transação, não a resolução da primeira. O contrato de reprocessamento da F5 está gravado em `design.md` D14 e na spec: reprocessar a **própria linha**, preservando o `transactionId`, re-validando escopo e `DUPLICATE_REVERSAL` antes de aplicar — para nunca creditar duas vezes se uma reversão distinta já aplicou.

### 3. Validação de identificadores de negócio (tarefa 5.3)

Novo módulo de domínio `src/domain/wagering/business-identifiers.ts`: `assertValidBusinessIdentifiers` valida, na entrada do `execute` e **antes de qualquer transação SQL**, tipo string, não-vazio, limites por campo (`providerId` 64, `externalTransactionId` 128, `idempotencyKey` 255, `roundId`/`gameId` 64) e UUID para `playerId`/`walletId`; a referência opcional é validada só quando informada. Violação levanta `InvalidBusinessIdentifierError` carregando o campo (mapeamento HTTP futuro) — payload estruturalmente inválido nunca vira rejeição financeira persistida nem escrita parcial. 7 testes unitários (`business-identifiers.test.ts`) + teste de integração com 5 casos (walletId/playerId não-UUID, providerId vazio, idempotencyKey estourado, roundId vazio) asserindo zero escritas (saldo, versão, ledger, transactions e outbox intactos).

### 4. Eventos de abertura (tarefa 5.4)

Decisão: o contrato **exige** os eventos. README §11 define `WagerTransactionProcessed` para "qualquer transação aplicada, inclusive LOSS" e `WalletBalanceChanged` "somente quando o saldo muda", sem exceção para transações internas — e o OPENING é uma transação `PROCESSED` que movimenta saldo com lançamento no ledger. Implementado em `WalletRepository.saveOpen`: o mesmo flush grava wallet + `OPENING` + ledger + os dois eventos (correlation `internal:opening-{walletId}`), sem publicação (F4). Abertura de saldo zero: nenhuma transação, ledger ou evento. Testes: par de eventos do OPENING com payload conferido (`CREDIT`, `0.00`→`100.00`, `walletVersion` 1) e caso zero; asserções de eventos dos testes de processamento agora separam eventos de provedor (join com `wager_transaction.provider_id <> 'internal'`).

### Bug extra encontrado pela rodada (corrigido)

`toWagerTransactionDomain` tratava apenas `undefined` em colunas anuláveis; o PostgreSQL hidrata `NULL` como `null`, então **replay de qualquer linha sem `result_balance`** (PENDING_REFERENCE e REJECTED) lançava `Money.from(null)`. Corrigido normalizando `null`/`undefined` em `resultBalance`, `referenceExternalTransactionId`, `referenceTransactionId`, `failureCode` e `processedAt`. Experto pelos novos testes de replay de WIN/REFUND pendentes.

### Resultado da rodada

| Comando/verificação | Resultado |
|---|---|
| `bun run typecheck` | Exit 0 |
| `bun run build` | Exit 0 |
| `bun run test:unit` | **150 pass, 0 fail** (+9 sobre a rodada anterior) |
| `DOCKER_CONTEXT=default bun run test:integration` | **56 pass, 0 fail** (+6 sobre a rodada anterior) |
| `DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts` | **2 pass, 0 fail** |
| `openspec validate implement-wagering-transactions --type change --strict --no-interactive` | Change válida, exit 0 |

Arquivos criados nesta rodada: `src/domain/wagering/business-identifiers.ts`, `tests/unit/domain/wagering/business-identifiers.test.ts`.

Arquivos modificados nesta rodada: `src/domain/wagering/wager-transaction.ts`, `src/modules/wagering/application/process-wager-transaction.ts`, `src/platform/database/wallet.repository.ts`, `src/platform/database/entities/wager-transaction.entity.ts`, `tests/integration/wager-transaction-processing.test.ts`, `tests/unit/domain/wagering/wager-transaction.test.ts`, `openspec/changes/implement-wagering-transactions/{tasks.md,design.md,proposal.md,specs/financial/transactions/spec.md,specs/financial/processing/spec.md,specs/financial/outbox/spec.md,implementation-notes.md}`.

Problemas restantes conhecidos: nenhum novo. Pendências de escopo inalteradas (F3 API, F4 publisher, F5 scheduler de reprocessamento/expiração de PENDING_REFERENCE — que também consumirá o contrato D14).
