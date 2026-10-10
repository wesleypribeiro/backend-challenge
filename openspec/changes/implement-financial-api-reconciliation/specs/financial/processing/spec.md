# Spec Delta

## Purpose
Tightens the structural identifier validation of financial submissions: values composed only of whitespace are invalid, and the provider namespace `internal` is reserved for internal operations (e.g. OPENING). Financial outcomes are unchanged.

## MODIFIED Requirements

### Requirement: Structural Identifier Validation
Every business identifier of a submission — `providerId`, `externalTransactionId`, `idempotencyKey`, `roundId`, `gameId`, `playerId`, `walletId` and the optional `referenceExternalTransactionId` — MUST be structurally valid: a string, non-empty, not composed solely of whitespace, within its field's size limit, and in UUID form for `playerId` and `walletId`. In addition, `providerId` MUST NOT equal the reserved literal `internal`, which belongs exclusively to internal operations (OPENING) and is never accepted from external providers. An invalid identifier is a malformed payload, not a business rejection: the use case MUST raise a structural error (carrying the offending field) before opening any SQL transaction, so a bad field can never produce a partial write or a persisted `REJECTED` row.

#### Scenario: Malformed walletId never reaches persistence
- **WHEN** a submission carries a `walletId` that is not a UUID
- **THEN** the use case raises a structural error naming `walletId`, and no transaction, ledger entry, outbox row or balance change is written

#### Scenario: Empty business field rejected structurally
- **WHEN** a submission carries an empty `providerId` (or any other required identifier)
- **THEN** the use case raises a structural error naming the field, with no database writes

#### Scenario: Whitespace-only identifier rejected structurally
- **WHEN** a submission carries `externalTransactionId: "   "` (or any other identifier whose trim is empty)
- **THEN** the use case raises a structural error naming the field, with no database writes

#### Scenario: Reserved internal provider rejected structurally
- **WHEN** a submission carries `providerId: "internal"`
- **THEN** the use case raises a structural error naming `providerId`, with no database writes

#### Scenario: Valid identifiers proceed to business rules
- **WHEN** a submission carries well-formed identifiers
- **THEN** processing continues to locking, idempotency and business validation unchanged
