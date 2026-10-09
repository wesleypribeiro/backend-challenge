import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
  type CreateWalletLedgerEntryProps,
  type WalletLedgerOperation,
} from '../../../../src/domain/wallet/ledger-entry.js';

const creditProps = (overrides: Partial<CreateWalletLedgerEntryProps> = {}): CreateWalletLedgerEntryProps => ({
  id: 'e1',
  walletId: 'w1',
  transactionId: 't1',
  operation: 'OPENING',
  direction: LedgerDirection.Credit,
  amount: Money.from({ amount: '10.00', currency: 'BRL' }),
  balanceBefore: Money.zero('BRL'),
  balanceAfter: Money.from({ amount: '10.00', currency: 'BRL' }),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

test('create captures direction, origin transaction and balance snapshots', () => {
  const entry = WalletLedgerEntry.create(creditProps());
  expect(entry.id).toBe('e1');
  expect(entry.walletId).toBe('w1');
  expect(entry.transactionId).toBe('t1');
  expect(entry.operation).toBe('OPENING');
  expect(entry.direction).toBe('CREDIT');
  expect(entry.amount.amountString).toBe('10.00');
  expect(entry.balanceBefore.amountString).toBe('0.00');
  expect(entry.balanceAfter.amountString).toBe('10.00');
  expect(entry.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  expect(entry.isBalanced()).toBe(true);
  expect(entry.isCredit()).toBe(true);
  expect(entry.isDebit()).toBe(false);
});

test('create accepts a balanced debit entry', () => {
  const entry = WalletLedgerEntry.create(creditProps({
    operation: 'BET',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '25.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '15.00', currency: 'BRL' }),
  }));
  expect(entry.isDebit()).toBe(true);
  expect(entry.isBalanced()).toBe(true);
});

test('create rejects unbalanced arithmetic', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    balanceAfter: Money.from({ amount: '11.00', currency: 'BRL' }),
  }))).toThrow(/not balanced/);

  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'BET',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '25.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '16.00', currency: 'BRL' }),
  }))).toThrow(/not balanced/);
});

test('create rejects non-positive amounts', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    amount: Money.zero('BRL'),
    balanceAfter: Money.zero('BRL'),
  }))).toThrow(/must be positive/);

  expect(() => WalletLedgerEntry.create(creditProps({
    amount: Money.from({ amount: '-1.00', currency: 'BRL' }),
  }))).toThrow(/must be positive/);
});

test('create rejects mixed currencies across amount and balances', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    amount: Money.from({ amount: '10.00', currency: 'USD' }),
  }))).toThrow(/currency mismatch/i);
});

test('create rejects LOSS because it never produces a ledger entry', () => {
  expect(() => WalletLedgerEntry.create(creditProps({ operation: 'LOSS' })))
    .toThrow(/operation LOSS must not produce a ledger entry/);
  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'LOSS',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.zero('BRL'),
  }))).toThrow(/operation LOSS must not produce a ledger entry/);
});

test('create rejects invalid operation/direction combinations', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.zero('BRL'),
  }))).toThrow(/OPENING cannot be DEBIT/);

  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'BET',
    direction: LedgerDirection.Credit,
    balanceBefore: Money.zero('BRL'),
    balanceAfter: Money.from({ amount: '10.00', currency: 'BRL' }),
  }))).toThrow(/BET cannot be CREDIT/);

  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'WIN',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.zero('BRL'),
  }))).toThrow(/WIN cannot be DEBIT/);

  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'REFUND',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.zero('BRL'),
  }))).toThrow(/REFUND cannot be DEBIT/);
});

test('create rejects an OPENING entry that does not start from a zero balance', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    balanceBefore: Money.from({ amount: '5.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '15.00', currency: 'BRL' }),
  }))).toThrow(/OPENING requires a zero balance before, got 5.00/);
});

test('create accepts both balanced ROLLBACK directions for F2 reversals', () => {
  const credit = WalletLedgerEntry.create(creditProps({
    operation: 'ROLLBACK',
    direction: LedgerDirection.Credit,
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '20.00', currency: 'BRL' }),
  }));
  expect(credit.operation).toBe('ROLLBACK');
  expect(credit.isCredit()).toBe(true);
  expect(credit.isBalanced()).toBe(true);

  const debit = WalletLedgerEntry.create(creditProps({
    operation: 'ROLLBACK',
    direction: LedgerDirection.Debit,
    balanceBefore: Money.from({ amount: '15.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '5.00', currency: 'BRL' }),
  }));
  expect(debit.operation).toBe('ROLLBACK');
  expect(debit.isDebit()).toBe(true);
  expect(debit.isBalanced()).toBe(true);
});

test('create rejects operations outside the domain vocabulary', () => {
  expect(() => WalletLedgerEntry.create(creditProps({
    operation: 'TRANSFER' as WalletLedgerOperation,
  }))).toThrow(/operation is not recognized: TRANSFER/);
});

test('create accepts the remaining valid credit operations (WIN, REFUND)', () => {
  for (const operation of ['WIN', 'REFUND'] as const) {
    const entry = WalletLedgerEntry.create(creditProps({ operation }));
    expect(entry.operation).toBe(operation);
    expect(entry.isCredit()).toBe(true);
    expect(entry.isBalanced()).toBe(true);
  }
});

test('rehydrate restores persisted state without revalidating', () => {
  const createdAt = new Date('2026-03-01T12:00:00.000Z');
  const entry = WalletLedgerEntry.rehydrate({
    id: 'e7',
    walletId: 'w7',
    transactionId: 't7',
    operation: 'BET',
    direction: LedgerDirection.Debit,
    amount: Money.from({ amount: '5.00', currency: 'BRL' }),
    balanceBefore: Money.from({ amount: '10.00', currency: 'BRL' }),
    balanceAfter: Money.from({ amount: '5.00', currency: 'BRL' }),
    createdAt,
  });
  expect(entry.operation).toBe('BET');
  expect(entry.direction).toBe('DEBIT');
  expect(entry.createdAt).toBe(createdAt);
  expect(entry.isBalanced()).toBe(true);
});

test('entries are structurally immutable (frozen at runtime)', () => {
  const entry = WalletLedgerEntry.create(creditProps());
  expect(() => { (entry as { amount: Money }).amount = Money.zero('BRL'); }).toThrow(TypeError);
  expect(() => { (entry as { direction: string }).direction = 'DEBIT'; }).toThrow(TypeError);
  expect(entry.amount.amountString).toBe('10.00');
  expect(entry.direction).toBe('CREDIT');
});

test('money objects are frozen at runtime', () => {
  const money = Money.from({ amount: '10.00', currency: 'BRL' });
  expect(() => { (money as { currency: string }).currency = 'USD'; }).toThrow(TypeError);
  expect(Object.isFrozen(money)).toBe(true);
});
