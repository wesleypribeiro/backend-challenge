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
 * Directions each operation may produce (README §7):
 * - OPENING is an internal credit from a zero balance;
 * - BET debits; WIN and REFUND credit;
 * - LOSS never produces a ledger entry (it does not move the balance);
 * - ROLLBACK inverts the referenced transaction, so its direction is only
 *   known once F2 resolves the reference — both directions are valid here.
 */
const LEDGER_OPERATION_DIRECTIONS: Record<WalletLedgerOperation, readonly LedgerDirection[]> = {
  OPENING: [LedgerDirection.Credit],
  BET: [LedgerDirection.Debit],
  WIN: [LedgerDirection.Credit],
  LOSS: [],
  REFUND: [LedgerDirection.Credit],
  ROLLBACK: [LedgerDirection.Debit, LedgerDirection.Credit],
};

/**
 * Append-only ledger entry. Structurally immutable: private constructor, all
 * readonly fields, no transition methods. `create` validates the arithmetic
 * (balanceBefore ± amount === balanceAfter), the operation/direction matrix
 * (LOSS and invalid combinations are rejected; OPENING must credit from a
 * zero balance), and a single currency across amount and balances;
 * `rehydrate` rebuilds persisted state without revalidating.
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
    const allowedDirections: readonly LedgerDirection[] | undefined =
      LEDGER_OPERATION_DIRECTIONS[props.operation];
    if (!allowedDirections) {
      throw new Error(`Ledger entry operation is not recognized: ${String(props.operation)}`);
    }
    if (allowedDirections.length === 0) {
      throw new Error(`Ledger entry operation ${props.operation} must not produce a ledger entry`);
    }
    if (!allowedDirections.includes(props.direction)) {
      throw new Error(
        `Ledger entry operation/direction combination is invalid: ${props.operation} cannot be ${props.direction}`,
      );
    }
    if (props.operation === 'OPENING' && !props.balanceBefore.isZero()) {
      throw new Error(
        `Ledger entry OPENING requires a zero balance before, got ${props.balanceBefore.amountString}`,
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
