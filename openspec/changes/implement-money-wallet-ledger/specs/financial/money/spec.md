# Spec Delta

## Purpose
Establishes the `Money` value object with exact decimal precision and strict constraints (ISO 4217, exact scale, no mixing currencies).

## ADDED Requirements

### Requirement: Exact Decimal Representation
The system MUST represent money using exact decimals up to two decimal places, rejecting floating point approximations, silent rounding, and scientific notation.

#### Scenario: Valid instantiation
- **WHEN** a Money object is instantiated with a valid string like "10.50" or "0"
- **THEN** it is created successfully with the exact value

#### Scenario: Excess precision rejected
- **WHEN** a Money object is instantiated with a value containing more than 2 decimal places (e.g., "10.555")
- **THEN** it is rejected without silent rounding

#### Scenario: Scientific notation rejected
- **WHEN** a Money object is instantiated with scientific notation (e.g., "1e2")
- **THEN** it is rejected

### Requirement: Currency Isolation
Money objects MUST belong to an ISO 4217 currency. Operations between different currencies are prohibited.

#### Scenario: Mixed currency operations
- **WHEN** attempting to add or subtract Money objects of different currencies
- **THEN** an error is thrown

### Requirement: Immutability and Limits
The Money object MUST be immutable. Operations like add or subtract return a new instance. Values MUST correctly handle amounts over Number.MAX_SAFE_INTEGER in cents.

#### Scenario: Immutability
- **WHEN** an arithmetic operation is performed on a Money object
- **THEN** the original object is unmodified and a new instance is returned
