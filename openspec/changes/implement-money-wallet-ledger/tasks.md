# Tasks

## 1. Domain Types

- [x] 1.1 Add `decimal.js` to project dependencies and verify installation succeeds.
- [x] 1.2 Implement `Money` value object representing amounts using `decimal.js` with exact 2-decimal-place scale validation. Verify unit tests cover valid input, invalid input (scientific notation, excess scale), ISO 4217 validation, and immutability up to `Number.MAX_SAFE_INTEGER`.
- [x] 1.3 Implement `WalletLedgerEntry` append-only entity capturing operation, amount, currency, and timestamps. Verify unit test isolation.
- [x] 1.4 Implement `Wallet` aggregate entity maintaining balance invariants (non-negative) and versioning. Implement `open` static factory method handling initial balance and corresponding ledger creation. Verify unit tests covering constraints and the `OPENING` scenario.

## 2. Persistence

- [ ] 2.1 Add MikroORM schema entities for `wallet` and `wallet_ledger_entry`. Verify entity metadata compilation and table mappings.
- [ ] 2.2 Create versioned PostgreSQL migration `up` with constraints (`balance >= 0`, `UNIQUE(player_id, currency)`) and trigger/rule to prevent `UPDATE`, `DELETE`, and `TRUNCATE` on `wallet_ledger_entry`. Verify migration is reversible (`down`).
- [ ] 2.3 Implement repository methods using `UnitOfWork` to save wallet and ledger atomically. Verify integration tests prove atomic flush.

## 3. Validation

- [ ] 3.1 Write real PostgreSQL integration tests proving uniqueness by player/currency. Verify `test:integration` covers the unique constraint violation.
- [ ] 3.2 Write real PostgreSQL integration tests proving append-only enforcement. Verify direct SQL attempts to mutate the ledger fail.
- [ ] 3.3 Validate overall implementation with `bun run test:unit`, `bun run test:integration`, and OpenSpec validation for `implement-money-wallet-ledger`.
