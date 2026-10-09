import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from 'pg';
import { MikroORM } from '@mikro-orm/postgresql';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';
import { assertLedgerInvariant as sharedInvariant } from '../support/invariants.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { createWorkerApplication } = await compiled<typeof import('../../src/bootstrap/worker.js')>('dist/bootstrap/worker.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');
const { Money } = await compiled<typeof import('../../src/domain/wallet/money.js')>('dist/domain/wallet/money.js');
const { Wallet } = await compiled<typeof import('../../src/domain/wallet/wallet.js')>('dist/domain/wallet/wallet.js');
const { WalletRepository } = await compiled<typeof import('../../src/platform/database/wallet.repository.js')>('dist/platform/database/wallet.repository.js');
const { WagerTransactionKind } = await compiled<typeof import('../../src/domain/wagering/wager-transaction.js')>('dist/domain/wagering/wager-transaction.js');
const { ProcessWagerTransaction } = await compiled<typeof import('../../src/modules/wagering/application/process-wager-transaction.js')>('dist/modules/wagering/application/process-wager-transaction.js');

let infra: TestInfrastructure;
let orm: MikroORM;
let closeWorker: () => Promise<void>;

beforeAll(async () => {
  infra = await TestInfrastructure.start();
  expect(runMigration(infra, 'migrate').code).toBe(0);
  const environment = { ...localEnvironment, DATABASE_URL: infra.databaseUrl('app') };
  const worker = await createWorkerApplication(loadConfiguration('worker', environment), new JsonLogger('worker', () => {}));
  closeWorker = () => worker.close();
  orm = worker.get(MikroORM);
}, 240_000);

afterAll(async () => {
  await closeWorker?.();
  await infra?.cleanup();
}, 30_000);

type UseCase = InstanceType<typeof ProcessWagerTransaction>;
type Result = Awaited<ReturnType<UseCase['execute']>>;

const useCase = (): UseCase => new ProcessWagerTransaction(orm.em.fork());

const openWallet = async (amount: string) => {
  const walletId = crypto.randomUUID();
  const playerId = crypto.randomUUID();
  const { wallet, ledgerEntry } = Wallet.open({
    id: walletId,
    playerId,
    initialBalance: Money.from({ amount, currency: 'BRL' }),
    idGenerator: () => crypto.randomUUID(),
  });
  await new WalletRepository(orm.em.fork()).saveOpen(wallet, ledgerEntry);
  return { walletId, playerId };
};

const betInput = (walletId: string, playerId: string, amount: string, external = crypto.randomUUID()) => ({
  providerId: 'provider-a',
  externalTransactionId: external,
  idempotencyKey: `provider-a:${external}`,
  playerId,
  walletId,
  roundId: 'round-1',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.Bet,
  amount,
  currency: 'BRL',
});

const walletRow = async (walletId: string) =>
  (await infra.query('app', 'select balance, version from wagering.wallet where id = $1', [walletId])).rows[0] as
    { balance: string; version: number };

const assertLedgerInvariant = (walletId: string) =>
  sharedInvariant((sql, params) => infra.query('app', sql, params), walletId);

const playerDebits = async (walletId: string) =>
  (await infra.query('app',
    `select count(*)::int as c, coalesce(sum(amount), 0)::text as total
     from wagering.wallet_ledger_entry where wallet_id = $1 and operation = 'BET' and direction = 'DEBIT'`, [walletId]))
    .rows[0] as { c: number; total: string };

test('S13-C01: the same bet sent 50 times in parallel applies exactly one debit and replays the original', async () => {
  const { walletId, playerId } = await openWallet('1000.00');
  const input = betInput(walletId, playerId, '10.00');

  const results = await Promise.all(Array.from({ length: 50 }, () => useCase().execute(input)));

  const effective = results.filter((r) => r.outcome === 'processed' && !r.idempotentReplay);
  const replays = results.filter((r) => r.idempotentReplay);
  expect(effective).toHaveLength(1);
  expect(replays).toHaveLength(49);
  const transactionIds = new Set(results.map((r) => r.transactionId));
  expect(transactionIds.size).toBe(1);
  for (const replay of replays) {
    expect(replay).toMatchObject({ outcome: 'processed', balance: { amount: '990.00', currency: 'BRL' } });
  }

  expect(await walletRow(walletId)).toMatchObject({ balance: '990.00', version: 2 });
  expect(await playerDebits(walletId)).toEqual({ c: 1, total: '10.00' });
  expect((await infra.query('app', "select count(*)::int as c from wagering.wager_transaction where wallet_id = $1 and kind = 'BET'", [walletId])).rows)
    .toEqual([{ c: 1 }]);
  // Nenhum retry posterior duplica o débito.
  const later = await useCase().execute(input);
  expect(later).toMatchObject({ outcome: 'processed', idempotentReplay: true });
  expect(await playerDebits(walletId)).toEqual({ c: 1, total: '10.00' });
  await assertLedgerInvariant(walletId);
}, 60_000);

