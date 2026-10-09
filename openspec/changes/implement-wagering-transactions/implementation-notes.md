# Evidências de implementação — implement-wagering-transactions

Estado atual: **14/14 tarefas F2 concluídas** — 1.1–1.4 (domínio), 2.1–2.3 (persistência), 3.1–3.4 (use case) e 4.1–4.3 (concorrência e invariantes). Esta change entrega o processamento financeiro transacional: `WagerTransaction` com máquina de estados, `ProcessWagerTransaction` com lock pessimista (`SELECT FOR UPDATE`), idempotência persistente por chave e por `(providerId, externalTransactionId)`, criação atômica da transação interna `OPENING`, referências `REFUND`/`ROLLBACK` com escopo validado, detecção de divergência por hash canônico e outbox transacional. API pública, inbox/consumer SQS, publisher de outbox e scheduler de referências continuam fora do escopo (F4/F5). Nenhum commit, push ou PR foi criado; as alterações estão no working tree sobre o commit `d48b4b5`.

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
| `bun run test:unit` (`./tests/unit ./tests/smoke`) | **141 pass, 0 fail, 540 asserções**, 14 arquivos |
| `DOCKER_CONTEXT=default bun run test:integration` | **50 pass, 0 fail, 493 asserções**, 7 arquivos, PostgreSQL/LocalStack reais (123,53 s) |
| `DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts` | **2 pass, 0 fail, 101 asserções**; três migrations no container |
| `openspec validate implement-wagering-transactions --type change --strict --no-interactive` | Change válida, exit 0 |

## Decisões implementadas

### Domínio (`src/domain/wagering/`, `src/domain/wallet/`)

- `FailureCode` (`failure-code.ts`): taxonomia fechada `INSUFFICIENT_FUNDS`, `ROLLBACK_INSUFFICIENT_FUNDS`, `WALLET_PLAYER_MISMATCH`, `CURRENCY_MISMATCH`, `REFERENCE_{PROVIDER,PLAYER,WALLET,CURRENCY,ROUND,MONEY}_MISMATCH`, `REFERENCE_KIND_NOT_ALLOWED`, `DUPLICATE_REVERSAL` e `REFERENCE_NOT_FOUND` (apenas F5). Erros estruturais (abertura via provider, kind `OPENING`) lançam exceção de domínio — nunca são persistidos como `REJECTED`.
- `WagerTransaction` (`wager-transaction.ts`): máquina de estados `PENDING` → `PROCESSED`/`REJECTED`/`PENDING_REFERENCE`/`FAILED` (transições terminais elevam); regras de referência por kind (`OPENING` é interno, REFUND/ROLLBACK exigem referência, BET/WIN/LOSS a opção de referência livre para WIN — README §7 — e proíbem para BET/LOSS); `affectsBalance` (LOSS e OPENING não movem saldo), `ledgerDirectionFor`, `matchesPayload`; entidade **não** é congelada (transições são mutações legítimas, estilo `Wallet`); os eventos concretos são congelados nos factories `from()`.
- `canonicalPayloadHash` (`payload-hash.ts`): JSON de chaves ordenadas dos campos de negócio + SHA-256; campos de transporte/metadados excluídos; divergência de valor/moeda/referência altera o hash.
- Eventos (`events.ts`): `IntegrationEvent` abstrato com envelope `toJSON()` (`eventType`, `version`, `data`, decimal strings via `MoneyProps`); concretos `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`.
- `Wallet.debit`/`Wallet.credit` (`wallet.ts`): saldo não-negativo, incremento de `version`, aritmética via `Money` imutável.
- `OutboxMessage` (`outbox-message.ts`): agregado de publicação (status `PENDING`/`PUBLISHED`, `attempts >= 0`, payload JSONB).

### Persistência (`src/platform/database/`)

- `Migration20261009000300`: tabelas `wagering.wager_transaction` (UNIQUE `provider_id + external_transaction_id`, UNIQUE `idempotency_key`, CHECKs de kind/status, `amount > 0`, self-FK `reference_transaction_id` DEFERRABLE, FK de wallet DEFERRABLE, coluna `result_balance` como snapshot de replay) e `wagering.outbox_event` (status, payload JSONB, `attempts`); FK `wallet_ledger_entry.transaction_id → wager_transaction(id) DEFERRABLE INITIALLY DEFERRED` (padrão unit-of-work da F1); índice parcial `wager_transaction_reversal_unique (reference_transaction_id, kind) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')` — WIN pode referenciar BET livremente sem disputar o índice. Ciclo up/down/up verificado em ambientes descartáveis (nenhum banco persistente existe — sem volume nomeado, sem containers remanescentes).
- `EntitySchema` class-less (`wager-transaction.entity.ts`, `outbox-event.entity.ts`), registrados em `schemas.ts` e `orm-options.ts`; mappers `toWagerTransactionDomain`/`fromWagerTransactionDomain` incluem `resultBalance`.
- `WalletRepository.saveOpen` cria a transação `OPENING` no mesmo flush: provider `internal`, external `opening-{walletId}`, key `internal:opening-{walletId}`, round/game `internal`, status `PROCESSED`, id = `entry.transactionId`, `resultBalance` = saldo inicial. O ledger nunca mais aponta para transaction id órfão.

