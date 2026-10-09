# Proposal

## Why

The system needs a foundational financial capability to track player balances and operations with extreme accuracy. This establishes the `Money` value object, `Wallet` entity, and an append-only `WalletLedgerEntry` to guarantee correctness and auditability of financial state before implementing specific game transactions like BET, WIN, and LOSS.

## What Changes

- Introduce an immutable `Money` value object using exact decimals (`decimal.js`) to prevent floating-point errors.
- Introduce a `Wallet` domain entity representing a player's balance in a specific currency.
- Introduce an append-only `WalletLedgerEntry` entity acting as the financial source of truth for every balance change.
- Implement an internal wallet creation mechanism allowing an `OPENING` ledger entry for an initial balance.
- Integrate MikroORM persistence for the wallet and ledger with strict PostgreSQL constraints (e.g., balance cannot be negative, unique constraint on player ID and currency).

## Capabilities

### New Capabilities
- `financial/money`: Defines the immutable, exact-decimal Money value object with strict validations (ISO 4217, no mixed currencies, scale limit).
- `financial/wallet`: Defines the Wallet entity, its balance invariants (no negative balance, atomic version increments), and the append-only Ledger entry.

### Modified Capabilities
- (None)

## Impact

- **Database**: New tables for `wallet` and `wallet_ledger_entry` with corresponding constraints and indexes.
- **Dependencies**: Adds `decimal.js` for precise mathematical operations.
- **Domain**: Establishes the base types and invariants that all future financial operations (BET, WIN, LOSS) will depend on.
