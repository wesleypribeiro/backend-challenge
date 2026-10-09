# Evidências de implementação — implement-money-wallet-ledger

Estado atual: **10/10 tarefas F1 concluídas** — 1.1–1.4, 2.1–2.3 e 3.1–3.3. Esta change entrega somente o domínio financeiro F1 (Money, Wallet, ledger append-only e sua persistência). Transações/idempotência/outbox (F2), endpoints, consumers e eventos financeiros não fazem parte e não foram implementados. Nenhum commit, push ou PR foi criado; as alterações estão no working tree sobre o commit `1692cee`.

Comando para reproduzir as evidências:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bun run build
bun run test:unit
DOCKER_CONTEXT=default bun run test:integration
DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts
openspec validate implement-money-wallet-ledger --type change --strict --no-interactive
```

## Decisões implementadas

### Domínio (`src/domain/wallet/`)

- `Money` (`money.ts`): construtor privado + factories `Money.from`/`Money.zero`; regex `^-?\d+(\.\d{1,2})?$` rejeita notação científica, escala > 2, vazio, `NaN`/`Infinity`; limite `999999999999999999.99` compatível com a coluna `NUMERIC(20,2)`; `Object.freeze` no construtor (imutabilidade runtime); `add`/`subtract`/`negate` retornam instâncias novas; `subtract` aceita negativos internamente (necessário para débitos futuros), mas `Wallet.open` rejeita saldo inicial negativo no contrato de entrada; `toJSON`/`toString`/`amountString` preservam string decimal exata.
- `WalletLedgerEntry` (`ledger-entry.ts`, novo): `LedgerDirection` (`DEBIT`/`CREDIT`), operação (`OPENING` nesta change), `create()` valida valor positivo, moeda única e aritmética `balance_after = balance_before ± amount` conforme direção; `rehydrate()` reconstrói sem revalidar; `Object.freeze`.
- `Wallet` (`wallet.ts`): construtor privado; `Wallet.open({id, playerId, initialBalance, idGenerator})` devolve `{wallet, ledgerEntry?}` — saldo `0` → wallet v1 sem entry; positivo → wallet v1 + entry `OPENING`/`CREDIT` com ids gerados; negativo → rejeitado; `createdAt === updatedAt` na abertura. `Wallet.rehydrate(state)` com `WalletState` completo. A wallet **não** é congelada: F2 movimentará saldo por métodos de domínio.

### Persistência (`src/platform/database/`)

- MikroORM **7.2.4** removeu a API de decorators (`@Entity`/`@Property` inexistem); o padrão do projeto é `EntitySchema` class-less (mesmo formato de `tests/fixtures/persistence-record.ts`). `WalletSchema` e `WalletLedgerEntrySchema` exportados por `schemas.ts` e registrados em `orm-options.ts`. `version` é `integer` comum **sem** `version: true` — o domínio é dono do versionamento (D7/locking pessimista vem na F2).
- `WalletRepository.saveOpen(wallet, ledgerEntry?)`: cria as entidades no Unit of Work e chama `em.flush()` **uma única vez** — uma transação SQL atômica, sem commit próprio do repositório (D5: o use case da F2 será dono da transação).
- Migration `Migration20261009000200` (editada no lugar, change ainda não arquivada/implantada):
  - `wallet`: `id uuid PK`, `player_id uuid NOT NULL`, `currency VARCHAR(3)`, `balance NUMERIC(20,2) NOT NULL CHECK (balance >= 0)`, `version integer NOT NULL` (sem default/auto-increment), `created_at/updated_at`, `UNIQUE (player_id, currency)`.
  - `wallet_ledger_entry`: `id uuid PK`, `wallet_id` FK, `transaction_id uuid NOT NULL`, `operation`, `direction`, `amount NUMERIC(20,2) CHECK (amount > 0)`, `currency`, `balance_before/after`, `created_at`; `CHECK (direction IN ('DEBIT','CREDIT'))`; `CHECK (balance_after = balance_before + amount)` e `CHECK (balance_after = balance_before - amount)` conjuntos com a direção; `UNIQUE (wallet_id, transaction_id)`.
  - FK `DEFERRABLE INITIALLY DEFERRED`: o Unit of Work não conhece a ordem de insert de um FK escalar sem relação declarada; a constraint é verificada no commit da transação única, preservando atomicidade (padrão unit-of-work).
  - Append-only em duas camadas: grants (`wagering_app` só `SELECT`/`INSERT` no ledger) + triggers `BEFORE UPDATE/DELETE/TRUNCATE ... RAISE EXCEPTION 'wallet_ledger_entry is append-only: ...'` valendo para **todos** os papéis, inclusive o dono. Event triggers foram descartados (não rodam dentro da transação da migration); rules `INSTEAD NOTHING` foram descartadas (não rejeitam de fato).
  - `down()` reversível: triggers → função → tabelas, na ordem inversa.

## Comandos e resultados observados (execução final)

| Comando/verificação | Resultado |
|---|---|
| `bun run typecheck` | Exit 0, TypeScript strict sem relaxamento |
| `bun run build` | Exit 0, ESM emitido em `dist/` |
| `bun run test:unit` (`./tests/unit ./tests/smoke`) | **95 pass, 0 fail, 412 asserções**, 11 arquivos |
| `DOCKER_CONTEXT=default bun run test:integration` | **29 pass, 0 fail**, 5 arquivos, PostgreSQL/LocalStack reais (101,03 s) |
| `DOCKER_CONTEXT=default bun test ./tests/docker/migrations.test.ts ./tests/docker/compose.test.ts` | **2 pass, 0 fail**, 53,89 s; imagem + ciclo de migrations no container |
| `openspec validate implement-money-wallet-ledger --type change --strict --no-interactive` | Change válida, exit 0 |

## Testes executados (cobertura nova)

- Unit de domínio (26 no diretório `tests/unit/domain`): precisão de `Money` acima de `Number.MAX_SAFE_INTEGER` cents, limites `NUMERIC(20,2)`, NaN/Infinity/vazio/científica/escala, ISO 4217, serialização exata, negativos internos vs. rejeição de saldo negativo na abertura; `Wallet.open` (zero/positivo/negativo/ids/versão 1); `WalletLedgerEntry` (direção, referência de transação, aritmética, imutabilidade, rehydrate).
- Integração `tests/integration/wallet-ledger.test.ts` (novo, 10 cenários): metadata do schema (colunas, `NUMERIC(20,2)` como string, `version` sem auto-increment, uniques); abertura positiva atômica (wallet + `OPENING` credit); abertura zero v1 sem entry; `UNIQUE(player_id, currency)` → `23505`; checks `23502` (saldo negativo, direction inválida — SQLSTATE `23514` quando a avaliação cai na check aritmética, nome da família `wallet_ledger_entry_*` assertionada), amount `0.00` e aritmética desbalanceada; `UNIQUE(wallet_id, transaction_id)` → `23505` nas duas tentativas; rollback atômico (segunda gravação com PK duplicada reverte a wallet); append-only em duas camadas (`42501` para app, trigger para dono, linhas preservadas); FK → `23503`; round-trip `NUMERIC` `'900719925474099.91'`.
- Integração `postgresql-foundation.test.ts` (atualizado): ciclo **up/up/down/up** com as duas migrations, histórico íntegro, tabelas `wallet`/`wallet_ledger_entry` esperadas, recusa com objeto extra (`extra_object`), grants/roles.
- Health (atualizado): após o ciclo final, `pg_tables` do schema `wagering` contém `wallet` e `wallet_ledger_entry`.
- Docker `migrations.test.ts`/`compose.test.ts` (atualizados): duas migrations no `dist`, status/migrate/rollback duplo, recusa com objeto extra e tabelas financeiras presentes no container.

Nenhum teste existente foi removido ou enfraquecido para passar; as alterações em testes antigos corrigem expectativas desatualizadas (uma migration vazia) e o timeout insuficiente do ciclo de migrations.

## Problemas encontrados e soluções

1. **Flush com FK imediata quebrava a ordem de insert** — com FK comum e metadados planos (sem relação `m:1`), o Unit of Work inseria `wallet_ledger_entry` antes de `wallet` → `23503` em todos os `saveOpen` com entry. Corrigido com FK `DEFERRABLE INITIALLY DEFERRED`, mantendo transação única e validação no commit.
2. **Expectativa de `UPDATE`/`DELETE` no papel app recebia `42501`** — sem grant, a permissão falha antes do trigger. O teste agora prova as duas camadas separadamente: app → `42501` (privilegios), dono → `wallet_ledger_entry is append-only: ...` (trigger).
3. **Check de direção inválida reporta SQLSTATE variável** — `direction='SIDEWAYS'` viola também a aritmética; o PostgreSQL pode nomear qualquer uma das duas checks (`23502` ou `23514`). A asserção cobre a família `wallet_ledger_entry_*` nos casos ambíguos e nomeia a constraint exata nos casos de constraint única.
4. **Ciclo de migrations estourava 5 s** — o ciclo completo com duas migrations faz ~10 spawns de `bun run db:*` e excedeu o timeout default do Bun Test (5 s; o `timeout` do `bunfig.toml` não surtiu efeito). Timeout explícito de 60 s adicionado ao teste, padrão já usado em `tests/docker/*.test.ts`.
5. **Contaminação ambiental no `node_modules`** — a extensão VS Code Console Ninja injetou um hook `/* build-hook-start */.../* build-hook-end */` no topo de `node_modules/@nestjs/core/index.js`, que imprimia banner no stdout dos testes smoke e mantinha handles abertos (12 falhas de bootstrap/shutdown/config/logging por timeout e JSON parse). Confirmado que apenas esse arquivo estava infectado; o bloco foi removido e as suites voltaram a ficar verdes. Não é alteração de código do projeto; uma reinstalação de dependências também o removeria.
6. **Revisão independente (10 problemas)** — corrigidos os itens 1–9 no código/testes (referências `migrationNames`, Docker tests com duas migrations, triggers vs. event triggers/rules, limites `NUMERIC(20,2)` no domínio, `Object.freeze`, `saveOpen` com flush único, testes de integração novos, sem remoção de testes) e o item 10 nos artefatos desta pasta (`tasks.md`, `design.md`, duas specs e este registro).

## Rodada final de revisão — três lacunas de integridade (após `96e0b90`)

Nenhuma verificação anterior foi removida ou enfraquecida; os testes novos foram acrescentados aos existentes. Nada de F2 foi implementado.

1. **Correspondência wallet/ledger no `saveOpen`** — `WalletRepository.assertOpeningPair` valida, antes de agendar qualquer linha: saldo negativo rejeitado; saldo positivo exige a entry `OPENING` (e saldo zero a proíbe); walletId igual; moeda da wallet igual à de amount/balanceBefore/balanceAfter; operação `OPENING`; direção `CREDIT`; `balanceBefore` zero; `balanceAfter` igual ao saldo da wallet. Cinco testes negativos reais em `wallet-ledger.test.ts` (par positivo sem entry, seis divergências de par via `rehydrate`, zero com entry, wallet negativa) — todos rejeitam e asserem que **nenhuma linha** foi escrita.
2. **Consistência de moeda no banco** — migration `Migration20261009000200` (editada no lugar, sobre ambiente descartável) agora cria `UNIQUE (id, currency)` em `wallet` e troca a FK simples pela composta `wallet_ledger_entry (wallet_id, currency) → wallet (id, currency) DEFERRABLE INITIALLY DEFERRED`. Teste SQL direto com `currency = 'USD'` em wallet BRL rejeita com `23503` nomeando `wallet_ledger_entry_wallet_currency_fk`, nenhuma linha divergente persiste, e o teste confere em `pg_constraint` as colunas (`{wallet_id,currency}`), `contype='f'`, `condeferrable`/`condeferred` verdadeiros e o alvo `wallet_id_currency_unique` (`{id,currency}`). Validação equivalente também existe no domínio/repositório (item 1). O ciclo completo up/down/up foi exercitado nos testes de integração e Docker com a migration nova.
3. **Matriz operação/direção em `WalletLedgerEntry.create`** — whitelist `LEDGER_OPERATION_DIRECTIONS`: `OPENING`→CREDIT (e exige saldo anterior zero), `BET`→DEBIT, `WIN`/`REFUND`→CREDIT, `ROLLBACK`→ambas as direções (F2 resolve pela referência), `LOSS`→nenhuma (nunca gera lançamento, README §7), operação desconhecida rejeitada. Seis testes unitários novos cobrem LOSS, combinações inválidas, saldo anterior do OPENING, as duas direções de ROLLBACK, WIN/REFUND e vocabulário desconhecido.

Decisão registrada em `design.md` (D9): a matriz ficou apenas no domínio nesta change; uma CHECK de banco para a matriz deve ser definida junto com a F2, que é a primeira produtora de entradas não-`OPENING`. As invariantes estruturais e de moeda já têm validação no banco.

## Pendência registrada para a F2 — transação interna `OPENING`

A F2 deverá **criar e persistir a transação financeira interna `OPENING` de maneira atômica** (mesma transação SQL que wallet + lançamento), de modo que `wallet_ledger_entry.transaction_id` sempre aponte para uma linha real de transação — **sem deixar referências órfãs no ledger**. O `transactionId` gerado na abertura da F1 é o placeholder dessa transação; `design.md` D10 registra o repasse.

## Arquivos alterados

Criados:

```text
src/domain/wallet/ledger-entry.ts
tests/unit/domain/wallet/ledger-entry.test.ts
tests/integration/wallet-ledger.test.ts
openspec/changes/implement-money-wallet-ledger/implementation-notes.md
```

Modificados (não commitados):

```text
src/domain/wallet/money.ts
src/domain/wallet/wallet.ts
src/platform/database/entities/wallet.entity.ts
src/platform/database/entities/wallet-ledger-entry.entity.ts
src/platform/database/migrations/Migration20261009000200.ts
src/platform/database/wallet.repository.ts
tests/unit/domain/wallet/money.test.ts
tests/unit/domain/wallet/wallet.test.ts
tests/integration/postgresql-foundation.test.ts
tests/integration/health.test.ts
tests/docker/migrations.test.ts
tests/docker/compose.test.ts
openspec/changes/implement-money-wallet-ledger/{tasks.md,design.md,specs/financial/money/spec.md,specs/financial/wallet-ledger/spec.md}
```

Removido (na mesma sessão anterior, movido para a plataforma): `src/domain/wallet/wallet.repository.ts` com imports quebrados — o repositório vive em `src/platform/database/`.

## Pendências reais

- F2 (transações, idempotência, outbox, locking pessimista com `version`) e endpoints financeiros: fora do escopo desta change. Em particular, a F2 deverá criar e persistir a transação interna `OPENING` atomicamente com wallet + lançamento, sem referências órfãs no ledger (seção acima e `design.md` D10).
- `ARCHITECTURE.md` ainda afirma que "não existem tabelas financeiras" e precisa de atualização na troca de F1 para produção.
- Nenhum commit foi criado; a validação final e este registro não substituem revisão/commit pelo responsável.
- `bunfig.toml` define `timeout = 20_000` sob `[test]`, mas o Bun 1.4.2 aplicou 5 s na prática — investigar/corrigir separadamente se outros testes longos passarem a falhar.
