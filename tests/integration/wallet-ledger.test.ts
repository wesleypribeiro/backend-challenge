import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { createWorkerApplication } = await compiled<typeof import('../../src/bootstrap/worker.js')>('dist/bootstrap/worker.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');
const { Money } = await compiled<typeof import('../../src/domain/wallet/money.js')>('dist/domain/wallet/money.js');
const { Wallet } = await compiled<typeof import('../../src/domain/wallet/wallet.js')>('dist/domain/wallet/wallet.js');
const { WalletLedgerEntry, LedgerDirection } = await compiled<typeof import('../../src/domain/wallet/ledger-entry.js')>('dist/domain/wallet/ledger-entry.js');
const { WalletRepository } = await compiled<typeof import('../../src/platform/database/wallet.repository.js')>('dist/platform/database/wallet.repository.js');
const { WalletSchema } = await compiled<typeof import('../../src/platform/database/entities/wallet.entity.js')>('dist/platform/database/entities/wallet.entity.js');
const { WalletLedgerEntrySchema } = await compiled<typeof import('../../src/platform/database/entities/wallet-ledger-entry.entity.js')>('dist/platform/database/entities/wallet-ledger-entry.entity.js');

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

const ids = () => ({
  walletId: crypto.randomUUID(),
  playerId: crypto.randomUUID(),
  entryId: crypto.randomUUID(),
  transactionId: crypto.randomUUID(),
});

const openWallet = (walletId: string, playerId: string, amount: string, idGenerator: () => string = () => crypto.randomUUID()) =>
  Wallet.open({ id: walletId, playerId, initialBalance: Money.from({ amount, currency: 'BRL' }), idGenerator });

const insertLedgerSql = `insert into wagering.wallet_ledger_entry
  (id, wallet_id, transaction_id, operation, direction, amount, currency, balance_before, balance_after)
  values ($1, $2, $3, $4, $5, $6, 'BRL', $7, $8)`;

test('entity metadata maps wallet and ledger to the wagering schema with domain-owned version', () => {
  const metadata = orm.getMetadata();
  const wallet = metadata.get(WalletSchema);
  expect(wallet.collection).toBe('wallet');
  expect(wallet.schema).toBe('wagering');
  expect(wallet.properties.playerId!.fieldNames).toEqual(['player_id']);
  expect(wallet.properties.version!.version).toBeFalsy();
  expect(wallet.uniques.map((unique) => [...(unique.properties as string[])].sort())).toContainEqual(['currency', 'playerId']);

  const ledger = metadata.get(WalletLedgerEntrySchema);
  expect(ledger.collection).toBe('wallet_ledger_entry');
  expect(ledger.schema).toBe('wagering');
  expect(ledger.properties.walletId.fieldNames).toEqual(['wallet_id']);
  expect(ledger.properties.transactionId!.fieldNames).toEqual(['transaction_id']);
  expect(ledger.properties.balanceBefore!.fieldNames).toEqual(['balance_before']);
  expect(ledger.properties.balanceAfter!.fieldNames).toEqual(['balance_after']);
  expect(ledger.properties.direction!.fieldNames).toEqual(['direction']);
});

