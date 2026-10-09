# Spec Delta

## Purpose
Establishes the `WagerTransaction` entity, its state machine, the failure-code taxonomy, and the atomic OPENING transaction that eliminates orphan ledger references.

## ADDED Requirements

### Requirement: Transaction State Machine
A wager transaction is created in `PENDING` and transitions to exactly one of `PROCESSED`, `REJECTED`, `PENDING_REFERENCE` or `FAILED`. `PROCESSED`, `REJECTED` and `FAILED` are terminal: attempting to transition a transaction that has reached one of them MUST raise a state error, not be treated as a business path.

#### Scenario: Creation starts pending
- **WHEN** a transaction is created through the domain factory
- **THEN** its status is `PENDING` and it has no `processedAt`, `failureCode` or `referenceTransactionId`

#### Scenario: Terminal state transition rejected
- **WHEN** a `PROCESSED`, `REJECTED` or `FAILED` transaction is asked to `markProcessed`, `markPendingReference`, `reject` or `fail` again
- **THEN** an invalid-state error is raised and the status is unchanged

#### Scenario: Valid transitions
- **WHEN** a `PENDING` transaction is marked processed, marked pending-reference, rejected, or failed
- **THEN** the transition is accepted and the corresponding fields (`processedAt`, `failureCode`) are set

### Requirement: Reference Requirements by Kind
`OPENING` is internal and MUST NOT be submitted through the public API or the queue. `REFUND` and `ROLLBACK` MUST carry `referenceExternalTransactionId`; `WIN` MAY carry one (referencing a BET of the same round); `BET` and `LOSS` MUST NOT. A `WIN` whose optional reference was explicitly informed MAY transition to `PENDING_REFERENCE` when that reference cannot yet be resolved; a `WIN` without a reference MUST NOT. `OPENING` is created only by the wallet-opening flow.

#### Scenario: REFUND without reference rejected at creation
- **WHEN** a `REFUND` transaction is created without `referenceExternalTransactionId`
- **THEN** creation fails and no transaction is persisted

#### Scenario: OPENING cannot be submitted externally
- **WHEN** a submission arrives with kind `OPENING`
- **THEN** it is rejected before any persistence (structural rejection, not a business `REJECTED` row)

#### Scenario: BET with a reference is invalid
- **WHEN** a `BET` transaction is created with `referenceExternalTransactionId` set
- **THEN** creation fails

#### Scenario: WIN with an informed reference may wait
- **WHEN** `markPendingReference` is called on a `WIN` whose optional reference was explicitly informed
- **THEN** the transition succeeds and the status becomes `PENDING_REFERENCE`

#### Scenario: WIN without a reference cannot wait
- **WHEN** `markPendingReference` is called on a `WIN` without `referenceExternalTransactionId` (or on a `BET`/`LOSS`)
- **THEN** the transition raises a state error

### Requirement: Balance Effects
`BET` MUST debit the wallet, `WIN` and `REFUND` MUST credit it, `ROLLBACK` MUST apply the inverse of the referenced transaction's direction, and `LOSS` MUST change no balance and produce no ledger entry. A `REJECTED` transaction MUST NEVER change the balance or produce a ledger entry.

#### Scenario: LOSS produces no ledger entry
- **WHEN** a `LOSS` transaction is processed
- **THEN** the wallet balance and version are unchanged, no ledger entry exists, and the transaction is `PROCESSED`

#### Scenario: Rejected transaction produces no ledger entry
- **WHEN** a transaction is rejected (e.g. insufficient funds)
- **THEN** no ledger entry is written and the balance is unchanged

### Requirement: Atomic Opening Transaction
When a wallet is opened with a positive balance, the internal `OPENING` transaction row, the wallet row and the `OPENING` ledger entry MUST be persisted in the same SQL transaction. The ledger entry's `transaction_id` MUST always reference an existing `wager_transaction` row — no orphan references. The internal OPENING transaction uses provider id `internal`, external id `opening-{walletId}` and idempotency key `internal:opening-{walletId}`.

#### Scenario: Opening persists transaction, wallet and entry together
- **WHEN** a wallet is opened with a positive balance
- **THEN** a `PROCESSED` `OPENING` transaction, the wallet and one `CREDIT` ledger entry referencing that transaction are all committed atomically

#### Scenario: Opening commits its integration events atomically
- **WHEN** a wallet is opened with a positive balance
- **THEN** one `WagerTransactionProcessed` and one `WalletBalanceChanged` outbox event for the `OPENING` transaction are committed in the same SQL transaction (README §11: every applied transaction emits processed; every balance movement emits balance-changed), with no publication before commit

#### Scenario: Zero-balance opening writes nothing beyond the wallet
- **WHEN** a wallet is opened with a zero balance
- **THEN** no `OPENING` transaction, no ledger entry and no outbox event exist for it

#### Scenario: Opening rollback leaves nothing
- **WHEN** any write in the opening transaction fails
- **THEN** the transaction, wallet and ledger entry are all absent

#### Scenario: Ledger always references a real transaction
- **WHEN** a ledger row is queried after any successful operation
- **THEN** its `transaction_id` resolves to an existing `wager_transaction` row

### Requirement: Failure Code Taxonomy
Every business rejection MUST carry a stable, machine-readable `failureCode`. Insufficient funds and a reversal that would drive the balance negative MUST use distinct codes. Reference-scope mismatches (provider, player, wallet, currency, round, amount), disallowed reference kind and duplicate reversal each have their own code. Structural or programming errors MUST NOT be persisted as rejections — they raise exceptions.

#### Scenario: Insufficient funds code
- **WHEN** a BET exceeds the available balance
- **THEN** the transaction is `REJECTED` with `INSUFFICIENT_FUNDS`

#### Scenario: Reversal negative-balance code is distinct
- **WHEN** a ROLLBACK would drive the balance below zero
- **THEN** the transaction is `REJECTED` with `ROLLBACK_INSUFFICIENT_FUNDS`, not `INSUFFICIENT_FUNDS`

#### Scenario: Reference scope mismatch codes
- **WHEN** a REFUND references a transaction of another player, wallet, currency, round, provider, or with a different amount
- **THEN** the transaction is `REJECTED` with the corresponding `REFERENCE_*` code

#### Scenario: Duplicate reversal
- **WHEN** a second REFUND (or ROLLBACK) references the same already-reversed transaction
- **THEN** the transaction is `REJECTED` with `DUPLICATE_REVERSAL`

### Requirement: Payload Hash Idempotency
Each transaction stores a `payloadHash` computed from a canonical (sorted-key) JSON serialization of the business fields only (provider id, external id, player, wallet, round, game, kind, amount, currency, reference external id). The same idempotency key with a divergent payload hash is a conflict — not a replay — and MUST NOT create a new transaction, ledger entry or event.

#### Scenario: Replay returns original outcome
- **WHEN** a submission with the same idempotency key and the same payload hash arrives after the original was processed
- **THEN** the original outcome (status and the balance observed at processing time) is returned with `idempotentReplay: true` and no new effect occurs

#### Scenario: Divergent payload is a conflict
- **WHEN** a submission with the same idempotency key but a different payload hash arrives
- **THEN** a conflict is returned, no new transaction is persisted, and the stored transaction is unchanged
