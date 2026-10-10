import { expect, test } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ListLedger,
  LEDGER_DEFAULT_LIMIT,
  LEDGER_MAX_LIMIT,
  decodeLedgerCursor,
  encodeLedgerCursor,
  parseLedgerLimit,
} from '../../../../../src/modules/wallet/application/list-ledger.js';
import { InvalidPayloadError } from '../../../../../src/platform/http/invalid-payload.js';
import { WalletNotFoundError } from '../../../../../src/modules/wallet/application/errors.js';

const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';

function ledgerRow(id: string, createdAtIso: string, amount = '10.00') {
  return {
    id,
    walletId: WALLET_ID,
    transactionId: '44444444-4444-4444-8444-444444444444',
    operation: 'BET',
    direction: 'DEBIT',
    amount,
    currency: 'EUR',
    balanceBefore: '10.00',
    balanceAfter: '0.00',
    createdAt: new Date(createdAtIso),
  };
}

test('encode/decode cursor round-trips createdAt and id', () => {
  const createdAt = new Date('2026-01-02T03:04:05.678Z');
  const decoded = decodeLedgerCursor(encodeLedgerCursor({ createdAt, id: ENTRY_ID }));
  expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
  expect(decoded.id).toBe(ENTRY_ID);
});

test('decodeLedgerCursor rejects a malformed token with a 400-shaped error', () => {
  expect(() => decodeLedgerCursor('!!!not-base64-json!!!')).toThrow(InvalidPayloadError);
  expect(() => decodeLedgerCursor(Buffer.from('{"t":"nope","id":"x"}').toString('base64url')))
    .toThrow(InvalidPayloadError);
});

test('parseLedgerLimit defaults, bounds and rejects', () => {
  expect(parseLedgerLimit(undefined)).toBe(LEDGER_DEFAULT_LIMIT);
  expect(parseLedgerLimit('1')).toBe(1);
  expect(parseLedgerLimit(String(LEDGER_MAX_LIMIT))).toBe(LEDGER_MAX_LIMIT);
  expect(() => parseLedgerLimit('0')).toThrow(InvalidPayloadError);
  expect(() => parseLedgerLimit('101')).toThrow(InvalidPayloadError);
  expect(() => parseLedgerLimit('abc')).toThrow(InvalidPayloadError);
  expect(() => parseLedgerLimit('2.5')).toThrow(InvalidPayloadError);
});

test('execute raises WalletNotFoundError for an unknown wallet', async () => {
  const em = { findOne: async () => null } as unknown as EntityManager;
  await expect(new ListLedger(em).execute(WALLET_ID, { limit: 10 }))
    .rejects.toBeInstanceOf(WalletNotFoundError);
});

test('execute returns a full page with nextCursor when more rows exist', async () => {
  const t1 = '2026-01-01T00:00:00.000Z';
  const t2 = '2026-01-01T00:00:01.000Z';
  const rows = [
    ledgerRow(ENTRY_ID, t1),
    ledgerRow('55555555-5555-4555-8555-555555555555', t2),
  ];
  let capturedOptions: { limit?: number } | undefined;
  const em = {
    findOne: async () => ({ id: WALLET_ID }),
    find: async (_schema: unknown, _where: unknown, options: { limit?: number }) => {
      capturedOptions = options;
      return rows;
    },
  } as unknown as EntityManager;

  const page = await new ListLedger(em).execute(WALLET_ID, { limit: 1 });

  expect(capturedOptions?.limit).toBe(2); // limit + 1 lookahead
  expect(page.entries.length).toBe(1);
  expect(page.entries[0]!.id).toBe(ENTRY_ID);
  expect(page.entries[0]!.createdAt).toBe(t1);
  const cursor = decodeLedgerCursor(page.nextCursor!);
  expect(cursor.id).toBe(ENTRY_ID);
  expect(cursor.createdAt.toISOString()).toBe(t1);
});

test('execute returns nextCursor null on a final page', async () => {
  const em = {
    findOne: async () => ({ id: WALLET_ID }),
    find: async () => [ledgerRow(ENTRY_ID, '2026-01-01T00:00:00.000Z')],
  } as unknown as EntityManager;

  const page = await new ListLedger(em).execute(WALLET_ID, { limit: 10 });
  expect(page.entries.length).toBe(1);
  expect(page.nextCursor).toBeNull();
});

test('execute passes the cursor into the keyset filter', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  let capturedWhere: unknown;
  const em = {
    findOne: async () => ({ id: WALLET_ID }),
    find: async (_schema: unknown, where: unknown) => {
      capturedWhere = where;
      return [];
    },
  } as unknown as EntityManager;

  await new ListLedger(em).execute(WALLET_ID, { cursor: { createdAt, id: ENTRY_ID }, limit: 5 });
  expect(capturedWhere).toEqual({
    walletId: WALLET_ID,
    $or: [
      { createdAt: { $gt: createdAt } },
      { createdAt, id: { $gt: ENTRY_ID } },
    ],
  });
});
