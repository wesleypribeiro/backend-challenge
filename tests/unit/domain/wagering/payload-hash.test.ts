import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import { computePayloadHash } from '../../../../src/domain/wagering/payload-hash.js';

const base = {
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  playerId: 'p1',
  walletId: 'w1',
  roundId: 'r1',
  gameId: 'fortune-chimp',
  kind: 'BET',
  money: Money.from({ amount: '25.00', currency: 'BRL' }),
};

test('identical payloads produce the same hash', () => {
  expect(computePayloadHash(base)).toBe(computePayloadHash({ ...base }));
});

test('hash is independent of field insertion order', () => {
  const reordered = {
    gameId: base.gameId,
    kind: base.kind,
    money: base.money,
    playerId: base.playerId,
    providerId: base.providerId,
    externalTransactionId: base.externalTransactionId,
    roundId: base.roundId,
    walletId: base.walletId,
  };
  expect(computePayloadHash(base)).toBe(computePayloadHash(reordered));
});

test('divergent amount produces a different hash', () => {
  const other = { ...base, money: Money.from({ amount: '25.01', currency: 'BRL' }) };
  expect(computePayloadHash(base)).not.toBe(computePayloadHash(other));
});

test('divergent currency produces a different hash', () => {
  const other = { ...base, money: Money.from({ amount: '25.00', currency: 'USD' }) };
  expect(computePayloadHash(base)).not.toBe(computePayloadHash(other));
});

test('divergent reference produces a different hash', () => {
  const withRef = { ...base, referenceExternalTransactionId: 'ext-0' };
  expect(computePayloadHash(base)).not.toBe(computePayloadHash(withRef));
});

test('missing reference and explicit null reference hash identically', () => {
  const missing = { ...base };
  const explicitNull = { ...base, referenceExternalTransactionId: undefined };
  expect(computePayloadHash(missing)).toBe(computePayloadHash(explicitNull));
});

test('divergent business field produces a different hash', () => {
  expect(computePayloadHash(base)).not.toBe(computePayloadHash({ ...base, roundId: 'r2' }));
  expect(computePayloadHash(base)).not.toBe(computePayloadHash({ ...base, playerId: 'p2' }));
  expect(computePayloadHash(base)).not.toBe(computePayloadHash({ ...base, kind: 'WIN' }));
});

test('hash is a sha-256 hex digest', () => {
  expect(computePayloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
});