test('positive opening persists wallet and OPENING CREDIT ledger entry atomically', async () => {
  const em = orm.em.fork();
  const { walletId, playerId, entryId, transactionId } = ids();
  let call = 0;
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, '1000.00', () => (++call === 1 ? entryId : transactionId));
  await new WalletRepository(em).saveOpen(wallet, ledgerEntry);

  const walletRows = (await infra.query('app', 'select player_id, currency, balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(walletRows).toEqual([{ player_id: playerId, currency: 'BRL', balance: '1000.00', version: 1 }]);

  const ledgerRows = (await infra.query('app',
    'select id, wallet_id, transaction_id, operation, direction, amount, currency, balance_before, balance_after from wagering.wallet_ledger_entry where wallet_id = $1', [walletId])).rows;
  expect(ledgerRows).toEqual([{
    id: entryId, wallet_id: walletId, transaction_id: transactionId,
    operation: 'OPENING', direction: 'CREDIT', amount: '1000.00', currency: 'BRL',
    balance_before: '0.00', balance_after: '1000.00',
  }]);
});

test('zero opening persists the wallet with version 1 and no ledger entry', async () => {
  const em = orm.em.fork();
  const { walletId, playerId } = ids();
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, '0.00');
  expect(ledgerEntry).toBeUndefined();
  await new WalletRepository(em).saveOpen(wallet, ledgerEntry);

  const walletRows = (await infra.query('app', 'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(walletRows).toEqual([{ balance: '0.00', version: 1 }]);
  const ledgerCount = (await infra.query('app', 'select count(*)::int as count from wagering.wallet_ledger_entry where wallet_id = $1', [walletId])).rows;
  expect(ledgerCount).toEqual([{ count: 0 }]);
});

test('UNIQUE(player_id, currency) rejects a second wallet for the same player and currency', async () => {
  const { walletId, playerId } = ids();
  const first = openWallet(walletId, playerId, '10.00');
  await new WalletRepository(orm.em.fork()).saveOpen(first.wallet, first.ledgerEntry);

  const second = openWallet(crypto.randomUUID(), playerId, '10.00');
  await expect(new WalletRepository(orm.em.fork()).saveOpen(second.wallet, second.ledgerEntry))
    .rejects.toMatchObject({ code: '23505' });

  const count = (await infra.query('app', 'select count(*)::int as count from wagering.wallet where player_id = $1', [playerId])).rows;
  expect(count).toEqual([{ count: 1 }]);
});

test('CHECK constraints reject negative balance, invalid direction, non-positive amount and unbalanced arithmetic', async () => {
  const { walletId, playerId } = ids();
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, '50.00');
  await new WalletRepository(orm.em.fork()).saveOpen(wallet, ledgerEntry);

  await expect(infra.query('app',
    "insert into wagering.wallet (id, player_id, currency, balance, version, created_at, updated_at) values ($1, $2, 'BRL', -1.00, 1, now(), now())",
    [crypto.randomUUID(), crypto.randomUUID()]))
    .rejects.toThrow(/violates check constraint "wallet_balance_non_negative"/);

  const entry = () => [crypto.randomUUID(), walletId, crypto.randomUUID()] as const;
  const [e1, w1, t1] = entry();
  // An invalid direction also breaks the arithmetic check (neither branch
  // applies); PostgreSQL reports one of the two ledger check constraints and
  // the SQLSTATE varies with evaluation order, so assert the constraint family.
  await expect(infra.query('app', insertLedgerSql, [e1, w1, t1, 'BET', 'SIDEWAYS', '10.00', '50.00', '40.00']))
    .rejects.toThrow(/violates check constraint "wallet_ledger_entry_/);
  const [e2, w2, t2] = entry();
  await expect(infra.query('app', insertLedgerSql, [e2, w2, t2, 'BET', 'DEBIT', '0.00', '50.00', '50.00']))
    .rejects.toThrow(/violates check constraint "wallet_ledger_entry_amount_positive"/);
  const [e3, w3, t3] = entry();
  // CREDIT arithmetic must satisfy balance_after = balance_before + amount (50 + 10 !== 40).
  await expect(infra.query('app', insertLedgerSql, [e3, w3, t3, 'WIN', 'CREDIT', '10.00', '50.00', '40.00']))
    .rejects.toThrow(/violates check constraint "wallet_ledger_entry_arithmetic_consistent"/);
});

test('UNIQUE(wallet_id, transaction_id) allows at most one ledger entry per transaction per wallet', async () => {
  const { walletId, playerId, entryId } = ids();
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, '30.00', () => entryId);
  await new WalletRepository(orm.em.fork()).saveOpen(wallet, ledgerEntry);

  // The OPENING row already owns (wallet_id, entryId); any second entry for the
  // same transaction must be rejected regardless of direction or amounts.
  await expect(infra.query('app', insertLedgerSql,
    [crypto.randomUUID(), walletId, entryId, 'BET', 'DEBIT', '10.00', '30.00', '20.00']))
    .rejects.toMatchObject({ code: '23505' });
  await expect(infra.query('app', insertLedgerSql,
    [entryId, walletId, entryId, 'ROLLBACK', 'CREDIT', '30.00', '0.00', '30.00']))
    .rejects.toMatchObject({ code: '23505' });
});

test('saveOpen rolls back the wallet insert when the ledger insert fails (single transaction)', async () => {
  const { walletId, playerId, entryId, transactionId } = ids();
  let call = 0;
  const { wallet: existing, ledgerEntry: existingEntry } = openWallet(walletId, playerId, '20.00', () => (++call === 1 ? entryId : transactionId));
  await new WalletRepository(orm.em.fork()).saveOpen(existing, existingEntry);

  // Second opening whose ledger entry reuses the first entry's primary key:
  // the ledger INSERT fails and the wallet INSERT of the same flush must roll back.
  const { wallet: doomed } = openWallet(crypto.randomUUID(), crypto.randomUUID(), '99.00');
  const conflictingEntry = WalletLedgerEntry.rehydrate({
    id: entryId,
    walletId: doomed.id,
    transactionId,
    operation: 'OPENING',
    direction: LedgerDirection.Credit,
    amount: Money.from({ amount: '99.00', currency: 'BRL' }),
    balanceBefore: Money.zero('BRL'),
    balanceAfter: Money.from({ amount: '99.00', currency: 'BRL' }),
    createdAt: new Date(),
  });
  await expect(new WalletRepository(orm.em.fork()).saveOpen(doomed, conflictingEntry))
    .rejects.toMatchObject({ code: '23505' });

  expect((await infra.query('app', 'select id from wagering.wallet where id = $1', [doomed.id])).rows).toEqual([]);
  expect((await infra.query('app', 'select id from wagering.wallet_ledger_entry where wallet_id = $1', [doomed.id])).rows).toEqual([]);
});

test('ledger table rejects UPDATE, DELETE and TRUNCATE via grants (app) and triggers (all roles)', async () => {
  const { walletId, playerId } = ids();
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, '15.00');
  await new WalletRepository(orm.em.fork()).saveOpen(wallet, ledgerEntry);
  const entryRowId = ledgerEntry!.id;

  // Layer 1 — wagering_app holds only SELECT/INSERT on the ledger: mutation
  // attempts are refused by privilege checks before reaching the triggers.
  for (const statement of [
    `update wagering.wallet_ledger_entry set amount = amount + 1.00 where id = '${entryRowId}'`,
    `delete from wagering.wallet_ledger_entry where id = '${entryRowId}'`,
    'truncate wagering.wallet_ledger_entry',
  ]) {
    await expect(infra.query('app', statement)).rejects.toMatchObject({ code: '42501' });
  }

  // Layer 2 — the table owner (migrator) bypasses grants, so the append-only
  // triggers must reject UPDATE, DELETE and TRUNCATE for every role.
  await expect(infra.query('migrator', 'update wagering.wallet_ledger_entry set amount = amount + 1.00 where id = $1', [entryRowId]))
    .rejects.toThrow(/wallet_ledger_entry is append-only: UPDATE is not allowed/);
  await expect(infra.query('migrator', 'delete from wagering.wallet_ledger_entry where id = $1', [entryRowId]))
    .rejects.toThrow(/wallet_ledger_entry is append-only: DELETE is not allowed/);
  await expect(infra.query('migrator', 'truncate wagering.wallet_ledger_entry'))
    .rejects.toThrow(/wallet_ledger_entry is append-only: TRUNCATE is not allowed/);

  const unchanged = (await infra.query('app', 'select amount, balance_before, balance_after from wagering.wallet_ledger_entry where id = $1', [entryRowId])).rows;
  expect(unchanged).toEqual([{ amount: '15.00', balance_before: '0.00', balance_after: '15.00' }]);
});

test('ledger rejects entries referencing a missing wallet (FK)', async () => {
  await expect(infra.query('app', insertLedgerSql,
    [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), 'OPENING', 'CREDIT', '10.00', '0.00', '10.00']))
    .rejects.toMatchObject({ code: '23503' });
});

test('NUMERIC(20,2) round-trips exact large balances through the repository and ORM', async () => {
  const em = orm.em.fork();
  const { walletId, playerId } = ids();
  const exact = '900719925474099.91';
  const { wallet, ledgerEntry } = openWallet(walletId, playerId, exact);
  await new WalletRepository(em).saveOpen(wallet, ledgerEntry);

  expect((await infra.query('app', 'select balance from wagering.wallet where id = $1', [walletId])).rows)
    .toEqual([{ balance: exact }]);
  const loaded = await em.fork().findOne(WalletSchema, walletId);
  expect(loaded?.balance).toBe(exact);
  expect(typeof loaded?.balance).toBe('string');
  expect(loaded?.version).toBe(1);
});
