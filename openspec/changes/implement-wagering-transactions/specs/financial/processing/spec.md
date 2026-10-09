# Spec Delta

## Purpose
Defines the transaction-processing use case: wallet-level concurrency via pessimistic locking, persistent idempotency, business rules for every kind, reference resolution and PENDING_REFERENCE, and atomic persistence of transaction + ledger + outbox.

## ADDED Requirements

### Requirement: Wallet-Level Serialization
The unit of concurrency is the wallet. Before validating or applying any balance-affecting operation, the use case MUST lock the wallet row (`SELECT ... FOR UPDATE`). Operations on distinct wallets MUST proceed in parallel without waiting for one another; operations on the same wallet are serialized.

#### Scenario: Same wallet serialized
- **WHEN** two balance-affecting operations for the same wallet are processed concurrently
- **THEN** one acquires the lock first and the other waits; both complete with consistent final state

#### Scenario: Distinct wallets proceed in parallel
- **WHEN** operations for two different wallets are processed concurrently and one wallet's transaction is held open
- **THEN** the other wallet's operation completes without waiting for the first (observable via lock waits in PostgreSQL)

### Requirement: Concurrent Balance Contention
When concurrent operations exceed the available balance, exactly one MUST be applied and the others MUST be rejected for insufficient funds. No retry or duplicate MAY apply a second effect.

#### Scenario: Mandatory 80/80 vs 100 scenario
- **WHEN** two BETs of 80.00 run concurrently against a wallet with 100.00
- **THEN** exactly one is `PROCESSED`, the other is `REJECTED` with `INSUFFICIENT_FUNDS`, the final balance is 20.00, and exactly one `DEBIT` ledger entry exists

#### Scenario: Same bet submitted 50 times in parallel
- **WHEN** the same idempotent submission is processed 50 times concurrently
- **THEN** exactly one transaction is applied, exactly one ledger entry exists, and the other 49 requests observe the replayed original result

### Requirement: Persistent Idempotency
Idempotency MUST survive process restarts: it is enforced by database uniqueness on the idempotency key and on `(providerId, externalTransactionId)`, not by in-process caches. A concurrent duplicate that loses the uniqueness race MUST be resolved by rolling back, re-reading in a fresh transaction, and returning the stored outcome — never by continuing in an aborted transaction.

#### Scenario: Duplicate after restart
- **WHEN** a transaction was processed, the process restarted, and the same submission arrives
- **THEN** the original outcome is replayed and no new effect occurs

#### Scenario: Concurrent unique-violation recovery
- **WHEN** two concurrent submissions with the same idempotency key race on the unique constraint
- **THEN** the loser rolls back, re-reads the winner's row, and returns the replay — the database state contains exactly one transaction and one effect

### Requirement: Atomic Financial Persistence
Transaction row, wallet balance change, ledger entry (when applicable) and outbox events MUST be committed in a single SQL transaction. A failure at any point MUST roll back all of them; nothing may be visible partially. No outbox event may be published before the commit.

#### Scenario: Atomic rollback on failure
- **WHEN** a failure is injected after the transaction row is staged but before the commit
- **THEN** the transaction, ledger entry, outbox rows and wallet balance change are all absent

#### Scenario: Success commits everything together
- **WHEN** a balance-affecting transaction is processed successfully
- **THEN** the transaction row, the wallet balance/version, the ledger entry and the outbox rows become visible in the same commit

### Requirement: BET Processing
A BET MUST debit the wallet and produce one `DEBIT` ledger entry. It MUST be rejected with `INSUFFICIENT_FUNDS` when the balance is insufficient, without any balance change or ledger entry.

#### Scenario: Successful BET
- **WHEN** a BET of 25.00 is processed against a 100.00 wallet
- **THEN** the transaction is `PROCESSED`, the balance is 75.00, and one `DEBIT` entry of 25.00 links to the transaction

#### Scenario: Insufficient funds
- **WHEN** a BET of 150.00 is processed against a 100.00 wallet
- **THEN** the transaction is `REJECTED` with `INSUFFICIENT_FUNDS` and the balance remains 100.00

### Requirement: WIN Processing
A WIN MUST credit the wallet and produce one `CREDIT` ledger entry. It MAY reference a BET of the same round; a divergent reference scope is rejected with the corresponding `REFERENCE_*` code. Without a reference it processes normally. With an informed reference that is missing (or not yet `PROCESSED`), it is stored as `PENDING_REFERENCE` with no credit and no ledger entry; an idempotent resubmission MUST replay that pending outcome without new events.

#### Scenario: WIN without reference processes normally
- **WHEN** a WIN is submitted without `referenceExternalTransactionId`
- **THEN** the transaction is `PROCESSED` and the wallet is credited once

#### Scenario: Successful WIN with BET reference
- **WHEN** a WIN references a `PROCESSED` BET of the same provider, player, wallet, currency and round
- **THEN** the transaction is `PROCESSED` and the wallet is credited once

#### Scenario: Cross-scope reference rejected
- **WHEN** a WIN references a BET belonging to another wallet or round
- **THEN** the transaction is `REJECTED` with the corresponding `REFERENCE_WALLET_MISMATCH` or `REFERENCE_ROUND_MISMATCH` code

