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

5. **Flat entity metadata with deferred FK**:
   - `WalletLedgerEntrySchema` maps `walletId` as a scalar without a declared `m:1` relation, keeping persistence records flat (MikroORM 7 removed decorator APIs; class-less `EntitySchema` matches the existing fixture pattern).
   - Because the Unit of Work cannot infer insertion order from a scalar FK, `wallet_ledger_entry.wallet_fk` is `DEFERRABLE INITIALLY DEFERRED`: inserts may occur in any order inside the flush transaction and the constraint is still enforced atomically at commit.
   - *Alternative*: declaring a hidden relation purely for ordering, or issuing two flushes inside a repository-level transaction — both add metadata/commit complexity without strengthening integrity.

6. **Two-layer append-only enforcement**:
   - Layer 1 — `wagering_app` receives only `SELECT`/`INSERT` grants on the ledger, so `UPDATE`/`DELETE`/`TRUNCATE` fail with `42501` before touching triggers.
   - Layer 2 — `BEFORE UPDATE`/`BEFORE DELETE`/`BEFORE TRUNCATE` triggers raise an exception for **every** role, including the table owner (`wagering_migrator`), so dropping grants can never expose mutation.
   - *Alternatives*: event triggers (cannot run inside the migration transaction), `INSTEAD OF NOTHING` rules (do not actually reject), or grants alone (owner bypasses them).

7. **Runtime immutability**:
   - `Money` and `WalletLedgerEntry` are `Object.freeze`d in their constructors/factories so accidental mutation fails at runtime in development and tests. `Wallet` is deliberately **not** frozen: F2 will mutate balance/version through domain methods.

## Risks / Trade-offs

- [Risk] Rounding and scientific notation injection in `Money`. → The `Money` constructor will strictly validate the input format (e.g. regex for exactly up to 2 decimal places) and throw errors on invalid input, rather than coercing.
- [Risk] Wallet data anomaly (balance mismatch with ledger). → PostgreSQL check constraints (e.g., `balance >= 0`) and reconstructing tests will ensure consistency.
