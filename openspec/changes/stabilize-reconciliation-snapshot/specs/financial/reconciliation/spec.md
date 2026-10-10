# Spec Delta

## Purpose
Hardens the reconciliation capability against concurrency: the materialized wallet balance and the exact ledger sum must be observed in the same PostgreSQL snapshot, so a transaction committed between partial reads cannot produce a false divergence.

## MODIFIED Requirements

### Requirement: Balance Reconciliation
`POST /wallets/:walletId/reconciliation` MUST compare the persisted wallet balance with the exact arithmetic sum of the wallet's ledger entries (`CREDIT` positive, `DEBIT` negative) computed in the database with exact numeric semantics — no floating point. Both values MUST be observed in the same PostgreSQL consistent snapshot (single SQL statement, or an explicitly justified equivalent), so that a financial transaction committed between the two readings cannot produce a false divergence. The operation MUST NOT acquire locks and MUST NOT block financial processing of any wallet. The response MUST contain `storedBalance`, `calculatedBalance`, `difference`, `consistent` and `checkedEntries`. A missing wallet MUST return `404`. The operation MUST be read-only: it never writes to any table. A real divergence MUST be reported (`consistent: false`, non-zero `difference`) with a warn-level structured log event, and MUST NOT be corrected silently.

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

#### Scenario: Transaction committed between readings never produces a false divergence
- **WHEN** a financial transaction commits while reconciliation is being served (an uncommitted wallet mutation is visible to neither reading until commit; after commit it is visible to both)
- **THEN** every reconciliation response observes a single consistent snapshot — entirely before or entirely after the commit — and reports `consistent: true` for a wallet whose stored balance matches its ledger, never a mixed reading of pre-commit balance with post-commit ledger sum (or the reverse)

#### Scenario: Reconciliation under concurrent processing stays read-only
- **WHEN** reconciliation runs concurrently with wallet-processing transactions on the same wallet
- **THEN** wallet, wallet version and ledger rows are changed only by the processing transactions — reconciliation writes nothing and acquires no locks — and the final reconstructed balance invariant holds
