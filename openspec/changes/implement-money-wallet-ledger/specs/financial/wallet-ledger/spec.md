# Spec Delta

## Purpose
Establishes the `Wallet` entity and `WalletLedgerEntry` append-only history, guaranteeing balance invariants and uniqueness.

## ADDED Requirements

### Requirement: Wallet Invariants
A wallet belongs to a single player and currency. Its balance MUST NOT be negative. Its version starts at 1 and increments only when the balance changes.

#### Scenario: Negative balance prevention
- **WHEN** an operation attempts to reduce the wallet balance below zero
- **THEN** it is rejected and the balance/version remain unchanged

#### Scenario: Uniqueness
- **WHEN** attempting to create a second wallet for the same player and currency
- **THEN** it is rejected due to a uniqueness constraint

### Requirement: Append-Only Ledger
Every balance change MUST correspond to a new `WalletLedgerEntry`. The ledger table MUST be protected from UPDATE, DELETE, and TRUNCATE by both database privileges and table triggers, for every database role including the table owner. A wallet and its opening ledger entry MUST be persisted atomically: if either write fails, neither is visible.

#### Scenario: Direct SQL mutation prevented (application role)
- **WHEN** a database user acting as the application attempts to update, delete, or truncate ledger entries
- **THEN** the database rejects the operation with a permission error and the rows remain unchanged

#### Scenario: Direct SQL mutation prevented (table owner)
- **WHEN** the table owner attempts to update, delete, or truncate a ledger entry
- **THEN** the database rejects the operation with an append-only error raised by a trigger and the rows remain unchanged

#### Scenario: Atomic opening rollback
- **WHEN** persisting a wallet and its opening ledger entry fails on the ledger write
- **THEN** the whole transaction rolls back and no wallet row remains

#### Scenario: One entry per transaction
- **WHEN** a second ledger entry is written for the same wallet and transaction id
- **THEN** it is rejected due to a uniqueness constraint

### Requirement: Wallet Opening
Wallets MUST be opened with an initial balance. The initial balance MUST NOT be negative.

#### Scenario: Negative initial balance rejected
- **WHEN** a wallet is opened with a negative initial balance
- **THEN** it is rejected and no wallet or ledger entry is created

#### Scenario: Opening with zero balance
- **WHEN** a wallet is opened with a balance of zero
- **THEN** the wallet is created at version 1 and no ledger entry is created

#### Scenario: Opening with positive balance
- **WHEN** a wallet is opened with a positive balance
- **THEN** the wallet is created at version 1 and an `OPENING` ledger entry is atomically created
