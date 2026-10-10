import 'reflect-metadata';
import { expect, test } from 'bun:test';
import { apiJson, startApi } from '../support/api.js';

// No isolated containers: the API is configured against a closed port, which
// exercises the real driver failure path end to end (ECONNREFUSED → filter).
test('endpoints fail with 503 SERVICE_UNAVAILABLE while PostgreSQL is unreachable', async () => {
  const api = await startApi(undefined, {
    DATABASE_URL: 'postgresql://wagering_app:irrelevant@127.0.0.1:1/wagering_unreachable',
  });
  try {
    const create = await apiJson(`${api.origin}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: crypto.randomUUID(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
    });
    expect(create.status).toBe(503);
    expect(create.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    // No driver internals leak into the contract.
    expect(JSON.stringify(create.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|wagering_unreachable/);

    const wallet = await apiJson(`${api.origin}/wallets/${crypto.randomUUID()}`);
    expect(wallet.status).toBe(503);
    expect(wallet.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const ledger = await apiJson(`${api.origin}/wallets/${crypto.randomUUID()}/ledger`);
    expect(ledger.status).toBe(503);

    const submit = await apiJson(`${api.origin}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'unreachable-1' },
      body: JSON.stringify({
        providerId: 'acme',
        externalTransactionId: 'ext-unreachable',
        playerId: crypto.randomUUID(),
        walletId: crypto.randomUUID(),
        roundId: 'r-1',
        gameId: 'g-1',
        kind: 'BET',
        money: { amount: '1.00', currency: 'BRL' },
      }),
    });
    expect(submit.status).toBe(503);
    expect(submit.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  } finally {
    await api.close();
  }
}, 30_000);

test('unknown routes keep the Nest 404 contract through the global filter', async () => {
  // Structural 400s do not need a database; the app can boot against the
  // closed port and the filter must pass Nest HttpExceptions through.
  const api = await startApi(undefined, {
    DATABASE_URL: 'postgresql://wagering_app:irrelevant@127.0.0.1:1/wagering_unreachable',
  });
  try {
    const missing = await apiJson(`${api.origin}/unimplemented`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ message: expect.stringContaining('Cannot GET') });

    const badWalletId = await apiJson(`${api.origin}/wallets/not-a-uuid`);
    expect(badWalletId.status).toBe(400);
    expect(badWalletId.body).toMatchObject({ code: 'INVALID_PAYLOAD', field: 'walletId' });
  } finally {
    await api.close();
  }
}, 30_000);
