# Design

## Context

The foundation layer established the LocalStack and PostgreSQL infrastructure along with MikroORM integration. We are now introducing the first domain capability (F1): the Money value object and the Wallet entity. The financial integrity of the system requires precise math, append-only ledgers, and strict invariant checking.

## Goals / Non-Goals

**Goals:**
- Implement `Money` as an exact, immutable value object with `decimal.js`, preventing floating-point drift.
- Implement the `Wallet` aggregate root with a single, reliable source of truth for balances (via `WalletLedgerEntry`).
- Persist `Wallet` and `WalletLedgerEntry` using MikroORM with PostgreSQL constraints.
- Allow internal creation of Wallets with optional initial positive balances mapped to an `OPENING` ledger operation.

**Non-Goals:**
- No endpoints or external API integrations yet.
- No `BET`, `WIN`, `LOSS`, or `REFUND` transactions in this change.
- No inbox/outbox, consumer, or event publisher implementation yet.
- No creation of a double-entry accounting system (since a single-sided append-only ledger per wallet is sufficient and requested).

## Decisions

1. **`decimal.js` for Money Representation**:
   - We will use `decimal.js` exclusively inside `Money` and map it to `NUMERIC(20,2)` in PostgreSQL.
   - *Alternative*: Using `number` (fails due to floating-point imprecision) or `BigInt` with cents (adds complexity dividing for display/serialization).
   - `decimal.js` allows precise mathematical operations while enforcing the 2-decimal-place constraint and rejecting scientific notation or excess scale silently.

2. **Ledger as Append-Only**:
   - `WalletLedgerEntry` will be the source of truth for the balance history. A PostgreSQL trigger/constraint will deny `UPDATE`, `DELETE`, and `TRUNCATE` operations on this table to ensure auditability.
   - *Alternative*: Keeping just a snapshot. This violates the auditability and reconstructability requirement of the ledger.

3. **Wallet Versioning**:
   - `wallet.version` starts at `1` and increments *only* when the balance is modified in future changes.
   - Opening with `0` or a positive initial balance both produce version `1`; a positive balance additionally produces one `OPENING` ledger entry in the same flush.
   - The column is a plain `integer` (no ORM auto-increment, no `version: true`): F2 will increment it explicitly under pessimistic locking (D7), so the domain — not the ORM — owns version transitions.

4. **Persistence & Transactions**:
   - Wallet and Ledger insert must occur in the same SQL transaction. `WalletRepository.saveOpen` creates both entities in a single Unit of Work and calls `em.flush()` once; MikroORM wraps that flush in one transaction. The repository never opens its own independent commit (D5: the use case will own the transaction in F2).

5. **Flat entity metadata with deferred composite FK**:
   - `WalletLedgerEntrySchema` maps `walletId` as a scalar without a declared `m:1` relation, keeping persistence records flat (MikroORM 7 removed decorator APIs; class-less `EntitySchema` matches the existing fixture pattern).
   - Because the Unit of Work cannot infer insertion order from a scalar FK, the FK is `DEFERRABLE INITIALLY DEFERRED`: inserts may occur in any order inside the flush transaction and the constraint is still enforced atomically at commit.
   - The FK is **composite**: `wallet_ledger_entry (wallet_id, currency) → wallet (id, currency)`, with `UNIQUE (id, currency)` added on `wallet` as the target. It simultaneously enforces wallet existence and the README invariant that the operation currency equals the wallet currency — direct SQL with a divergent currency fails with `23503` even when every row-level check passes.
   - *Alternatives*: declaring a hidden relation purely for ordering, or issuing two flushes inside a repository-level transaction — both add metadata/commit complexity without strengthening integrity; a separate CHECK comparing currencies is impossible across tables without an FK.

6. **Two-layer append-only enforcement**:
   - Layer 1 — `wagering_app` receives only `SELECT`/`INSERT` grants on the ledger, so `UPDATE`/`DELETE`/`TRUNCATE` fail with `42501` before touching triggers.
   - Layer 2 — `BEFORE UPDATE`/`BEFORE DELETE`/`BEFORE TRUNCATE` triggers raise an exception for **every** role, including the table owner (`wagering_migrator`), so dropping grants can never expose mutation.
   - *Alternatives*: event triggers (cannot run inside the migration transaction), `INSTEAD OF NOTHING` rules (do not actually reject), or grants alone (owner bypasses them).

7. **Runtime immutability**:
   - `Money` and `WalletLedgerEntry` are `Object.freeze`d in their constructors/factories so accidental mutation fails at runtime in development and tests. `Wallet` is deliberately **not** frozen: F2 will mutate balance/version through domain methods.

8. **Opening correspondence validated in the repository**:
   - `WalletRepository.saveOpen` rejects, before scheduling any row: a positive-balance wallet without its entry, a zero-balance wallet with an entry, a negative balance, and any pair disagreement on wallet id, currency (all three money fields), operation (`OPENING`), direction (`CREDIT`), starting balance (zero) and final balance (equal to the wallet balance).
   - *Alternative*: trusting `Wallet.open` alone — insufficient because F2 and tests can reassemble pairs through `rehydrate`, which deliberately skips validation; the persistence contract must re-assert the invariant.

9. **Operation/direction matrix in `WalletLedgerEntry.create`**:
   - A whitelist maps each operation to its allowed directions: `OPENING` credit from a zero balance, `BET` debit, `WIN`/`REFUND` credit, `ROLLBACK` either direction (F2 resolves it from the referenced transaction), `LOSS` none — LOSS does not move the balance and must never produce an entry (README §7). Unrecognized operations are rejected.
   - Kept in the domain only for now: a DB-level CHECK for the matrix would be evaluated at insert time, and its exact form is better settled together with F2, which is the first producer of non-`OPENING` entries. The currency and structural invariants already have DB enforcement.

10. **F2 handoff — atomic internal `OPENING` transaction**:
    - F1 persists the wallet row and the `OPENING` ledger entry atomically, but the ledger entry's `transactionId` currently points at an id generated for the future transaction. F2 **must** create and persist the internal `OPENING` `WagerTransaction` row in the **same SQL transaction** as the wallet and its ledger entry, so `wallet_ledger_entry.transaction_id` always references a real transaction row — no orphan references in the ledger.
    - F2 must also extend `saveOpen`/its successor so the opening flow persists transaction + wallet + entry together, keeping the correspondence rules of decision 8.

## Risks / Trade-offs

- [Risk] Rounding and scientific notation injection in `Money`. → The `Money` constructor will strictly validate the input format (e.g. regex for exactly up to 2 decimal places) and throw errors on invalid input, rather than coercing.
- [Risk] Wallet data anomaly (balance mismatch with ledger). → PostgreSQL check constraints (e.g., `balance >= 0`) and reconstructing tests will ensure consistency.
