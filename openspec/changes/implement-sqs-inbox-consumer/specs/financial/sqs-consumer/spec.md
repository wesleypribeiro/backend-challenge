# Spec Delta

## Purpose
Defines the AWS SQS consumer running in the worker: message envelope validation, single-transaction processing through the existing use case, acknowledgment only after commit, retry/DLQ policy, per-wallet ordering as an optimization, per-instance concurrency, graceful shutdown and consumer observability.

## ADDED Requirements

### Requirement: Envelope Validation
The consumer MUST accept only messages whose envelope is a JSON object with `messageId`, `type` equal to `WagerTransactionRequested`, an ISO-8601 `occurredAt`, and a `data` payload structurally equivalent to the HTTP submission body (including `idempotencyKey`), validated before any SQL transaction opens. Structurally invalid messages MUST produce no writes and MUST NOT be acknowledged, routing to the DLQ through the retry policy.

#### Scenario: Valid envelope is processed through the shared use case
- **WHEN** a well-formed `WagerTransactionRequested` message arrives
- **THEN** the consumer processes it through `ProcessWagerTransaction` (same business rules as HTTP) and the transaction, wallet, ledger and outbox rows are persisted

#### Scenario: Malformed envelope routes to DLQ
- **WHEN** a message has invalid JSON, a wrong `type`, or a structurally invalid `data`
- **THEN** nothing is written, the message is not acknowledged, and it reaches the DLQ after the retry policy is exhausted

### Requirement: Atomic Processing and Post-Commit Acknowledgment
Inbox record, financial processing, wallet update, ledger entry and outbox events MUST participate in a single SQL transaction. The consumer MUST acknowledge (delete) the message only after that transaction commits. A failure at any point MUST roll back everything and MUST NOT acknowledge.

#### Scenario: Ack only after commit
- **WHEN** a message is processed successfully
- **THEN** the message is deleted from the queue only after the SQL commit is visible

#### Scenario: Failure before commit leaves the message deliverable
- **WHEN** processing fails before commit
- **THEN** no partial state exists and the message is redelivered after the visibility timeout

#### Scenario: Failure after commit, before ack, does not duplicate effects
- **WHEN** the commit succeeds but the acknowledgment fails or the process dies before deleting the message
- **THEN** redelivery is recognized as a duplicate via the inbox and acknowledged without duplicating credits, debits, ledger entries or events

### Requirement: Retry and Dead-Letter Policy
Transient errors (database or SQS unavailability, timeouts) MUST NOT acknowledge the message; redelivery after the visibility timeout is the retry mechanism. Permanent errors (identity conflict, idempotency conflict, structurally invalid payload, unknown wallet) MUST NOT acknowledge and MUST route to the DLQ via the queue's redrive policy (`maxReceiveCount`), without silent loss. Business rejections (for example `INSUFFICIENT_FUNDS`) and pending references MUST be persisted by the use case and acknowledged as terminal. SQS FIFO deduplication MUST NOT be relied upon for correctness.

#### Scenario: Transient failure retries safely
- **WHEN** a transient error occurs during processing
- **THEN** the message is not acknowledged, is redelivered after the visibility timeout, and exactly one financial effect exists after successful retry

#### Scenario: Poison message reaches the DLQ
- **WHEN** a permanently failing message exhausts the receive count
- **THEN** the queue's redrive policy moves it to the DLQ with its original body and no financial effect was written

#### Scenario: Business rejection is terminal and auditable
- **WHEN** the use case rejects a transaction by business rule
- **THEN** the `REJECTED` transaction and its outbox event are committed, the inbox row is marked processed, and the message is acknowledged

### Requirement: Per-Wallet Ordering and Per-Instance Concurrency
The consumer MUST receive with long polling and process messages with bounded per-instance concurrency. `MessageGroupId` MUST be the walletId so FIFO ordering per wallet is preserved as an optimization; financial consistency MUST remain guaranteed by database locking, never by the broker. Messages of distinct wallets MUST be processable concurrently; the same wallet's operations MUST remain serialized and consistent under multi-instance competition.

#### Scenario: Same wallet processed in order across instances
- **WHEN** messages for one wallet are processed by competing consumers
- **THEN** the final balance and ledger reconstruction remain consistent regardless of which instance applied each message

#### Scenario: Distinct wallets proceed independently
- **WHEN** messages for different wallets arrive concurrently
- **THEN** they are processed in parallel without blocking each other

### Requirement: Graceful Shutdown
On SIGTERM/SIGINT the worker MUST stop receiving new messages, allow in-flight processing to finish within the configured shutdown deadline, and MUST NOT acknowledge messages whose SQL transaction did not complete. Resources MUST close without partially confirmed financial operations.

#### Scenario: Shutdown during processing
- **WHEN** a shutdown signal arrives while a message is being processed
- **THEN** the worker stops polling, the in-flight transaction either commits and is acknowledged or rolls back and is not acknowledged, and the process exits within the deadline

#### Scenario: Shutdown never confirms uncommitted work
- **WHEN** the shutdown deadline expires before a transaction commits
- **THEN** the message is not acknowledged and is redelivered to a live consumer

### Requirement: Consumer Observability
The consumer MUST emit structured log events including `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId` and the receive count, covering receipt, success, duplicates, identity conflicts, business rejections, transient failures, permanent failures and shutdown. Credentials, complete financial payloads and sensitive data MUST NOT be logged. Aggregated metrics are out of scope for this capability and are deferred to a future change.

#### Scenario: Processed message is fully traceable
- **WHEN** a message is processed
- **THEN** a structured event identifies the message, the transaction, the wallet, the provider and the outcome without logging the full payload

#### Scenario: Duplicate detection is observable
- **WHEN** a duplicate delivery is acknowledged without processing
- **THEN** a structured duplicate event names the message and the receive count
