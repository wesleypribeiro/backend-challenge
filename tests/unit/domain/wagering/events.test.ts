import { expect, test } from 'bun:test';
import { LedgerDirection } from '../../../../src/domain/wallet/ledger-entry.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../../../src/domain/wagering/events.js';
import { WagerTransactionKind } from '../../../../src/domain/wagering/wager-transaction.js';
import { FailureCode } from '../../../../src/domain/wagering/failure-code.js';

const ctx = { correlationId: 'corr-1', causationId: 'cause-1' };
const money = { amount: '25.00', currency: 'BRL' };

test('WagerTransactionProcessed envelope carries the documented shape', () => {
  const event = WagerTransactionProcessed.from({
    eventId: 'e1',
    aggregateId: 'tx-1',
    ctx,
    transactionId: 'tx-1',
    walletId: 'w1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    kind: WagerTransactionKind.Bet,
    money,
    referenceTransactionId: undefined,
    resultBalance: { amount: '75.00', currency: 'BRL' },
  });
  const json = event.toJSON();
  expect(json.eventType).toBe('WagerTransactionProcessed');
  expect(json.version).toBe(1);
  expect(json.eventId).toBe('e1');
  expect(json.aggregateId).toBe('tx-1');
  expect(json.correlationId).toBe('corr-1');
  expect(json.causationId).toBe('cause-1');
  expect(json.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(json.data.money).toEqual(money);
  expect(json.data.resultBalance).toEqual({ amount: '75.00', currency: 'BRL' });
  expect(typeof json.data.resultBalance.amount).toBe('string');
});

test('WagerTransactionRejected carries the failureCode', () => {
  const event = WagerTransactionRejected.from({
    eventId: 'e2',
    aggregateId: 'tx-2',
    ctx,
    transactionId: 'tx-2',
    walletId: 'w1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-2',
    kind: WagerTransactionKind.Bet,
    money,
    failureCode: FailureCode.InsufficientFunds,
  });
  expect(event.toJSON().data.failureCode).toBe('INSUFFICIENT_FUNDS');
  expect(event.eventType).toBe('WagerTransactionRejected');
});

test('WalletBalanceChanged carries before/after and version', () => {
  const event = WalletBalanceChanged.from({
    eventId: 'e3',
    aggregateId: 'w1',
    ctx,
    walletId: 'w1',
    transactionId: 'tx-1',
    direction: LedgerDirection.Debit,
    money,
    balanceBefore: { amount: '100.00', currency: 'BRL' },
    balanceAfter: { amount: '75.00', currency: 'BRL' },
    walletVersion: 2,
  });
  const json = event.toJSON();
  expect(json.eventType).toBe('WalletBalanceChanged');
  expect(json.data.direction).toBe('DEBIT');
  expect(json.data.walletVersion).toBe(2);
  expect(json.data.balanceAfter).toEqual({ amount: '75.00', currency: 'BRL' });
});

test('WagerTransactionPendingReference carries the missing reference external id', () => {
  const event = WagerTransactionPendingReference.from({
    eventId: 'e4',
    aggregateId: 'tx-4',
    ctx,
    transactionId: 'tx-4',
    walletId: 'w1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-4',
    kind: WagerTransactionKind.Refund,
    money,
    referenceExternalTransactionId: 'ext-9',
  });
  expect(event.toJSON().data.referenceExternalTransactionId).toBe('ext-9');
  expect(event.eventType).toBe('WagerTransactionPendingReference');
});

test('envelope omitting causationId leaves it out of the JSON', () => {
  const event = WagerTransactionProcessed.from({
    eventId: 'e5',
    aggregateId: 'tx-5',
    ctx: { correlationId: 'corr-2' },
    transactionId: 'tx-5',
    walletId: 'w1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-5',
    kind: WagerTransactionKind.Loss,
    money,
    referenceTransactionId: undefined,
    resultBalance: { amount: '75.00', currency: 'BRL' },
  });
  expect(event.toJSON().causationId).toBeUndefined();
});

test('event instances are frozen', () => {
  const event = WagerTransactionProcessed.from({
    eventId: 'e6',
    aggregateId: 'tx-6',
    ctx,
    transactionId: 'tx-6',
    walletId: 'w1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-6',
    kind: WagerTransactionKind.Bet,
    money,
    referenceTransactionId: undefined,
    resultBalance: money,
  });
  expect(Object.isFrozen(event)).toBe(true);
  expect(Object.isFrozen(event.data)).toBe(true);
});
