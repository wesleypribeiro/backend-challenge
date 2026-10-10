/** Application errors of the wallet module, mapped to HTTP by the filter. */

export class WalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} not found`);
    this.name = 'WalletNotFoundError';
  }
}

/** Unique (playerId, currency) violation on wallet creation — HTTP 409. */
export class WalletAlreadyExistsError extends Error {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`A ${currency} wallet already exists for player ${playerId}`);
    this.name = 'WalletAlreadyExistsError';
  }
}

/** Structural problem in an opening input — HTTP 400 with the field name. */
export class InvalidWalletInputError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidWalletInputError';
  }
}
