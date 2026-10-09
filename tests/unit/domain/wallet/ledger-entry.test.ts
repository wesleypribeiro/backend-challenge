import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
  type CreateWalletLedgerEntryProps,
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
