# Design

## Context

F1 delivered `Money`, `Wallet` and the append-only `WalletLedgerEntry` with strict PostgreSQL constraints. F2 is the first change to move real money: provider operations (BET/WIN/LOSS/REFUND/ROLLBACK) must be processed under concurrency, with persistent idempotency, atomic ledger and outbox writes, and a deferred FK that ties every ledger entry to a real transaction row (F1 decision D10 handoff).

## Goals / Non-Goals

**Goals:**
- Persist every financial operation as a `WagerTransaction` row with a documented state machine.
- Process operations correctly under wallet-level concurrency (`SELECT ... FOR UPDATE`) and persistent idempotency.
- Keep transaction + wallet balance + ledger + outbox in one SQL transaction per operation.
- Create the internal `OPENING` transaction atomically with the wallet and its entry.
- Persist PENDING_REFERENCE outcomes for out-of-order delivery (reprocessing worker is F5).

**Non-Goals:**
- HTTP API, SQS consumer, inbox, outbox publisher, reference scheduler (F3–F5).
- Partial reversals, multi-wallet operations, double-entry bookkeeping.
- Expiration/TTL of PENDING_REFERENCE (F5 owns the scheduler and its limits).

## Decisions

1. **Incremental migration `Migration20261009000300`** (no persistent environment exists — verified: no named volume, no containers):
   - `wagering.wager_transaction`: id (uuid PK), provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id (FK DEFERRABLE), player_id, round_id, game_id, kind (CHECK), status (CHECK), money_amount NUMERIC(20,2), money_currency, reference_external_transaction_id (nullable), reference_transaction_id (self-FK, nullable), failure_code (nullable), result_balance NUMERIC(20,2) (nullable — snapshot at processing for replay), created_at, processed_at (nullable). `UNIQUE (provider_id, external_transaction_id)`, `UNIQUE (idempotency_key)`.
   - `wagering.outbox_event`: id (uuid PK), aggregate_id, event_type, payload JSONB, status (PENDING/PUBLISHED CHECK), attempts, next_attempt_at, created_at, published_at (nullable).
   - `ALTER TABLE wallet_ledger_entry ADD COLUMN transaction_id` already exists from F1; add FK `wallet_ledger_entry.transaction_id → wager_transaction(id) DEFERRABLE INITIALLY DEFERRED` (the column exists; F1 generated ids for the future row — D10).
   - Partial unique index `(reference_transaction_id, kind) WHERE status = 'PROCESSED'` — one reversal of a given kind per referenced transaction (rule 4).
   - *Alternative*: separate table per status — rejected; one table with CHECK constraints keeps queries and the state machine auditable in one place.

2. **Atomic OPENING** — `saveOpen` (extended) inserts the internal `OPENING` `WagerTransaction` (providerId `'internal'`, external id `opening-{walletId}`, idempotency key `internal:opening-{walletId}`, status `PROCESSED`, kind `OPENING`) in the same flush as the wallet and its ledger entry (F1 D10 handoff). Ledger `transaction_id` always references a real row.

3. **Use case owns the transaction** (F1 D5): `ProcessWagerTransaction` begins a SQL transaction, selects the wallet `FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`), performs idempotency lookups, validates, applies effects, inserts transaction + ledger + outbox in a single `em.flush()`, then commits. Repositories never commit on their own.

4. **Idempotency lookup order**: before locking, look up by idempotency key and by `(providerId, externalTransactionId)`; if found, return the stored outcome (replay). After acquiring the wallet lock, look up again — a concurrent transaction may have committed between the first lookup and the lock. Matching payload hash → replay of the original result (including the balance observed then, from `result_balance`); divergent hash → conflict (no new row, no event, no effect).

5. **Failure-code taxonomy** (stable, machine-readable):
   - `INSUFFICIENT_FUNDS` — BET (or balance-affecting op) cannot be applied.
   - `ROLLBACK_INSUFFICIENT_FUNDS` — reversal that would drive the balance negative (distinct from rule 9).
   - `WALLET_PLAYER_MISMATCH`, `CURRENCY_MISMATCH` — payload disagrees with the wallet.
   - `REFERENCE_PROVIDER_MISMATCH`, `REFERENCE_PLAYER_MISMATCH`, `REFERENCE_WALLET_MISMATCH`, `REFERENCE_CURRENCY_MISMATCH`, `REFERENCE_ROUND_MISMATCH`, `REFERENCE_MONEY_MISMATCH` — reference belongs to a different aggregate/scope.
   - `REFERENCE_KIND_NOT_ALLOWED` — REFUND of a non-BET, ROLLBACK of a non-BET/WIN/REFUND.
   - `DUPLICATE_REVERSAL` — reference already reversed by the same kind.
   - `REFERENCE_NOT_FOUND` — persisted only when F5 expires a PENDING_REFERENCE (F2 does not set it).
   - Structural/programming errors (invalid kind string, unbalanced entry, missing wallet) raise exceptions — they are not business rejections and are not persisted as `REJECTED`.

6. **Event set per outcome** (persisted PENDING in the same transaction; publisher is F4):
   - `WagerTransactionProcessed` — every applied transaction, including LOSS.
   - `WagerTransactionRejected` — business-rule rejection (status `REJECTED`).
   - `WalletBalanceChanged` — only when the balance actually moved (not for LOSS/REJECTED).
   - `WagerTransactionPendingReference` — reference missing, stored as `PENDING_REFERENCE`.
   - Conflict of idempotency key produces no event (nothing was accepted).
   - Replay produces no new events (the originals were already committed).

7. **Result shape**: a discriminated union — `processed` (status, transactionId, balance snapshot), `rejected` (failureCode), `pendingReference` (transactionId), `replay` (original outcome + `idempotentReplay: true`), `conflict`. HTTP mapping is F6.

8. **Reference resolution**: REFUND and ROLLBACK resolve the target transaction by `(providerId, referenceExternalTransactionId)` and require it to be `PROCESSED`, of an allowed kind, and in the same provider/player/wallet/currency/round with an equal amount. ROLLBACK direction is the inverse of the reference (BET→CREDIT, WIN/REFUND→DEBIT). REFUND always credits. LOSS never moves the balance and never produces a ledger entry.

9. **Wallet domain methods**: `Wallet.debit(money)` / `Wallet.credit(money)` increment `version`, reject negative results, and are the only path the use case uses to move the balance; the ledger entry is built from the before/after values they expose.

10. **Concurrency strategy — pessimistic lock per wallet**: the use case locks the wallet row before validating balance-affecting operations. This serializes operations on one wallet (the hot-wallet trade-off accepted in the foundation) while distinct wallets proceed in parallel. *Alternative*: optimistic locking with retry — rejected: retry storms under 50x load and no clean way to return the original conflict to the provider.

11. **23505 recovery**: if the flush violates a unique constraint (concurrent idempotency insert), rollback, open a fresh context, re-lookup, and return replay/conflict — never continue in an aborted transaction.

## Risks / Trade-offs

- [Risk] Ledger `transaction_id` FK deferrable until commit — an orphan is impossible after commit but could exist mid-transaction; acceptable because the transaction is short and never leaves uncommitted state visible.
- [Risk] `result_balance` snapshot can diverge from a later replay's expectation — replay returns the *original* observed balance by design (rule 7); reconstruction tests compare ledger-derived balance, not the snapshot.
- [Trade-off] Pessimistic lock serializes a wallet — accepted (foundation risk note); mitigated by short transactions and no network I/O under lock.
