import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import { Wallet } from '../../../../src/domain/wallet/wallet.js';

test('cannot create wallet with mismatching initial balance currency', () => {
  const m1 = new Money('10.00', 'EUR');
  expect(() => new Wallet('w1', 'p1', 'USD', m1, 1)).toThrow(/Wallet currency USD mismatch/);
});

test('cannot create wallet with negative initial balance', () => {
  const m1 = new Money('-10.00', 'USD');
  expect(() => new Wallet('w1', 'p1', 'USD', m1, 1)).toThrow(/Wallet balance cannot be negative/);
});

test('Wallet.open creates wallet with version 1 and no ledger entry for zero balance', () => {
  const m1 = new Money('0.00', 'USD');
  let idGenCalled = false;
  const result = Wallet.open('w1', 'p1', m1, () => {
    idGenCalled = true;
    return 'le1';
  });

  expect(result.wallet.id).toBe('w1');
  expect(result.wallet.playerId).toBe('p1');
  expect(result.wallet.currency).toBe('USD');
  expect(result.wallet.balance.amountString).toBe('0.00');
  expect(result.wallet.version).toBe(1);
  expect(result.ledgerEntry).toBeUndefined();
  expect(idGenCalled).toBe(false);
});

test('Wallet.open creates wallet and OPENING ledger entry for positive balance', () => {
  const m1 = new Money('10.50', 'USD');
  const result = Wallet.open('w1', 'p1', m1, () => 'le1');

  expect(result.wallet.id).toBe('w1');
  expect(result.wallet.balance.amountString).toBe('10.50');
  expect(result.wallet.version).toBe(1);

  expect(result.ledgerEntry).toBeDefined();
  expect(result.ledgerEntry?.id).toBe('le1');
  expect(result.ledgerEntry?.walletId).toBe('w1');
  expect(result.ledgerEntry?.operation).toBe('OPENING');
  expect(result.ledgerEntry?.amount.amountString).toBe('10.50');
  expect(result.ledgerEntry?.amount.currency).toBe('USD');
});