### Use case (`src/modules/wagering/application/process-wagering-transaction.ts`)

- Dono da transação SQL (D5): pre-lock lookup por `idempotencyKey` OU `(providerId, externalTransactionId)` → replay imediato sem lock quando já existe; caso contrário lock da wallet `FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) → re-lookup pós-lock → validação (player, moeda, amount, saldo, escopo de referência) → `Wallet.debit`/`credit` → **um único `em.flush()`** persistindo transaction + ledger + outbox.
- Ordem de ids no caminho BET: entity id, ledger id, processed-event id, balance-event id — seam `options.idGenerator` permite injetar falhas determinísticas nos testes.
- `23505` (corrida residual) → `recover()`: rollback e reprocessa uma vez em `em.fork()` novo com re-leitura fresca.
- Resultado é discriminated union (`processed`/`rejected`/`pendingReference`/`conflict`) com flag `idempotentReplay`; replay devolve o `resultBalance` original armazenado, não o saldo corrente.
- REFUND/ROLLBACK: referência resolvida por `(providerId, referenceExternalTransactionId)`; checagem de escopo provider→player→wallet→moeda→round; igualdade de valor só para REFUND/ROLLBACK; direção invertida pela referência; referência ausente → `PENDING_REFERENCE` persistido sem saldo/ledger; segunda reversão do mesmo par → `DUPLICATE_REVERSAL` (índice parcial + checagem).
- Outbox por outcome no mesmo flush; `conflict` e `replay` não geram eventos; linhas permanecem `PENDING` (publisher é F4).

### Concorrência e invariantes (`tests/integration/wager-concurrency.test.ts`, `tests/support/invariants.ts`)

- S13-C01: a mesma aposta enviada 50× em paralelo → exatamente 1 `PROCESSED` efetivo, 49 replays, um único débito, uma linha BET, um único `transactionId`; retry posterior não duplica.
- S13-C02: 80/80 vs 100 em paralelo → 1 `PROCESSED`, 1 `REJECTED INSUFFICIENT_FUNDS`, saldo 20.00, um único `DEBIT`.
- S13-C03: lock de wallet A mantido por conexão dedicada (`pg` Client próprio, transação aberta) → backend de A aparece em `pg_stat_activity` com `wait_event_type='Lock'` (barreira observável, sem sleep como prova) enquanto aposta em wallet B distinta completa; liberação do lock deixa A concluir.
- Adicional: 10 apostas de 15.00 contra 100.00 → exatamente 6 aplicadas, 4 rejeitadas, saldo 10.00, invariante reconstruída.
- Invariante S13-G01 (`tests/support/invariants.ts`, helper compartilhado): `wallet.balance == Σ(CREDIT) − Σ(DEBIT)` sobre **todos** os lançamentos, aplicado em todos os cenários com wallet persistida (processamento e concorrência).

## Testes executados (cobertura nova)

- Unit de wagering (`tests/unit/domain/wagering/`, 3 arquivos): máquina de estados e regras de kind/referência de `WagerTransaction`; independência de ordem de campos e exclusões do hash canônico; envelope dos quatro eventos concretos. `wallet.test.ts` estendido com `debit`/`credit` (versão, negativos).
- Integração `wager-transaction-processing.test.ts` (novo, 16 cenários): BET atômico (saldo, ledger, transaction, dois eventos); insuficiência sem efeito; replay idêntico com saldo observado original; divergência de payload → `conflict` sem nova linha; `(provider, external)` reutilizado com chave nova; LOSS sem ledger/saldo/evento; WIN com referência opcional; mismatch moeda/jogador; OPENING estrutural; `PENDING_REFERENCE` aplicado quando o BET chega; `DUPLICATE_REVERSAL`; códigos próprios de REFUND inválida; `ROLLBACK` inverso + `ROLLBACK_INSUFFICIENT_FUNDS`; escopo de referência (wallet cruzada via wallet USD do mesmo player — `REFERENCE_WALLET_MISMATCH`; round cruzado); rollback atômico com falha injetada no ledger id (PK do `OPENING` existente → 23505 real; generator ímpar/par garante que até o retry de `recover()` re-incide e nada é commitado).
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

- API financeira pública, inbox/consumer SQS, publisher do outbox e scheduler de referências pendentes: fora do escopo desta change (F4/F5), conforme restrição explícita.
- `result_balance` é snapshot de replay, não saldo corrente — consumidores devem ler `wallet.balance` para o saldo presente.
- Nenhum commit foi criado; a validação final e este registro não substituem revisão/commit pelo responsável.
