import { Money } from './money.js';

export const LedgerDirection = {
  Debit: 'DEBIT',
  Credit: 'CREDIT',
} as const;
export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];

/** OPENING is internal; BET/WIN/LOSS/REFUND/ROLLBACK arrive with F2. */
export type WalletLedgerOperation = 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export interface CreateWalletLedgerEntryProps {
  id: string;
  walletId: string;
  /** Originating financial transaction (the internal OPENING transaction for
   * wallet creation; the WagerTransaction id once F2 lands). */
  transactionId: string;
  operation: WalletLedgerOperation;
  direction: LedgerDirection;
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface WalletLedgerEntryState extends Omit<CreateWalletLedgerEntryProps, 'createdAt'> {
  createdAt: Date;
}

/**
 * Append-only ledger entry. Structurally immutable: private constructor, all
 * readonly fields, no transition methods. `create` validates the arithmetic
 * (balanceBefore ± amount === balanceAfter); `rehydrate` rebuilds persisted
 * state without revalidating.
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly operation: WalletLedgerOperation,
    public readonly direction: LedgerDirection,
    public readonly amount: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(props: CreateWalletLedgerEntryProps): WalletLedgerEntry {
    if (props.amount.isZero() || props.amount.isNegative()) {
      throw new Error(`Ledger entry amount must be positive, got ${props.amount.amountString}`);
    }
    const currency = props.balanceBefore.currency;
    if (props.amount.currency !== currency || props.balanceAfter.currency !== currency) {
      throw new Error(
        `Ledger entry currency mismatch: before=${props.balanceBefore.currency}, amount=${props.amount.currency}, after=${props.balanceAfter.currency}`,
      );
    }
    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.operation,
      props.direction,
      props.amount,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt ?? new Date(),
    );
    if (!entry.isBalanced()) {
      throw new Error(
        `Ledger entry arithmetic is not balanced: ${entry.direction} ${entry.amount.amountString} cannot move ${entry.balanceBefore.amountString} to ${entry.balanceAfter.amountString}`,
      );
    }
    return entry;
  }

  static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.operation,
      state.direction,
      state.amount,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /** balanceBefore ± money === balanceAfter. */
  isBalanced(): boolean {
    const expected = this.direction === LedgerDirection.Credit
      ? this.balanceBefore.add(this.amount)
      : this.balanceBefore.subtract(this.amount);
    return this.balanceAfter.equals(expected);
  }

  isCredit(): boolean {
    return this.direction === LedgerDirection.Credit;
  }

  isDebit(): boolean {
    return this.direction === LedgerDirection.Debit;
  }
}
