/**
 * Stable, machine-readable failure codes (README §7.2). Every business
 * rejection carries one; structural/programming errors raise exceptions
 * instead. `REFERENCE_NOT_FOUND` is only set by the F5 expiry worker.
 */
export const FailureCode = {
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  RollbackInsufficientFunds: 'ROLLBACK_INSUFFICIENT_FUNDS',
  WalletPlayerMismatch: 'WALLET_PLAYER_MISMATCH',
  CurrencyMismatch: 'CURRENCY_MISMATCH',
  ReferenceProviderMismatch: 'REFERENCE_PROVIDER_MISMATCH',
  ReferencePlayerMismatch: 'REFERENCE_PLAYER_MISMATCH',
  ReferenceWalletMismatch: 'REFERENCE_WALLET_MISMATCH',
  ReferenceCurrencyMismatch: 'REFERENCE_CURRENCY_MISMATCH',
  ReferenceRoundMismatch: 'REFERENCE_ROUND_MISMATCH',
  ReferenceMoneyMismatch: 'REFERENCE_MONEY_MISMATCH',
  ReferenceKindNotAllowed: 'REFERENCE_KIND_NOT_ALLOWED',
  DuplicateReversal: 'DUPLICATE_REVERSAL',
  ReferenceNotFound: 'REFERENCE_NOT_FOUND',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];
