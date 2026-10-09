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

#### Scenario: Ledger currency matches wallet currency
- **WHEN** a ledger row is written for an existing wallet with a different currency
- **THEN** the composite foreign key on (wallet_id, currency) rejects it and no row is stored

### Requirement: Opening Persistence Consistency
Persisting a wallet opening MUST keep the wallet row and its ledger entry in exact correspondence: the entry targets the same wallet id, uses the same currency as the wallet, carries operation `OPENING` with direction `CREDIT`, starts from a zero balance, and ends at the wallet balance. A wallet with a positive balance MUST NOT be persisted without its entry, and a wallet with a zero balance MUST NOT carry an entry. Correspondence violations MUST be rejected before any row is scheduled.

#### Scenario: Positive balance without opening entry rejected
- **WHEN** `saveOpen` receives a wallet with a positive balance and no ledger entry
- **THEN** it is rejected and neither wallet nor ledger rows are written

#### Scenario: Mismatched opening pair rejected
- **WHEN** `saveOpen` receives a wallet whose entry targets another wallet id, another currency, another operation, a debit direction, a non-zero starting balance, or a final balance different from the wallet balance
- **THEN** it is rejected before any row is scheduled

#### Scenario: Zero balance with entry rejected
- **WHEN** `saveOpen` receives a zero-balance wallet together with a ledger entry
- **THEN** it is rejected and no rows are written

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

### Requirement: Ledger Operation Validity
`WalletLedgerEntry.create` MUST accept only operations that produce a ledger entry, paired with their allowed directions: `OPENING` credits from a zero balance, `BET` debits, `WIN` and `REFUND` credit, and `ROLLBACK` may be either direction because its direction is defined by the referenced transaction. Operations without balance effect (`LOSS`) MUST NOT produce an entry, and unrecognized operations MUST be rejected.

#### Scenario: LOSS rejected
- **WHEN** `create` receives an entry with operation `LOSS`
- **THEN** it is rejected because LOSS never produces a ledger entry

#### Scenario: Invalid operation/direction combination rejected
- **WHEN** `create` receives `OPENING` as a debit, `BET` as a credit, or `WIN`/`REFUND` as a debit
- **THEN** it is rejected

#### Scenario: OPENING requires a zero opening balance
- **WHEN** `create` receives an `OPENING` credit whose balance before is not zero
- **THEN** it is rejected

#### Scenario: ROLLBACK directions preserved for F2
- **WHEN** `create` receives balanced `ROLLBACK` entries in both directions
- **THEN** both are accepted
