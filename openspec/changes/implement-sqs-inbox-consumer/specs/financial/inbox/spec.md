# Spec Delta

## Purpose
Defines the persistent inbox used by the SQS consumer: message identity per consumer, payload-hash conflict detection, and participation of the inbox record in the same SQL transaction as the financial processing.

## ADDED Requirements

### Requirement: Inbox Persistence
The system MUST persist received messages in `wagering.inbox_message` with `messageId`, `consumerName`, `payloadHash`, `receivedAt` and `processedAt`, and MUST enforce uniqueness of `(consumerName, messageId)` with a database constraint — never with in-memory state. Protection MUST hold across independent processes and process restarts.

#### Scenario: Message recorded atomically with its effects
- **WHEN** a valid message is processed successfully
- **THEN** the inbox row, the transaction/ledger/wallet effects and the outbox events become visible in the same commit

#### Scenario: Uniqueness enforced by the database
- **WHEN** two concurrent deliveries of the same `(consumerName, messageId)` race on the inbox insert
- **THEN** the database serializes them on the unique constraint; the loser's whole transaction rolls back and no financial effect is duplicated

#### Scenario: No partial inbox record after failure
- **WHEN** processing fails after the inbox insert but before commit
- **THEN** no inbox row is visible and the message is eligible for redelivery

### Requirement: Duplicate and Identity-Conflict Recognition
A message MUST be recognized as already processed when an inbox row for `(consumerName, messageId)` exists with a matching payload hash; the consumer MUST acknowledge it without reprocessing. When the same identity exists with a divergent payload hash, the system MUST treat it as a permanent identity conflict: no financial effect, no acknowledgment, and the message MUST eventually reach the DLQ through the queue's redrive policy. A message still being processed by another worker MUST NOT be visible as processed; the competing insert resolves by commit or rollback of the in-flight transaction.

#### Scenario: Redelivery of a processed message
- **WHEN** a message whose inbox row is committed is delivered again
- **THEN** the consumer acknowledges it without creating new transactions, ledger entries or events

#### Scenario: Identity conflict with divergent payload
- **WHEN** a message arrives whose `(consumerName, messageId)` exists with a different payload hash
- **THEN** no financial effect is written, the message is not acknowledged, and it reaches the DLQ after the retry policy is exhausted

#### Scenario: Concurrent duplicate resolves via the unique index
- **WHEN** the same messageId is being processed by worker A while worker B receives it
- **THEN** B's insert waits on the uncommitted unique entry; after A commits, B observes the processed row and acknowledges; after A rolls back, B processes the message normally
