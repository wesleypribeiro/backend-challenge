# Proposal

## Why

With the financial foundation (`Money`, `Wallet`, append-only `WalletLedgerEntry`) in place, the system must now process the actual wagering operations that providers send: BET, WIN, LOSS, REFUND and ROLLBACK. Financial correctness, concurrency safety per wallet, and persistent idempotency are the core evaluation criteria of the challenge and depend on this change.

## What Changes

- Introduce the `WagerTransaction` domain entity representing every financial operation (internal `OPENING` and provider-submitted kinds), with a documented state machine (`PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`) and a stable machine-readable `failureCode` taxonomy.
- Implement the transaction-processing use case that, inside a single SQL transaction, locks the wallet (`SELECT ... FOR UPDATE`), resolves idempotency (key and provider/external pair), validates business rules, applies balance effects, and persists transaction + ledger + outbox atomically.
- Implement reference handling: REFUND and ROLLBACK resolve their target via `(providerId, referenceExternalTransactionId)`; missing references are persisted as `PENDING_REFERENCE` (reprocessing worker is a later change).
- Extend wallet opening so the internal `OPENING` transaction row is created in the same SQL transaction as the wallet and its ledger entry, eliminating orphan `transaction_id` references, and so the opening credit emits its `WagerTransactionProcessed` + `WalletBalanceChanged` outbox events in that same commit (README §11).
- Introduce the transactional outbox table and per-outcome event persistence (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`) committed atomically with the financial effect. Publishing is out of scope (F4).
- Validate every business identifier (`providerId`, `externalTransactionId`, `idempotencyKey`, `roundId`, `gameId`, `playerId`, `walletId`, optional `referenceExternalTransactionId`) structurally before any persistence: malformed payloads raise a field-named error and never become persisted rejections or partial writes.
- Add a persistence mapping for `WagerTransaction` and `OutboxMessage`, plus an incremental PostgreSQL migration adding the new tables and the deferred foreign key from `wallet_ledger_entry.transaction_id`.

## Capabilities

### New Capabilities
- `financial/transactions`: WagerTransaction entity, state machine, failure codes, payload-hash idempotency semantics, OPENING atomicity.
- `financial/processing`: the transaction-processing use case — wallet locking, idempotency resolution, business rules (BET/WIN/LOSS/REFUND/ROLLBACK), reference resolution and PENDING_REFERENCE, atomic persistence.
- `financial/outbox`: outbox table, per-outcome event set, atomic enqueue with the financial effect, no publication before commit.

### Modified Capabilities
- (None — `financial/wallet-ledger` keeps its F1 requirements; F2 only adds the deferred FK on `transaction_id` at the schema level.)

## Impact

- **Database**: New tables `wager_transaction` and `outbox_event`; new deferred FK `wallet_ledger_entry.transaction_id → wager_transaction(id)`; new unique constraints (provider+external id, idempotency key, partial unique preventing double reversal).
- **Domain**: New `WagerTransaction` entity, `FailureCode` taxonomy, integration-event hierarchy; `Wallet` gains debit/credit domain methods.
- **Application**: New transaction-processing use case owned by the application layer (opens/commits the SQL transaction, D5).
- **Tests**: Real-PostgreSQL concurrency scenarios (50x parallel same bet, 80/80 vs 100, distinct wallets in parallel), idempotency replay/conflict, PENDING_REFERENCE, atomic rollback.
