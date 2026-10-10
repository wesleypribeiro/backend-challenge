# Spec Delta

## Purpose
Defines the reconciliation capability: comparing the materialized wallet balance against the exact sum of its ledger entries, reporting divergences without ever correcting them.

## ADDED Requirements

### Requirement: Balance Reconciliation
`POST /wallets/:walletId/reconciliation` MUST compare the persisted wallet balance with the exact arithmetic sum of the wallet's ledger entries (`CREDIT` positive, `DEBIT` negative) computed in the database with exact numeric semantics — no floating point. The response MUST contain `storedBalance`, `calculatedBalance`, `difference`, `consistent` and `checkedEntries`. A missing wallet MUST return `404`. The operation MUST be read-only: it never writes to any table.

#### Scenario: Consistent wallet
- **WHEN** the wallet balance equals the ledger sum
- **THEN** the response is `200` with `difference` of zero, `consistent: true` and the total entry count

#### Scenario: Divergent wallet is reported, not corrected
- **WHEN** a test-seeded ledger sum differs from the stored balance
- **THEN** the response is `200` with `consistent: false`, the non-zero `difference`, a warn-level structured log event naming the wallet, and the stored balance and ledger are unchanged

#### Scenario: Empty ledger reconciles to zero
- **WHEN** the wallet exists with no ledger entries (possible only via direct seeding; opening with zero balance writes none)
- **THEN** `calculatedBalance` is zero and `consistent` holds against the stored balance

#### Scenario: Exactness across many entries
- **WHEN** the ledger holds a sequence of credits and debits whose exact sum equals the stored balance at two decimal places
- **THEN** `difference` is zero and `consistent` is true (sum computed as NUMERIC in SQL)
