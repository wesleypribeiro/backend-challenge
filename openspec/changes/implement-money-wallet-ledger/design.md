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
   - `wallet.version` will be used for optimistic concurrency control. It starts at `1` and increments *only* when the balance is modified.
   - Initial balances of `0` result in a wallet with version `1` and no ledger entry. Initial balances `> 0` result in a wallet with version `1` and a single `OPENING` ledger entry. Wait, if it starts at 1, and the balance changes from 0 to positive, the version increments to 2? No, the requirement says "Começar a versão em 1 e incrementá-la somente quando o saldo mudar". If it starts with > 0, it has a ledger entry, and version is 1? Yes, starting implies version 1.

4. **Persistence & Transactions**:
   - Wallet and Ledger updates must occur in the exact same SQL transaction. MikroORM `UnitOfWork` will be used for this.

## Risks / Trade-offs

- [Risk] Rounding and scientific notation injection in `Money`. → The `Money` constructor will strictly validate the input format (e.g. regex for exactly up to 2 decimal places) and throw errors on invalid input, rather than coercing.
- [Risk] Wallet data anomaly (balance mismatch with ledger). → PostgreSQL check constraints (e.g., `balance >= 0`) and reconstructing tests will ensure consistency.
