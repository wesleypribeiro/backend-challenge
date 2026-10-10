import { expect, test } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ReconcileWallet } from '../../../../../src/modules/wallet/application/reconcile-wallet.js';
import { WalletNotFoundError } from '../../../../../src/modules/wallet/application/errors.js';
import { JsonLogger } from '../../../../../src/platform/logging/json-logger.js';

const WALLET_ID = '22222222-2222-4222-8222-222222222222';

interface FakeWorld {
  em: EntityManager;
  logger: JsonLogger;
  lines: string[];
}

/**
 * The use case issues a single QueryBuilder call (wallet LEFT JOIN ledger,
 * GROUP BY wallet PK) — the fake mirrors that one chain; an empty row array
 * represents an unknown wallet.
 */
function fakeWorld(snapshotRow: unknown): FakeWorld {
  const lines: string[] = [];
  const sink = (line: string) => { lines.push(line); };
  const queryBuilder = {
    select: () => queryBuilder,
    leftJoin: () => queryBuilder,
    where: () => queryBuilder,
    groupBy: () => queryBuilder,
    execute: async () => (snapshotRow === null ? [] : [snapshotRow]),
  };
  const em = {
    createQueryBuilder: () => queryBuilder,
  } as unknown as EntityManager;
  return { em, logger: new JsonLogger('api', sink), lines };
}

test('execute reports consistency when stored equals the exact ledger sum', async () => {
  const world = fakeWorld({ balance: '40.00', currency: 'EUR', count: 3, calculated: '40.00' });
  const result = await new ReconcileWallet(world.em, world.logger).execute(WALLET_ID);

  expect(result.consistent).toBe(true);
  expect(result.difference).toEqual({ amount: '0.00', currency: 'EUR' });
  expect(result.checkedEntries).toBe(3);
  expect(world.lines.length).toBe(0); // no divergence logged
});

test('execute reports divergence with exact amounts and logs at warn level', async () => {
  const world = fakeWorld({ balance: '50.00', currency: 'EUR', count: 2, calculated: '40.00' });
  const result = await new ReconcileWallet(world.em, world.logger).execute(WALLET_ID);

  expect(result.consistent).toBe(false);
  expect(result.storedBalance).toEqual({ amount: '50.00', currency: 'EUR' });
  expect(result.calculatedBalance).toEqual({ amount: '40.00', currency: 'EUR' });
  expect(result.difference).toEqual({ amount: '10.00', currency: 'EUR' });

  expect(world.lines.length).toBe(1);
  const record = JSON.parse(world.lines[0]!) as Record<string, unknown>;
  expect(record.event).toBe('reconciliation.divergence');
  expect(record.level).toBe('warn');
  expect(record.walletId).toBe(WALLET_ID);
  expect(record.storedBalance).toBe('50.00');
  expect(record.calculatedBalance).toBe('40.00');
  expect(record.differenceAmount).toBe('10.00');
  expect(record.currency).toBe('EUR');
  expect(record.checkedEntries).toBe(2);
});

test('execute treats a zero-entry wallet as consistent when stored is zero', async () => {
  const world = fakeWorld({ balance: '0.00', currency: 'USD', count: 0, calculated: '0.00' });
  const result = await new ReconcileWallet(world.em, world.logger).execute(WALLET_ID);
  expect(result.consistent).toBe(true);
  expect(result.checkedEntries).toBe(0);
});

test('execute raises WalletNotFoundError for an unknown wallet', async () => {
  const world = fakeWorld(null);
  await expect(new ReconcileWallet(world.em, world.logger).execute(WALLET_ID))
    .rejects.toBeInstanceOf(WalletNotFoundError);
  expect(world.lines.length).toBe(0);
});
