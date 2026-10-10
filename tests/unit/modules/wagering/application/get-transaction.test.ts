import { expect, test } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GetTransaction } from '../../../../../src/modules/wagering/application/get-transaction.js';
import { TransactionNotFoundError } from '../../../../../src/modules/wagering/application/errors.js';

const TX_ID = '66666666-6666-4666-8666-666666666666';

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    providerId: 'acme',
    externalTransactionId: 'ext-1',
    kind: 'BET',
    status: 'PROCESSED',
    moneyAmount: '25.00',
    moneyCurrency: 'EUR',
    playerId: '11111111-1111-4111-8111-111111111111',
    walletId: '22222222-2222-4222-8222-222222222222',
    roundId: 'r-1',
    gameId: 'g-1',
    referenceExternalTransactionId: undefined,
    referenceTransactionId: undefined,
    failureCode: undefined,
    resultBalance: '75.00',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    processedAt: new Date('2026-01-01T00:00:00.100Z'),
    ...overrides,
  };
}

function fakeEm(row: unknown) {
  return { findOne: async () => row } as unknown as EntityManager;
}

test('byId returns the full transaction view', async () => {
  const view = await new GetTransaction(fakeEm(transactionRow())).byId(TX_ID);
  expect(view.transactionId).toBe(TX_ID);
  expect(view.status).toBe('PROCESSED');
  expect(view.money).toEqual({ amount: '25.00', currency: 'EUR' });
  expect(view.resultBalance).toEqual({ amount: '75.00', currency: 'EUR' });
  expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
  expect(view.processedAt).toBe('2026-01-01T00:00:00.100Z');
  expect(view.failureCode).toBeNull();
});

test('byId raises TransactionNotFoundError for an unknown id', async () => {
  await expect(new GetTransaction(fakeEm(null)).byId(TX_ID))
    .rejects.toBeInstanceOf(TransactionNotFoundError);
});

test('byProviderIdentity returns the view and keeps nulls for absent references', async () => {
  const em = {
    findOne: async () => transactionRow({
      referenceExternalTransactionId: undefined,
      resultBalance: undefined,
      processedAt: undefined,
    }),
  } as unknown as EntityManager;
  const view = await new GetTransaction(em).byProviderIdentity('acme', 'ext-1');
  expect(view.providerId).toBe('acme');
  expect(view.externalTransactionId).toBe('ext-1');
  expect(view.referenceExternalTransactionId).toBeNull();
  expect(view.referenceTransactionId).toBeNull();
  expect(view.resultBalance).toBeNull();
  expect(view.processedAt).toBeNull();
});

test('byProviderIdentity raises TransactionNotFoundError for an unknown identity', async () => {
  await expect(new GetTransaction(fakeEm(null)).byProviderIdentity('acme', 'ext-404'))
    .rejects.toBeInstanceOf(TransactionNotFoundError);
});
