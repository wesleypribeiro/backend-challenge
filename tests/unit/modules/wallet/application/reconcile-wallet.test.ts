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
  /** How many times createQueryBuilder was invoked during the execute() call. */
  queryBuilderCalls: number;
  /** How many times the QueryBuilder chain reached execute(). */
  executeCalls: number;
  /** How many findOne() calls were attempted — must stay 0 (single-query contract). */
  findOneCalls: number;
  /** Fields requested in the select of the single query. */
  selectFields: unknown[];
  /** The where object of the single query. */
  whereClause: unknown;
}

/**
 * The use case must issue exactly one QueryBuilder call (wallet LEFT JOIN
 * ledger, GROUP BY wallet PK) to read stored balance, currency, ledger sum
 * and entry count together — the fake mirrors that one chain, counts every
 * database-touching entry point, and records what was asked for. An empty
 * row array represents an unknown wallet. `findOne` is instrumented because
 * the pre-fix implementation used it for the wallet read; any reversion to
 * the two-query approach trips the counters.
 */
function fakeWorld(snapshotRow: unknown): FakeWorld {
  const lines: string[] = [];
  const sink = (line: string) => { lines.push(line); };
  const world: FakeWorld = {
    lines,
    queryBuilderCalls: 0,
    executeCalls: 0,
    findOneCalls: 0,
    selectFields: [],
    whereClause: undefined,
    em: undefined as unknown as EntityManager,
    logger: new JsonLogger('api', sink),
  };
  const queryBuilder = {
    select: (fields: unknown[]) => { world.selectFields = fields; return queryBuilder; },
    leftJoin: () => queryBuilder,
    where: (clause: unknown) => { world.whereClause = clause; return queryBuilder; },
    groupBy: () => queryBuilder,
    execute: async () => {
      world.executeCalls += 1;
      return snapshotRow === null ? [] : [snapshotRow];
    },
  };
  world.em = {
    createQueryBuilder: () => {
      world.queryBuilderCalls += 1;
      return queryBuilder;
    },
    findOne: async () => {
      world.findOneCalls += 1;
      return null;
    },
  } as unknown as EntityManager;
  return world;
}

test('execute reads stored balance and ledger sum in exactly one query', async () => {
  const world = fakeWorld({ balance: '40.00', currency: 'EUR', count: 3, calculated: '40.00' });
  const result = await new ReconcileWallet(world.em, world.logger).execute(WALLET_ID);

  expect(result.consistent).toBe(true);
  // Single-query contract: one QueryBuilder, one execute, no findOne — a
  // regression to the old wallet-then-ledger two-query reading makes
  // findOneCalls or queryBuilderCalls exceed these bounds deterministically.
  expect(world.queryBuilderCalls).toBe(1);
  expect(world.executeCalls).toBe(1);
  expect(world.findOneCalls).toBe(0);

  // The one query must ask for all four values together: stored balance,
  // currency, exact ledger sum and entry count. RawQueryFragment coerces to
  // a symbol (object-key use), so read its `.sql` instead of String().
  const requested = world.selectFields.map((field) =>
    typeof field === 'string' ? field : String((field as { sql: string }).sql));
  expect(requested.some((field) => field.includes('balance'))).toBe(true);
  expect(requested.some((field) => field.includes('currency'))).toBe(true);
  expect(requested.some((field) => field.includes('calculated'))).toBe(true);
  expect(requested.some((field) => field.includes('count'))).toBe(true);
  expect(world.whereClause).toEqual({ id: WALLET_ID });
});

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
  expect(world.executeCalls).toBe(1); // still a single statement, even on the miss path
});
