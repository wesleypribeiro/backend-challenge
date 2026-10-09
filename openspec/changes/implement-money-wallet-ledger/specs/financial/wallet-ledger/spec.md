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
Every balance change MUST correspond to a new `WalletLedgerEntry`. The ledger table MUST be protected from UPDATE, DELETE, and TRUNCATE.

#### Scenario: Direct SQL mutation prevented
- **WHEN** a database user acting as the application attempts to update or delete a ledger entry
- **THEN** the database rejects the operation

### Requirement: Wallet Opening
Wallets MUST be opened with an initial balance.

#### Scenario: Opening with zero balance
- **WHEN** a wallet is opened with a balance of zero
- **THEN** the wallet is created at version 1 and no ledger entry is created

#### Scenario: Opening with positive balance
- **WHEN** a wallet is opened with a positive balance
- **THEN** the wallet is created at version 1 and an `OPENING` ledger entry is atomically created