#### Scenario: WIN with missing optional reference stored as pending
- **WHEN** a WIN references an external id that does not exist yet
- **THEN** the transaction is persisted as `PENDING_REFERENCE` with no balance change and no ledger entry

#### Scenario: Idempotent resubmission of a pending WIN replays it
- **WHEN** the same WIN submission (same idempotency key and payload) arrives again while its reference is still missing
- **THEN** the original pending outcome is replayed with `idempotentReplay: true`, the same transactionId, and no new outbox event

### Requirement: LOSS Processing
A LOSS MUST NOT change the balance and MUST NOT produce a ledger entry. It is recorded as `PROCESSED` with a `WagerTransactionProcessed` event.

#### Scenario: LOSS recorded without effect
- **WHEN** a LOSS is processed
- **THEN** the transaction is `PROCESSED`, the balance and version are unchanged, and no ledger entry exists

### Requirement: REFUND Processing
A REFUND MUST credit the wallet, reference a `PROCESSED` BET, carry an equal amount, and succeed at most once per referenced BET. A missing reference is stored as `PENDING_REFERENCE`.

#### Scenario: Successful REFUND
- **WHEN** a REFUND references a `PROCESSED` BET with an equal amount
- **THEN** the transaction is `PROCESSED` and the wallet is credited by the referenced amount

#### Scenario: REFUND of non-BET rejected
- **WHEN** a REFUND references a WIN or LOSS
- **THEN** the transaction is `REJECTED` with `REFERENCE_KIND_NOT_ALLOWED`

#### Scenario: Second REFUND of the same BET
- **WHEN** a second REFUND references a BET that was already refunded
- **THEN** the transaction is `REJECTED` with `DUPLICATE_REVERSAL`

#### Scenario: Missing reference stored as pending
- **WHEN** a REFUND references an external id that does not exist yet
- **THEN** the transaction is persisted as `PENDING_REFERENCE` with no balance change and no ledger entry

#### Scenario: Pending REFUND is not resolved by a later BET or a new submission
- **WHEN** the referenced BET arrives after the REFUND was stored as `PENDING_REFERENCE`
- **THEN** the original row remains `PENDING_REFERENCE`; an idempotent resubmission replays the pending outcome, and only a distinct new submission (fresh key) may apply — resolution of the original row is the F5 scheduler's job, preserving its transactionId and re-checking `DUPLICATE_REVERSAL` before applying

### Requirement: ROLLBACK Processing
A ROLLBACK MUST apply the inverse of the referenced transaction's direction (BET→CREDIT, WIN/REFUND→DEBIT), reference a `PROCESSED` BET, WIN or REFUND, carry an equal amount, and succeed at most once per referenced transaction. A reversal that would drive the balance negative is rejected with `ROLLBACK_INSUFFICIENT_FUNDS`. A missing reference is stored as `PENDING_REFERENCE`.

#### Scenario: Rollback of a BET
- **WHEN** a ROLLBACK references a `PROCESSED` BET
- **THEN** the transaction is `PROCESSED` and the wallet is credited by the referenced amount (inverse direction)

#### Scenario: Rollback driving balance negative
- **WHEN** a ROLLBACK of a BET would leave the balance below zero (a WIN was not yet credited)
- **THEN** the transaction is `REJECTED` with `ROLLBACK_INSUFFICIENT_FUNDS` and the balance is unchanged

#### Scenario: Missing reference stored as pending
- **WHEN** a ROLLBACK references an external id that does not exist yet
- **THEN** the transaction is persisted as `PENDING_REFERENCE` with no balance change and no ledger entry

### Requirement: Currency and Wallet Consistency
The operation currency MUST equal the wallet currency; a mismatch is rejected with `CURRENCY_MISMATCH`. The wallet's player MUST match the payload's player; a mismatch is rejected with `WALLET_PLAYER_MISMATCH`. An unknown wallet is a structural error (exception), not a persisted rejection.

#### Scenario: Currency mismatch
- **WHEN** a transaction in USD targets a BRL wallet
- **THEN** it is rejected with `CURRENCY_MISMATCH` and no balance change occurs

#### Scenario: Player mismatch
- **WHEN** a transaction's playerId differs from the wallet's playerId
- **THEN** it is rejected with `WALLET_PLAYER_MISMATCH`

### Requirement: Structural Identifier Validation
Every business identifier of a submission — `providerId`, `externalTransactionId`, `idempotencyKey`, `roundId`, `gameId`, `playerId`, `walletId` and the optional `referenceExternalTransactionId` — MUST be structurally valid: a string, non-empty, within its field's size limit, and in UUID form for `playerId` and `walletId`. An invalid identifier is a malformed payload, not a business rejection: the use case MUST raise a structural error (carrying the offending field) before opening any SQL transaction, so a bad field can never produce a partial write or a persisted `REJECTED` row.

#### Scenario: Malformed walletId never reaches persistence
- **WHEN** a submission carries a `walletId` that is not a UUID
- **THEN** the use case raises a structural error naming `walletId`, and no transaction, ledger entry, outbox row or balance change is written

#### Scenario: Empty business field rejected structurally
- **WHEN** a submission carries an empty `providerId` (or any other required identifier)
- **THEN** the use case raises a structural error naming the field, with no database writes

#### Scenario: Valid identifiers proceed to business rules
- **WHEN** a submission carries well-formed identifiers
- **THEN** processing continues to locking, idempotency and business validation unchanged
