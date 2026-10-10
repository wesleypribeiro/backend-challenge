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

test('POST /wallets creates wallet + OPENING ledger + OPENING transaction + outbox atomically', async () => {
  const playerId = crypto.randomUUID();
  const response = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  }));

  expect(response.status).toBe(201);
  expect(response.body).toEqual({
    id: expect.any(String),
    playerId,
    balance: { amount: '100.00', currency: 'BRL' },
    version: 1,
  });
  const walletId = response.body.id as string;

  const walletRows = (await infra.query('app',
    'select player_id, currency, balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(walletRows).toEqual([{ player_id: playerId, currency: 'BRL', balance: '100.00', version: 1 }]);

  const ledgerRows = (await infra.query('app',
    `select operation, direction, amount, balance_before, balance_after
       from wagering.wallet_ledger_entry where wallet_id = $1`, [walletId])).rows;
  expect(ledgerRows).toEqual([{
    operation: 'OPENING', direction: 'CREDIT', amount: '100.00', balance_before: '0.00', balance_after: '100.00',
  }]);

  const transactionRows = (await infra.query('app',
    `select kind, status, provider_id, external_transaction_id
       from wagering.wager_transaction where wallet_id = $1`, [walletId])).rows;
  expect(transactionRows).toEqual([{
    kind: 'OPENING', status: 'PROCESSED', provider_id: 'internal', external_transaction_id: `opening-${walletId}`,
  }]);

  const outboxEvents = (await infra.query('app',
    `select event_type from wagering.outbox_event where payload->'data'->>'walletId' = $1 order by event_type`, [walletId])).rows;
  expect(outboxEvents).toEqual([
    { event_type: 'WagerTransactionProcessed' },
    { event_type: 'WalletBalanceChanged' },
  ]);
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('POST /wallets with a duplicate (playerId, currency) is 409 and writes nothing extra', async () => {
  const { playerId } = await seedWallet(origin, '10.00');
  const before = (await infra.query('app',
    'select count(*)::int as count from wagering.wallet where player_id = $1', [playerId])).rows[0].count;

  const duplicate = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    playerId,
    initialBalance: { amount: '10.00', currency: 'BRL' },
  }));
  expect(duplicate.status).toBe(409);
  expect(duplicate.body).toMatchObject({ code: 'CONFLICT' });
  expect(String(duplicate.body.message)).toMatch(/BRL wallet already exists/);

  const after = (await infra.query('app',
    'select count(*)::int as count from wagering.wallet where player_id = $1', [playerId])).rows[0].count;
  expect(after).toBe(before);
});

test('POST /wallets rejects structural problems with 400 naming the field', async () => {
  const missingPlayer = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    initialBalance: { amount: '1.00', currency: 'BRL' },
  }));
  expect(missingPlayer.status).toBe(400);
  expect(missingPlayer.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'playerId' });

  const badMoney = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    playerId: crypto.randomUUID(),
    initialBalance: { amount: '1.005', currency: 'BRL' },
  }));
  expect(badMoney.status).toBe(400);
  expect(badMoney.body).toMatchObject({ code: 'INVALID_PAYLOAD' });

  const negative = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    playerId: crypto.randomUUID(),
    initialBalance: { amount: '-5.00', currency: 'BRL' },
  }));
  expect(negative.status).toBe(400);
  expect(String(negative.body.message)).toMatch(/cannot be negative/);
});

test('GET /wallets/:walletId returns the wallet or 404/400', async () => {
  const { walletId, playerId } = await seedWallet(origin, '42.50');
  const found = await apiJson(`${origin}/wallets/${walletId}`);
  expect(found.status).toBe(200);
  expect(found.body).toEqual({ id: walletId, playerId, balance: { amount: '42.50', currency: 'BRL' }, version: 1 });

  const unknown = await apiJson(`${origin}/wallets/${crypto.randomUUID()}`);
  expect(unknown.status).toBe(404);
  expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });

  const malformed = await apiJson(`${origin}/wallets/not-a-uuid`);
  expect(malformed.status).toBe(400);
  expect(malformed.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'walletId' });
});

test('GET /wallets/:walletId/ledger paginates by keyset without gaps or overlaps', async () => {
  // OPENING credit + two BET debits = three ledger entries walked page by page.
  const { walletId, playerId } = await seedWallet(origin, '100.00');
  for (const amount of ['10.00', '5.00']) {
    const submit = await apiJson(`${origin}/wagering/transactions`, postJson(`${origin}/wagering/transactions`, {
      providerId: 'acme',
      externalTransactionId: `ledger-bet-${amount}-${walletId}`,
      playerId,
      walletId,
      roundId: 'r-1',
      gameId: 'blackjack',
      kind: 'BET',
      money: { amount, currency: 'BRL' },
    }, { 'idempotency-key': `key-${amount}-${walletId}` }));
    expect(submit.status).toBe(200);
  }

  const seen: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page += 1) {
    const url = cursor === null
      ? `${origin}/wallets/${walletId}/ledger?limit=1`
      : `${origin}/wallets/${walletId}/ledger?limit=1&cursor=${encodeURIComponent(cursor)}`;
    const response = await apiJson(url);
    expect(response.status).toBe(200);
    const entries = response.body.entries as Array<Record<string, unknown>>;
    expect(entries.length).toBe(1);
    seen.push(entries[0]!);
    cursor = response.body.nextCursor as string | null;
  }
  expect(seen.map((entry) => entry.operation)).toEqual(['OPENING', 'BET', 'BET']);
  expect(new Set(seen.map((entry) => entry.id)).size).toBe(3);
  expect(cursor).toBeNull(); // the third page was the last

  const all = await apiJson(`${origin}/wallets/${walletId}/ledger`);
  expect((all.body.entries as unknown[]).length).toBe(3);
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('GET /wallets/:walletId/ledger rejects bad cursor/limit with 400 and unknown wallet with 404', async () => {
  const { walletId } = await seedWallet(origin, '5.00');

  const badCursor = await apiJson(`${origin}/wallets/${walletId}/ledger?cursor=!!!`);
  expect(badCursor.status).toBe(400);
  expect(badCursor.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'cursor' });

  const zeroLimit = await apiJson(`${origin}/wallets/${walletId}/ledger?limit=0`);
  expect(zeroLimit.status).toBe(400);
  expect(zeroLimit.body).toMatchObject({ field: 'limit' });

  const hugeLimit = await apiJson(`${origin}/wallets/${walletId}/ledger?limit=101`);
  expect(hugeLimit.status).toBe(400);

  const unknownWallet = await apiJson(`${origin}/wallets/${crypto.randomUUID()}/ledger`);
  expect(unknownWallet.status).toBe(404);
});
