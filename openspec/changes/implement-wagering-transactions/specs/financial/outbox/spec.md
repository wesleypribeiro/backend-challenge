# Spec Delta

## Purpose
Defines the transactional outbox: atomic enqueue of integration events with the financial effect, the per-outcome event set, and the guarantee that no event is published before the commit.

## ADDED Requirements

### Requirement: Atomic Outbox Enqueue
Outbox rows MUST be inserted in the same SQL transaction as the transaction, wallet balance change and ledger entry. If the financial write rolls back, the outbox rows MUST roll back with it; if it commits, the outbox rows are committed with it.

#### Scenario: Outbox rolls back with the financial effect
- **WHEN** a transaction is processed and the commit fails
- **THEN** no outbox row for that operation is visible

#### Scenario: Outbox commits with the financial effect
- **WHEN** a transaction is processed successfully
- **THEN** the outbox rows for its events are visible in the same commit as the transaction, wallet and ledger rows

### Requirement: Event Set Per Outcome
The outbox MUST persist, for each outcome, exactly the events defined by the business rules: `WagerTransactionProcessed` for every applied transaction (including LOSS), `WagerTransactionRejected` for business rejections, `WalletBalanceChanged` only when the balance actually moved, and `WagerTransactionPendingReference` when a reference is missing. Conflicts and replays MUST NOT produce new events.

#### Scenario: Rejected BET emits rejected + no balance-changed
- **WHEN** a BET is rejected for insufficient funds
- **THEN** one `WagerTransactionRejected` event exists and no `WalletBalanceChanged` event exists

#### Scenario: LOSS emits processed only
- **WHEN** a LOSS is processed
- **THEN** one `WagerTransactionProcessed` event exists and no `WalletBalanceChanged` event exists (the balance did not move)

#### Scenario: Winning WIN emits processed + balance-changed
- **WHEN** a WIN is processed and the balance increases
- **THEN** both `WagerTransactionProcessed` and `WalletBalanceChanged` events exist for that transaction

#### Scenario: PENDING_REFERENCE emits pending event
- **WHEN** a REFUND's reference is missing
- **THEN** one `WagerTransactionPendingReference` event exists and no balance-affecting event exists

#### Scenario: Replay emits nothing new
- **WHEN** an identical submission is replayed
- **THEN** no new outbox row is created

### Requirement: Event Envelope
Every outbox payload MUST be the serialized `IntegrationEvent.toJSON()` envelope: `eventId`, `eventType`, `aggregateId`, `correlationId`, `causationId` (optional), `occurredAt` (ISO-8601), `version`, and `data`. `data` carries decimal-string `MoneyProps`, never live `Money` instances. `eventType` and `version` are defined on the concrete event class, not passed at the call site.

#### Scenario: Serialized envelope shape
- **WHEN** an outbox payload is read back
- **THEN** it contains the envelope fields above with `eventType` matching the concrete class and monetary values as decimal strings

### Requirement: Pending Status Until Published
Outbox rows start as `PENDING`. The publishing worker (F4) marks them `PUBLISHED` after a successful send. This change MUST NOT publish anything; rows remain `PENDING` after commit.

#### Scenario: Rows remain pending after processing
- **WHEN** a transaction completes and no publisher is running
- **THEN** its outbox rows have status `PENDING` and `published_at` is null

#### Scenario: No pre-commit publication
- **WHEN** a transaction is mid-flight
- **THEN** no outbox row for it is visible to any other connection (it exists only inside the uncommitted transaction)
