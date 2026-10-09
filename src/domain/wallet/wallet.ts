import { Money } from './money.js';
import { LedgerDirection, WalletLedgerEntry } from './ledger-entry.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Wallet aggregate root. Balance is always non-negative and every balance
 * change must have a matching ledger entry (atomic at the persistence layer).
 * `version` starts at 1 and increments only when the balance actually changes
 * (movement methods arrive with F2; opening creates the wallet at version 1).
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    idGenerator: () => string;
  }): { wallet: Wallet; ledgerEntry?: WalletLedgerEntry } {
    const { id, playerId, initialBalance, idGenerator } = props;
    if (initialBalance.isNegative()) {
      throw new Error('Wallet opening balance cannot be negative');
    }
    const now = new Date();
    const wallet = new Wallet(id, playerId, initialBalance.currency, initialBalance, 1, now, now);
    if (initialBalance.isZero()) {
      return { wallet };
    }
    const ledgerEntry = WalletLedgerEntry.create({
      id: idGenerator(),
      walletId: id,
      transactionId: idGenerator(),
      operation: 'OPENING',
      direction: LedgerDirection.Credit,
      amount: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt: now,
    });
    return { wallet, ledgerEntry };
  }

  /** Reconstruction from persistence — does not revalidate transitions. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debit the balance (BET, ROLLBACK-of-credit). Currency must match and the
   * result must stay non-negative — the use case checks availability first and
   * rejects with INSUFFICIENT_FUNDS; this guard is a structural backstop.
   * Increments the version: the domain owns version transitions (D7).
   */
  debit(money: Money): void {
    this.assertMovementCurrency(money);
    const next = this._balance.subtract(money);
    if (next.isNegative()) {
      throw new Error(
        `Wallet debit would make the balance negative: ${this._balance.amountString} - ${money.amountString}`,
      );
    }
    this.applyMovement(next);
  }

  /** Credit the balance (WIN, REFUND, ROLLBACK-of-debit). Increments version. */
  credit(money: Money): void {
    this.assertMovementCurrency(money);
    this.applyMovement(this._balance.add(money));
  }

  private assertMovementCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new Error(`Wallet currency mismatch: wallet=${this.currency}, movement=${money.currency}`);
    }
    if (!money.isPositive()) {
      throw new Error(`Wallet movement amount must be positive, got ${money.amountString}`);
    }
  }

  private applyMovement(next: Money): void {
    this._balance = next;
    this._version += 1;
    this._updatedAt = new Date();
  }
}