test('S13-C02: two 80.00 bets racing a 100.00 wallet — one processed, one rejected, balance 20.00, a single debit', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const results = await Promise.all([
    useCase().execute(betInput(walletId, playerId, '80.00')),
    useCase().execute(betInput(walletId, playerId, '80.00')),
  ]);

  const processed = results.filter((r) => r.outcome === 'processed');
  const rejected = results.filter((r) => r.outcome === 'rejected');
  expect(processed).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ failureCode: 'INSUFFICIENT_FUNDS' });

  expect(await walletRow(walletId)).toMatchObject({ balance: '20.00', version: 2 });
  expect(await playerDebits(walletId)).toEqual({ c: 1, total: '80.00' });
  await assertLedgerInvariant(walletId);
}, 30_000);

test('S13-C03: a wallet blocked by a foreign lock does not stop operations on a distinct wallet', async () => {
  const { walletId: walletA, playerId: playerA } = await openWallet('100.00');
  const { walletId: walletB, playerId: playerB } = await openWallet('100.00');

  // Conector dedicado mantém a transação bloqueadora aberta (infra.query abre
  // um client por chamada e não serve para segurar locks).
  const locker = new Client({ connectionString: infra.databaseUrl('app') });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query('select id from wagering.wallet where id = $1 for update', [walletA]);

    const blocked = useCase().execute(betInput(walletA, playerA, '10.00'));

    // Barreira observável: espera o backend da aposta de A aparecer em
    // pg_stat_activity aguardando o lock — não é um sleep como prova.
    const waiting = await waitForLockWait(infra, walletA);
    expect(waiting).toBe(true);

    // Com A bloqueada, B progride sem esperar (sem lock global).
    const b = await useCase().execute(betInput(walletB, playerB, '10.00'));
    expect(b).toMatchObject({ outcome: 'processed', balance: { amount: '90.00', currency: 'BRL' } });

    await locker.query('commit');
    const a = await blocked;
    expect(a).toMatchObject({ outcome: 'processed', balance: { amount: '90.00', currency: 'BRL' } });
  } finally {
    await locker.query('rollback').catch(() => {});
    await locker.end();
  }
  await assertLedgerInvariant(walletA);
  await assertLedgerInvariant(walletB);
}, 30_000);

test('concurrent distinct submissions on one wallet never overdraw and the invariant holds', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  // 10 apostas de 15.00 contra 100.00: no máximo 6 podem ser aplicadas.
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    useCase().execute(betInput(walletId, playerId, '15.00'))));
  const processed = results.filter((r) => r.outcome === 'processed');
  const rejected = results.filter((r) => r.outcome === 'rejected');
  expect(processed.length).toBe(6);
  expect(rejected.length).toBe(4);
  for (const r of rejected) expect(r).toMatchObject({ failureCode: 'INSUFFICIENT_FUNDS' });

  const stored = await walletRow(walletId);
  expect(stored.balance).toBe('10.00');
  expect(await playerDebits(walletId)).toEqual({ c: 6, total: '90.00' });
  await assertLedgerInvariant(walletId);
}, 30_000);

async function waitForLockWait(infraRef: TestInfrastructure, walletId: string, deadlineMs = 5_000): Promise<boolean> {
  const probe = new Client({ connectionString: infraRef.databaseUrl('app') });
  await probe.connect();
  try {
    const end = Date.now() + deadlineMs;
    while (Date.now() < end) {
      const { rows } = await probe.query(
        `select count(*)::int as c from pg_stat_activity
         where wait_event_type = 'Lock'
           and query like $1
           and state = 'active'`,
        [`%${walletId}%`],
      );
      if ((rows[0] as { c: number }).c > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  } finally {
    await probe.end();
  }
}
