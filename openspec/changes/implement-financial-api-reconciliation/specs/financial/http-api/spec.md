# Spec Delta

## Purpose
Defines the public HTTP surface over the financial domain: wallet lifecycle, transaction submission with mandatory idempotency key, queries, ledger pagination, reconciliation reporting, status mapping and error contract.

## ADDED Requirements

### Requirement: Wallet Creation
`POST /wallets` MUST create a wallet for a `playerId` (UUID) with an `initialBalance` (`MoneyProps`). A positive initial balance MUST persist the internal `OPENING` transaction, its ledger entry and the outbox events in the same SQL transaction (F2 guarantee). A duplicate `(playerId, currency)` MUST fail as a conflict, not as a server error.

#### Scenario: Create wallet with positive initial balance
- **WHEN** `POST /wallets` arrives with a valid UUID playerId and `initialBalance` `{amount: "1000.00", currency: "BRL"}`
- **THEN** the response is `201` with `{id, playerId, balance, version}` where balance equals the initial amount and version is 1

#### Scenario: Create duplicate wallet is a conflict
- **WHEN** a second `POST /wallets` arrives for the same playerId and currency
- **THEN** the response is `409` and no new rows are written

#### Scenario: Invalid create payload is rejected structurally
- **WHEN** `POST /wallets` carries a non-UUID playerId, a non-ISO-4217 currency, a malformed amount or a negative initial balance
- **THEN** the response is `400` naming the offending field and no wallet is created

### Requirement: Wallet and Transaction Queries
`GET /wallets/:walletId`, `GET /wagering/transactions/:transactionId` and `GET /providers/:providerId/wagering/transactions/:externalTransactionId` MUST return the stored state or `404` when the resource does not exist. Path identifiers that are structurally invalid (non-UUID where applicable, empty segments) MUST return `400` before any lookup.

#### Scenario: Existing wallet is returned
- **WHEN** `GET /wallets/:walletId` is requested for a known wallet
- **THEN** the response is `200` with `{id, playerId, balance, version}`

#### Scenario: Unknown wallet is not found
- **WHEN** `GET /wallets/:walletId` is requested for a well-formed but unknown UUID
- **THEN** the response is `404`

#### Scenario: Transaction queried by internal id
- **WHEN** `GET /wagering/transactions/:transactionId` is requested for a known transaction
- **THEN** the response is `200` with the full transaction view (identifiers, kind, status, money, failureCode when rejected, reference fields, resultBalance when applied, timestamps)

#### Scenario: Transaction queried by provider identity
- **WHEN** `GET /providers/:providerId/wagering/transactions/:externalTransactionId` is requested for a known pair
- **THEN** the response is `200` with the same transaction view; an unknown pair returns `404`

### Requirement: Transaction Submission
`POST /wagering/transactions` MUST require the `Idempotency-Key` header (missing, empty or whitespace-only → `400`), MUST reject `providerId` equal to `internal` (reserved for internal operations), and MUST delegate to the single processing use case (`ProcessWagerTransaction`). The body MUST NOT carry an idempotency key — the header is the source of truth.

#### Scenario: Missing idempotency key
- **WHEN** `POST /wagering/transactions` arrives without the `Idempotency-Key` header
- **THEN** the response is `400` and nothing is persisted

#### Scenario: Reserved provider id
- **WHEN** the body carries `providerId: "internal"`
- **THEN** the response is `400` naming `providerId` and nothing is persisted

#### Scenario: Processed transaction
- **WHEN** a valid BET is processed successfully
- **THEN** the response is `200` with `{transactionId, status: "PROCESSED", balance, idempotentReplay: false}`

#### Scenario: Business rejection
- **WHEN** a BET is rejected for insufficient funds
- **THEN** the response is `422` with `{transactionId, status: "REJECTED", failureCode: "INSUFFICIENT_FUNDS", idempotentReplay: false}` and the balance is unchanged

#### Scenario: Pending reference
- **WHEN** a REFUND arrives before its BET
- **THEN** the response is `202` with `{transactionId, status: "PENDING_REFERENCE", idempotentReplay: false}`

#### Scenario: Idempotent replay preserves the original result
- **WHEN** the identical submission (same key, same payload) arrives again after later movements changed the wallet balance
- **THEN** the response is `200` with `idempotentReplay: true` and the balance observed in the original execution, not the current one

#### Scenario: Divergent payload under the same key
- **WHEN** the same idempotency key arrives with a different business payload
- **THEN** the response is `409` and no new transaction, ledger entry or event is written

### Requirement: Ledger Pagination
`GET /wallets/:walletId/ledger` MUST return ledger entries ordered stably by insertion order using an opaque cursor over `(created_at, id)`. `limit` MUST default to 50 and accept 1..100; anything else is `400`. A malformed cursor is `400`. The response carries `entries` and `nextCursor` (null on the last page).

#### Scenario: First page without cursor
- **WHEN** the endpoint is called without a cursor for a wallet with more entries than the limit
- **THEN** the response is `200` with up to `limit` entries in insertion order and a non-null `nextCursor`

#### Scenario: Following the cursor
- **WHEN** the next page is requested with the returned cursor
- **THEN** entries continue strictly after the last entry of the previous page with no duplicates and no gaps, even when two entries share the same `created_at`

#### Scenario: Invalid cursor or limit
- **WHEN** the cursor is not a valid opaque token or `limit` is 0, 101 or non-numeric
- **THEN** the response is `400`

### Requirement: HTTP Error Contract
Every error response MUST carry a structured body `{statusCode, error, code, message, field?}` with a stable machine-readable `code`. Infrastructure failures MUST be distinguishable from payload and business errors: transient failures return `503`, unmapped errors return a generic `500`. Responses MUST NOT expose stack traces, SQL, credentials or other sensitive data.

#### Scenario: Structured payload error
- **WHEN** any endpoint receives an invalid payload
- **THEN** the body is `400` with `code: "INVALID_PAYLOAD"` and the offending `field`

#### Scenario: Transient infrastructure failure
- **WHEN** the database is unreachable during a request
- **THEN** the response is `503` with `code: "SERVICE_UNAVAILABLE"` and a retryable semantics

#### Scenario: Unexpected error is generic
- **WHEN** an unmapped error occurs
- **THEN** the response is `500` with a generic body, the detail is logged server-side only

### Requirement: Public Health and Authentication Decision
`GET /health/live` and `GET /health/ready` MUST remain public (no authentication). This change MUST NOT implement authentication; the decision and the intended design (external OIDC IdP, no-op guard as the extension point) MUST be documented, and the code MUST carry an explicit no-op guard on the financial controllers so a real guard can replace it without touching handlers.

#### Scenario: Health stays open
- **WHEN** `/health/live` and `/health/ready` are called without credentials
- **THEN** they respond with their existing payloads

#### Scenario: Extension point present
- **WHEN** the financial controllers are inspected
- **THEN** they are decorated with a no-op auth guard documented as the swap point for an OIDC implementation
