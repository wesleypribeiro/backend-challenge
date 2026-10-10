import { describe, expect, test } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { OpenWallet } from '../../../../../src/modules/wallet/application/open-wallet.js';
import {
  InvalidWalletInputError,
  WalletAlreadyExistsError,
} from '../../../../../src/modules/wallet/application/errors.js';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

interface FakeEmOptions {
  flushError?: unknown;
}

function fakeEm(options: FakeEmOptions = {}) {
  const created: unknown[] = [];
  const em = {
    create: (_schema: unknown, data: unknown) => { created.push(data); return data; },
    flush: async () => { if (options.flushError) throw options.flushError; },
  };
  return { em: em as unknown as EntityManager, created };
}

test('execute opens a wallet with deterministic ids and returns the domain view', async () => {
  const ids = ['wallet-1', 'le-1', 'tx-1', 'evt-1', 'evt-2'];
  let index = 0;
  const { em, created } = fakeEm();
  const result = await new OpenWallet(em, { idGenerator: () => ids[index++]! }).execute({
    playerId: PLAYER_ID,
    initialBalance: { amount: '25.00', currency: 'EUR' },
  });

  expect(result.id).toBe('wallet-1');
  expect(result.playerId).toBe(PLAYER_ID);
  expect(result.balance).toEqual({ amount: '25.00', currency: 'EUR' });
  expect(result.version).toBe(1);
  // wallet, OPENING ledger entry, internal OPENING transaction, 2 outbox events
  expect(created.length).toBe(5);
});

test('execute rejects a non-UUID playerId before any write', async () => {
  const { em, created } = fakeEm();
  await expect(new OpenWallet(em).execute({
    playerId: 'not-a-uuid',
    initialBalance: { amount: '1.00', currency: 'EUR' },
  })).rejects.toBeInstanceOf(InvalidWalletInputError);
  expect(created.length).toBe(0);
});

test('execute rejects an invalid money format before any write', async () => {
  const { em, created } = fakeEm();
  await expect(new OpenWallet(em).execute({
    playerId: PLAYER_ID,
    initialBalance: { amount: '10.005', currency: 'EUR' },
  })).rejects.toBeInstanceOf(InvalidWalletInputError);
  expect(created.length).toBe(0);
});

test('execute rejects a negative initial balance before any write', async () => {
  const { em, created } = fakeEm();
  await expect(new OpenWallet(em).execute({
    playerId: PLAYER_ID,
    initialBalance: { amount: '-1.00', currency: 'EUR' },
  })).rejects.toBeInstanceOf(InvalidWalletInputError);
  expect(created.length).toBe(0);
});

test('execute maps a unique (playerId, currency) violation to WalletAlreadyExistsError', async () => {
  const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
  const { em } = fakeEm({ flushError: uniqueViolation });
  await expect(new OpenWallet(em).execute({
    playerId: PLAYER_ID,
    initialBalance: { amount: '1.00', currency: 'EUR' },
  })).rejects.toBeInstanceOf(WalletAlreadyExistsError);
});

test('execute rethrows unexpected persistence errors unchanged', async () => {
  const failure = new Error('connection reset');
  const { em } = fakeEm({ flushError: failure });
  await expect(new OpenWallet(em).execute({
    playerId: PLAYER_ID,
    initialBalance: { amount: '1.00', currency: 'EUR' },
  })).rejects.toBe(failure);
});

describe('zero opening balance', () => {
  test('execute opens a zero-balance wallet without a ledger entry', async () => {
    const ids = ['wallet-1'];
    let index = 0;
    const { em, created } = fakeEm();
    const result = await new OpenWallet(em, { idGenerator: () => ids[index++]! }).execute({
      playerId: PLAYER_ID,
      initialBalance: { amount: '0.00', currency: 'USD' },
    });

    expect(result.balance).toEqual({ amount: '0.00', currency: 'USD' });
    // only the wallet row: no OPENING entry, transaction or outbox events
    expect(created.length).toBe(1);
  });
});
