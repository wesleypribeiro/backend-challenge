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

let sequence = 0;
function submission(walletId: string, playerId: string, overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    providerId: 'acme',
    externalTransactionId: `ext-${sequence}-${crypto.randomUUID()}`,
    playerId,
    walletId,
    roundId: `round-${sequence}`,
    gameId: 'blackjack',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
    ...overrides,
  };
}

function submit(body: Record<string, unknown>, idempotencyKey: string) {
  return apiJson(`${origin}/wagering/transactions`, postJson(
    `${origin}/wagering/transactions`, body, { 'idempotency-key': idempotencyKey },
  ));
}

test('POST /wagering/transactions applies a BET, moves the balance and writes ledger + outbox', async () => {
  const { walletId, playerId } = await seedWallet(origin, '100.00');
  const body = submission(walletId, playerId);
  const response = await submit(body, 'key-bet-1');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    transactionId: expect.any(String),
    status: 'PROCESSED',
    balance: { amount: '90.00', currency: 'BRL' },
    idempotentReplay: false,
  });

  const ledger = (await infra.query('app',
    `select operation, direction, amount, balance_before, balance_after
       from wagering.wallet_ledger_entry where wallet_id = $1 and operation = 'BET'`, [walletId])).rows;
  expect(ledger).toEqual([{
    operation: 'BET', direction: 'DEBIT', amount: '10.00', balance_before: '100.00', balance_after: '90.00',
  }]);

  const wallet = (await infra.query('app',
    'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(wallet).toEqual([{ balance: '90.00', version: 2 }]);

  const outbox = (await infra.query('app',
    `select event_type from wagering.outbox_event
      where payload->'data'->>'transactionId' = $1 order by event_type`, [response.body.transactionId])).rows;
  expect(outbox).toEqual([
    { event_type: 'WagerTransactionProcessed' },
    { event_type: 'WalletBalanceChanged' },
  ]);
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('replay of an identical payload returns the original observed balance after later movements', async () => {
  const { walletId, playerId } = await seedWallet(origin, '100.00');
  const first = submission(walletId, playerId, { money: { amount: '25.00', currency: 'BRL' } });
  const applied = await submit(first, 'key-replay-1');
  expect(applied.status).toBe(200);
  expect(applied.body.balance).toEqual({ amount: '75.00', currency: 'BRL' });

  // A later, different transaction moves the balance further.
  const second = submission(walletId, playerId, { money: { amount: '20.00', currency: 'BRL' } });
  const later = await submit(second, 'key-replay-2');
  expect(later.body.balance).toEqual({ amount: '55.00', currency: 'BRL' });

  // Replaying the first submission must not apply again nor report the new balance.
  const replay = await submit(first, 'key-replay-1');
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual({
    transactionId: applied.body.transactionId,
    status: 'PROCESSED',
    balance: { amount: '75.00', currency: 'BRL' },
    idempotentReplay: true,
  });

  const count = (await infra.query('app',
    `select count(*)::int as count from wagering.wager_transaction
      where provider_id = 'acme' and external_transaction_id = $1`, [first.externalTransactionId])).rows;
  expect(count).toEqual([{ count: 1 }]);
  const balance = (await infra.query('app',
    'select balance from wagering.wallet where id = $1', [walletId])).rows;
  expect(balance).toEqual([{ balance: '55.00' }]);
  await assertLedgerInvariant((sql, params) => infra.query('app', sql, params), walletId);
});

test('same (providerId, externalTransactionId) with a divergent payload is 409 and applies nothing', async () => {
  const { walletId, playerId } = await seedWallet(origin, '50.00');
  const original = submission(walletId, playerId, { money: { amount: '10.00', currency: 'BRL' } });
  expect((await submit(original, 'key-conflict-1')).status).toBe(200);

  // Same provider identity, different amount and a fresh idempotency key: the
  // key is not the dedup source of truth — the payload hash decides.
  const diverged = submission(walletId, playerId, {
    externalTransactionId: original.externalTransactionId,
    money: { amount: '11.00', currency: 'BRL' },
  });
  const conflict = await submit(diverged, 'key-conflict-2');
  expect(conflict.status).toBe(409);
  expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

  const balance = (await infra.query('app',
    'select balance from wagering.wallet where id = $1', [walletId])).rows;
  expect(balance).toEqual([{ balance: '40.00' }]);
});

test('insufficient funds is 422 with failureCode and a persisted REJECTED transaction', async () => {
  const { walletId, playerId } = await seedWallet(origin, '10.00');
  const response = await submit(submission(walletId, playerId, {
    money: { amount: '100.00', currency: 'BRL' },
  }), 'key-rejected-1');

  expect(response.status).toBe(422);
  // Bun's toMatchObject mutates matched values, so capture the id first.
  const transactionId = response.body.transactionId as string;
  expect(response.body).toMatchObject({
    code: 'TRANSACTION_REJECTED',
    failureCode: 'INSUFFICIENT_FUNDS',
    idempotentReplay: false,
  });
  expect(typeof transactionId).toBe('string');

  const transaction = (await infra.query('app',
    'select status, failure_code, result_balance from wagering.wager_transaction where id = $1',
    [transactionId])).rows;
  expect(transaction).toEqual([{ status: 'REJECTED', failure_code: 'INSUFFICIENT_FUNDS', result_balance: null }]);

  const balance = (await infra.query('app',
    'select balance, version from wagering.wallet where id = $1', [walletId])).rows;
  expect(balance).toEqual([{ balance: '10.00', version: 1 }]);
});

test('REFUND waiting for an unknown reference is 202 PENDING_REFERENCE', async () => {
  const { walletId, playerId } = await seedWallet(origin, '30.00');
  const response = await submit(submission(walletId, playerId, {
    kind: 'REFUND',
    money: { amount: '5.00', currency: 'BRL' },
    referenceExternalTransactionId: 'never-seen-before',
  }), 'key-pending-1');

  expect(response.status).toBe(202);
  // Bun's toMatchObject mutates matched values, so capture the id first.
  const transactionId = response.body.transactionId as string;
  expect(response.body).toMatchObject({ code: 'PENDING_REFERENCE', idempotentReplay: false });
  expect(typeof transactionId).toBe('string');

  const transaction = (await infra.query('app',
    'select status from wagering.wager_transaction where id = $1', [transactionId])).rows;
  expect(transaction).toEqual([{ status: 'PENDING_REFERENCE' }]);
  const balance = (await infra.query('app',
    'select balance from wagering.wallet where id = $1', [walletId])).rows;
  expect(balance).toEqual([{ balance: '30.00' }]);
});

test('structural submission problems are 400 without opening a write path', async () => {
  const { walletId, playerId } = await seedWallet(origin, '10.00');

  const missingKey = await apiJson(`${origin}/wagering/transactions`, postJson(
    `${origin}/wagering/transactions`, submission(walletId, playerId),
  ));
  expect(missingKey.status).toBe(400);
  expect(missingKey.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'Idempotency-Key' });

  const reservedProvider = await submit(submission(walletId, playerId, { providerId: 'internal' }), 'key-400-1');
  expect(reservedProvider.status).toBe(400);
  expect(reservedProvider.body).toMatchObject({ field: 'providerId' });

  const openingKind = await submit(submission(walletId, playerId, { kind: 'OPENING' }), 'key-400-2');
  expect(openingKind.status).toBe(400);
  expect(openingKind.body).toMatchObject({ field: 'kind' });

  const refundWithoutReference = await submit(submission(walletId, playerId, { kind: 'REFUND' }), 'key-400-3');
  expect(refundWithoutReference.status).toBe(400);

  const betWithReference = await submit(submission(walletId, playerId, {
    referenceExternalTransactionId: 'some-bet',
  }), 'key-400-4');
  expect(betWithReference.status).toBe(400);

  const unknownWallet = await submit(submission(crypto.randomUUID(), playerId), 'key-404-1');
  expect(unknownWallet.status).toBe(404);
  expect(unknownWallet.body).toMatchObject({ code: 'NOT_FOUND' });

  const persisted = (await infra.query('app',
    `select count(*)::int as count from wagering.wager_transaction
      where idempotency_key in ('key-400-1', 'key-400-2', 'key-400-3', 'key-400-4', 'key-404-1')`)).rows;
  expect(persisted).toEqual([{ count: 0 }]);
});

test('GET transaction queries return the stored view by id and by provider identity', async () => {
  const { walletId, playerId } = await seedWallet(origin, '100.00');
  const body = submission(walletId, playerId, { money: { amount: '15.00', currency: 'BRL' } });
  const applied = await submit(body, 'key-query-1');
  expect(applied.status).toBe(200);
  const transactionId = applied.body.transactionId as string;

  const byId = await apiJson(`${origin}/wagering/transactions/${transactionId}`);
  expect(byId.status).toBe(200);
  expect(byId.body).toEqual({
    transactionId,
    providerId: 'acme',
    externalTransactionId: body.externalTransactionId,
    kind: 'BET',
    status: 'PROCESSED',
    money: { amount: '15.00', currency: 'BRL' },
    playerId,
    walletId,
    roundId: body.roundId,
    gameId: 'blackjack',
    referenceExternalTransactionId: null,
    referenceTransactionId: null,
    failureCode: null,
    resultBalance: { amount: '85.00', currency: 'BRL' },
    createdAt: expect.any(String),
    processedAt: expect.any(String),
  });

  const byIdentity = await apiJson(
    `${origin}/providers/acme/wagering/transactions/${encodeURIComponent(body.externalTransactionId as string)}`,
  );
  expect(byIdentity.status).toBe(200);
  expect(byIdentity.body).toEqual(byId.body);

  const unknownId = await apiJson(`${origin}/wagering/transactions/${crypto.randomUUID()}`);
  expect(unknownId.status).toBe(404);
  expect(unknownId.body).toMatchObject({ code: 'NOT_FOUND' });

  const malformedId = await apiJson(`${origin}/wagering/transactions/nope`);
  expect(malformedId.status).toBe(400);
  expect(malformedId.body).toMatchObject({ field: 'transactionId' });

  const unknownIdentity = await apiJson(`${origin}/providers/acme/wagering/transactions/ext-404`);
  expect(unknownIdentity.status).toBe(404);

  const emptyProvider = await apiJson(`${origin}/providers//wagering/transactions/ext-1`);
  expect(emptyProvider.status).toBe(404); // empty segment never reaches the controller
});
