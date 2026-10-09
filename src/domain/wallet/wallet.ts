import { Money } from './money.js';

export type WalletLedgerOperation = 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export class WalletLedgerEntry {
  constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly operation: WalletLedgerOperation,
    public readonly amount: Money,
    public readonly createdAt: Date,
  ) {}
}

export class Wallet {
  private _balance: Money;
  private _version: number;

  constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    initialBalance: Money,
    version: number
  ) {
    if (initialBalance.currency !== currency) {
      throw new Error(`Wallet currency ${currency} mismatch with initial balance currency ${initialBalance.currency}`);
    }
    if (initialBalance.isNegative()) {
      throw new Error('Wallet balance cannot be negative');
    }
    this._balance = initialBalance;
    this._version = version;
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  static open(
    id: string,
    playerId: string,
    initialBalance: Money,
    ledgerEntryIdGenerator: () => string
  ): { wallet: Wallet; ledgerEntry?: WalletLedgerEntry } {
    const wallet = new Wallet(id, playerId, initialBalance.currency, initialBalance, 1);
    
    if (initialBalance.isZero()) {
      return { wallet };
    }

    const ledgerEntry = new WalletLedgerEntry(
      ledgerEntryIdGenerator(),
      id,
      'OPENING',
      initialBalance,
      new Date()
    );

    return { wallet, ledgerEntry };
  }
}
