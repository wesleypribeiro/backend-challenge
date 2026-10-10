import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { assertLedgerInvariant } from '../support/invariants.js';
import { apiJson, postJson, seedWallet, startApi, type RunningApi } from '../support/api.js';

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

test('POST /wallets/:walletId/reconciliation reports consistency for a healthy wallet', async () => {
  const { walletId } = await seedWallet(origin, '80.00');
  const response = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    walletId,
    storedBalance: { amount: '80.00', currency: 'BRL' },
    calculatedBalance: { amount: '80.00', currency: 'BRL' },
    difference: { amount: '0.00', currency: 'BRL' },
    consistent: true,
    checkedEntries: 1,
  });

  // Read-only guarantee: the wallet row is untouched by reconciliation.
  const wallet = (await infra.query('app',
    'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(wallet).toEqual([{ balance: '80.00', version: 1 }]);
});

test('a seeded divergence is reported without ever being corrected', async () => {
  const { walletId, playerId } = await seedWallet(origin, '60.00');
  // Simulate divergence the only way the append-only ledger allows: a
  // compensating CREDIT entry that the materialized balance never saw. The
  // ledger row needs a real transaction (deferred FK) that is distinct from
  // the OPENING transaction (one entry per transaction per wallet).
  const seedTransactionId = crypto.randomUUID();
  await infra.query('app',
    `insert into wagering.wager_transaction
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, status,
        money_amount, money_currency, created_at)
     values ($1, 'acme', $2, $3, repeat('a', 64), $4, $5, 'r-seed', 'g-seed',
             'WIN', 'REJECTED', '15.00', 'BRL', now())`,
    [seedTransactionId, `seed-win-${walletId}`, `seed-key-${walletId}`, walletId, playerId]);
  await infra.query('app',
    `insert into wagering.wallet_ledger_entry
       (id, wallet_id, transaction_id, operation, direction, amount, currency, balance_before, balance_after)
     values ($1, $2, $3, 'WIN', 'CREDIT', '15.00', 'BRL', '60.00', '75.00')`,
    [crypto.randomUUID(), walletId, seedTransactionId]);

  const response = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    walletId,
    storedBalance: { amount: '60.00', currency: 'BRL' },
    calculatedBalance: { amount: '75.00', currency: 'BRL' },
    difference: { amount: '-15.00', currency: 'BRL' },
    consistent: false,
    checkedEntries: 2,
  });

  // The route never writes: stored balance and ledger rows stay exactly as seeded.
  const wallet = (await infra.query('app',
    'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(wallet).toEqual([{ balance: '60.00', version: 1 }]);
  const entries = (await infra.query('app',
    `select operation, direction, amount from wagering.wallet_ledger_entry
      where wallet_id = $1 order by created_at, id`, [walletId])).rows;
  expect(entries).toEqual([
    { operation: 'OPENING', direction: 'CREDIT', amount: '60.00' },
    { operation: 'WIN', direction: 'CREDIT', amount: '15.00' },
  ]);
});

test('reconciliation of an unknown wallet is 404 and of a malformed id is 400', async () => {
  const unknown = await apiJson(`${origin}/wallets/${crypto.randomUUID()}/reconciliation`, { method: 'POST' });
  expect(unknown.status).toBe(404);
  expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });

  const malformed = await apiJson(`${origin}/wallets/nope/reconciliation`, { method: 'POST' });
  expect(malformed.status).toBe(400);
  expect(malformed.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'walletId' });
});

test('a zero-balance wallet with no entries reconciles as consistent', async () => {
  const { walletId } = await seedWallet(origin, '0.00');
  const response = await apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    consistent: true,
    checkedEntries: 0,
    difference: { amount: '0.00', currency: 'BRL' },
  });
});

test('reconciliation racing concurrent bets never observes a false divergence', async () => {
  const { walletId, playerId } = await seedWallet(origin, '100.00');

  // Four BETs and four reconciliations run truly concurrently on the same
  // wallet. Every bet commits wallet+ledger+transaction atomically (F2); a
  // single-statement reconciliation snapshot therefore always sees a state
  // where stored balance equals ledger sum — every response must be
  // consistent, regardless of interleaving. Explicit Promise.all
  // synchronization; no sleeps.
  const bet = (index: number) => apiJson(`${origin}/wagering/transactions`, postJson(
    `${origin}/wagering/transactions`,
    {
      providerId: 'acme',
      externalTransactionId: `burst-bet-${index}-${walletId}`,
      playerId,
      walletId,
      roundId: `r-burst-${index}`,
      gameId: 'blackjack',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    },
    { 'idempotency-key': `burst-key-${index}-${walletId}` },
  ));
  const reconcile = () => apiJson(`${origin}/wallets/${walletId}/reconciliation`, { method: 'POST' });

  const [bets, reconciliations] = await Promise.all([
    Promise.all([bet(1), bet(2), bet(3), bet(4)]),
    Promise.all([reconcile(), reconcile(), reconcile(), reconcile()]),
  ]);

  for (const submitted of bets) {
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ status: 'PROCESSED', idempotentReplay: false });
  }
  for (const reconciled of reconciliations) {
    expect(reconciled.status).toBe(200);
    // No mixed reading is ever acceptable: stored always equals calculated.
    expect(reconciled.body).toMatchObject({
      consistent: true,
      difference: { amount: '0.00', currency: 'BRL' },
    });
    expect((reconciled.body.storedBalance as { amount: string }).amount)
      .toBe((reconciled.body.calculatedBalance as { amount: string }).amount);
  }

  // Wallet and ledger changed only through the four bets — never through
  // reconciliation — and the reconstruction invariant holds.
  const wallet = (await infra.query('app',
    'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(wallet).toEqual([{ balance: '60.00', version: 5 }]);
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
  const settled = await reconcile();
  expect(settled.body).toMatchObject({
    consistent: true,
    checkedEntries: 5,
    storedBalance: { amount: '60.00', currency: 'BRL' },
  });
});
