import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client } from 'pg';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { assertLedgerInvariant } from '../support/invariants.js';
import { apiJson, seedWallet, startApi, type RunningApi } from '../support/api.js';

let infra: TestInfrastructure;
let api: RunningApi;
let origin: string;

beforeAll(async () => {
  infra = await TestInfrastructure.start();
  expect(runMigration(infra, 'migrate').code).toBe(0);
  api = await startApi(infra);
  origin = api.origin;
}, 240_000);

afterAll(async () => {
  await api?.close();
  await infra?.cleanup();
}, 30_000);

const walletState = async (walletId: string) => (await infra.query('app',
  'select balance, version, updated_at from wagering.wallet where id = $1', [walletId])).rows;

test('an uncommitted wallet mutation is invisible to reconciliation; after commit it is fully visible', async () => {
  const { walletId, playerId } = await seedWallet(origin, '100.00');

  // A dedicated connection holds a complete wallet mutation — transaction
  // row, ledger entry and balance update, mirroring the atomic commit of
  // ProcessWagerTransaction — without committing it. Explicit synchronization:
  // every step is awaited; no sleeps.
  const holder = new Client(infra.databaseUrl('app'));
  await holder.connect();
  try {
    await holder.query('BEGIN');
    const transactionId = crypto.randomUUID();
    await holder.query(
      `insert into wagering.wager_transaction
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, status,
          money_amount, money_currency, created_at)
       values ($1, 'acme', $2, $3, repeat('a', 64), $4, $5, 'r-snap', 'g-snap',
               'WIN', 'REJECTED', '15.00', 'BRL', now())`,
      [transactionId, `snap-win-${walletId}`, `snap-key-${walletId}`, walletId, playerId]);
    await holder.query(
      `insert into wagering.wallet_ledger_entry
         (id, wallet_id, transaction_id, operation, direction, amount, currency, balance_before, balance_after)
       values ($1, $2, $3, 'WIN', 'CREDIT', '15.00', 'BRL', '100.00', '115.00')`,
      [crypto.randomUUID(), walletId, transactionId]);
    await holder.query(
      `update wagering.wallet set balance = '115.00', version = version + 1, updated_at = now()
        where id = $1`, [walletId]);

    // Pending (uncommitted) state: MVCC hides it from the reconciliation
    // statement — the pre-commit snapshot is internally consistent.
    const pending = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({
      walletId,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });

    await holder.query('COMMIT');
  } finally {
    await holder.end();
  }

  // Post-commit: the whole mutation is visible — both readings move together.
  const committed = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  expect(committed.status).toBe(200);
  expect(committed.body).toEqual({
    walletId,
    storedBalance: { amount: '115.00', currency: 'BRL' },
    calculatedBalance: { amount: '115.00', currency: 'BRL' },
    difference: { amount: '0.00', currency: 'BRL' },
    consistent: true,
    checkedEntries: 2,
  });
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('reconciliation racing a commit observes a consistent snapshot — never a mixed reading', async () => {
  const { walletId, playerId } = await seedWallet(origin, '50.00');
  const before = await walletState(walletId);

  const holder = new Client(infra.databaseUrl('app'));
  await holder.connect();
  try {
    await holder.query('BEGIN');
    const transactionId = crypto.randomUUID();
    await holder.query(
      `insert into wagering.wager_transaction
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, status,
          money_amount, money_currency, created_at)
       values ($1, 'acme', $2, $3, repeat('b', 64), $4, $5, 'r-race', 'g-race',
               'WIN', 'REJECTED', '10.00', 'BRL', now())`,
      [transactionId, `race-win-${walletId}`, `race-key-${walletId}`, walletId, playerId]);
    await holder.query(
      `insert into wagering.wallet_ledger_entry
         (id, wallet_id, transaction_id, operation, direction, amount, currency, balance_before, balance_after)
       values ($1, $2, $3, 'WIN', 'CREDIT', '10.00', 'BRL', '50.00', '60.00')`,
      [crypto.randomUUID(), walletId, transactionId]);
    await holder.query(
      `update wagering.wallet set balance = '60.00', version = version + 1, updated_at = now()
        where id = $1`, [walletId]);

    // The reconciliation request and the COMMIT are issued concurrently. A
    // single-statement snapshot must land entirely before or entirely after
    // the commit — the response is one of the two consistent states, never a
    // mixed pre-commit balance with post-commit ledger sum (or the reverse).
    // Explicit synchronization via Promise.all; no sleeps, no retries.
    const [racing] = await Promise.all([
      apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' }),
      holder.query('COMMIT'),
    ]);
    expect(racing.status).toBe(200);
    const allowed = new Map<string, Record<string, unknown>>([
      ['50.00', {
        walletId,
        storedBalance: { amount: '50.00', currency: 'BRL' },
        calculatedBalance: { amount: '50.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 1,
      }],
      ['60.00', {
        walletId,
        storedBalance: { amount: '60.00', currency: 'BRL' },
        calculatedBalance: { amount: '60.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 2,
      }],
    ]);
    const stored = (racing.body.storedBalance as { amount: string }).amount;
    expect(allowed.has(stored)).toBe(true);
    expect(racing.body).toEqual(allowed.get(stored)!);

    // Reconciliation never writes: a post-race read shows exactly one wallet
    // mutation (the holder's own update — version bumped once). `before` was
    // captured pre-mutation; balance 60.00/version 2 can only come from the
    // holder's transaction, since reconciliation performs no writes.
    const afterRace = await walletState(walletId);
    expect(afterRace).toEqual([{ balance: '60.00', version: 2, updated_at: (afterRace[0] as { updated_at: Date }).updated_at }]);
    expect(before).toEqual([{ balance: '50.00', version: 1, updated_at: (before[0] as { updated_at: Date }).updated_at }]);
  } finally {
    await holder.end();
  }

  const settled = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  expect(settled.body).toMatchObject({ consistent: true, checkedEntries: 2 });
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('reconciliation writes nothing: wallet, version and ledger are untouched across repeated calls', async () => {
  const { walletId } = await seedWallet(origin, '70.00');
  const walletBefore = await walletState(walletId);
  const entriesBefore = (await infra.query('app',
    `select id, operation, direction, amount, balance_before, balance_after
       from wagering.wallet_ledger_entry where wallet_id = $1 order by created_at, id`,
    [walletId])).rows;

  for (let i = 0; i < 3; i += 1) {
    const response = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ consistent: true, checkedEntries: 1 });
  }

  expect(await walletState(walletId)).toEqual(walletBefore);
  expect((await infra.query('app',
    `select id, operation, direction, amount, balance_before, balance_after
       from wagering.wallet_ledger_entry where wallet_id = $1 order by created_at, id`,
    [walletId])).rows).toEqual(entriesBefore);
  expect((await infra.query('app',
    `select count(*)::int as outbox from wagering.outbox_event
      where payload->'data'->>'walletId' = $1`,
    [walletId])).rows).toEqual([{ outbox: 2 }]); // OPENING's WagerTransactionProcessed + WalletBalanceChanged — and nothing else
});
