import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import { Wallet } from '../../../../src/domain/wallet/wallet.js';

test('open derives the wallet currency from the initial balance money', () => {
  const eur = Money.from({ amount: '10.00', currency: 'EUR' });
  const { wallet } = Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: eur, idGenerator: () => 'x' });
  expect(wallet.currency).toBe('EUR');
  expect(wallet.balance.currency).toBe('EUR');
});

test('open rejects a negative initial balance at the entry contract', () => {
  const negative = Money.from({ amount: '-10.00', currency: 'USD' });
  expect(() => Wallet.open({ id: 'w1', playerId: 'p1', initialBalance: negative, idGenerator: () => 'x' }))
    .toThrow(/cannot be negative/);
});

test('open with zero balance creates version 1 and no ledger entry', () => {
  const zero = Money.zero('USD');
  let idCalls = 0;
  const result = Wallet.open({
    id: 'w1',
    playerId: 'p1',
    initialBalance: zero,
    idGenerator: () => { idCalls += 1; return `le${idCalls}`; },
  });

  expect(result.wallet.id).toBe('w1');
  expect(result.wallet.playerId).toBe('p1');
  expect(result.wallet.currency).toBe('USD');
  expect(result.wallet.balance.amountString).toBe('0.00');
  expect(result.wallet.version).toBe(1);
  expect(result.ledgerEntry).toBeUndefined();
  expect(idCalls).toBe(0);
});

test('open with positive balance creates version 1 and an OPENING CREDIT entry', () => {
  const initial = Money.from({ amount: '10.50', currency: 'USD' });
  let idCalls = 0;
  const result = Wallet.open({
    id: 'w1',
    playerId: 'p1',
    initialBalance: initial,
    idGenerator: () => { idCalls += 1; return `id-${idCalls}`; },
  });

  expect(result.wallet.balance.amountString).toBe('10.50');
  expect(result.wallet.version).toBe(1);
  expect(result.wallet.createdAt).toBeInstanceOf(Date);
  expect(result.wallet.updatedAt).toBe(result.wallet.createdAt);

  const entry = result.ledgerEntry!;
  expect(idCalls).toBe(2);
  expect(entry.id).toBe('id-1');
  expect(entry.transactionId).toBe('id-2');
  expect(entry.walletId).toBe('w1');
  expect(entry.operation).toBe('OPENING');
  expect(entry.direction).toBe('CREDIT');
  expect(entry.isCredit()).toBe(true);
  expect(entry.amount.amountString).toBe('10.50');
  expect(entry.balanceBefore.amountString).toBe('0.00');
  expect(entry.balanceAfter.amountString).toBe('10.50');
  expect(entry.isBalanced()).toBe(true);
  expect(entry.createdAt).toBe(result.wallet.createdAt);
});

test('rehydrate restores persisted state without revalidating transitions', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-02-01T00:00:00.000Z');
  const wallet = Wallet.rehydrate({
    id: 'w9',
    playerId: 'p9',
    currency: 'BRL',
    balance: Money.from({ amount: '42.00', currency: 'BRL' }),
    version: 7,
    createdAt,
    updatedAt,
  });

  expect(wallet.id).toBe('w9');
  expect(wallet.playerId).toBe('p9');
  expect(wallet.currency).toBe('BRL');
  expect(wallet.balance.amountString).toBe('42.00');
  expect(wallet.version).toBe(7);
  expect(wallet.createdAt).toBe(createdAt);
  expect(wallet.updatedAt).toBe(updatedAt);
});
