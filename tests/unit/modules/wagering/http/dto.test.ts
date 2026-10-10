import { expect, test } from 'bun:test';
import {
  parseIdempotencyKeyHeader,
  parseSubmissionBody,
} from '../../../../../src/modules/wagering/http/dto.js';
import { InvalidPayloadError } from '../../../../../src/platform/http/invalid-payload.js';

const VALID = {
  providerId: 'acme',
  externalTransactionId: 'bet-1',
  playerId: '11111111-1111-4111-8111-111111111111',
  walletId: '22222222-2222-4222-8222-222222222222',
  roundId: 'round-1',
  gameId: 'blackjack',
  kind: 'BET',
  money: { amount: '25.00', currency: 'EUR' },
};

test('parseSubmissionBody accepts a valid BET payload', () => {
  const parsed = parseSubmissionBody(VALID);
  expect(parsed).toEqual({
    providerId: 'acme',
    externalTransactionId: 'bet-1',
    playerId: VALID.playerId,
    walletId: VALID.walletId,
    roundId: 'round-1',
    gameId: 'blackjack',
    kind: 'BET',
    amount: '25.00',
    currency: 'EUR',
    referenceExternalTransactionId: undefined,
  });
});

test('parseSubmissionBody keeps a provided referenceExternalTransactionId', () => {
  const parsed = parseSubmissionBody({ ...VALID, kind: 'WIN', referenceExternalTransactionId: 'bet-1' });
  expect(parsed.kind).toBe('WIN');
  expect(parsed.referenceExternalTransactionId).toBe('bet-1');
});

test('parseSubmissionBody rejects the reserved internal providerId', () => {
  expect(() => parseSubmissionBody({ ...VALID, providerId: 'internal' }))
    .toThrow(/reserved for internal operations/);
});

test('parseSubmissionBody rejects an OPENING kind at the boundary', () => {
  expect(() => parseSubmissionBody({ ...VALID, kind: 'OPENING' })).toThrow(/kind must be one of/);
});

test('parseSubmissionBody names the offending identifier fields', () => {
  expect(() => parseSubmissionBody({ ...VALID, providerId: '' })).toThrow(/providerId/);
  expect(() => parseSubmissionBody({ ...VALID, externalTransactionId: '  ' }))
    .toThrow(/externalTransactionId/);
  expect(() => parseSubmissionBody({ ...VALID, roundId: 'x'.repeat(65) }))
    .toThrow(/roundId/);
  expect(() => parseSubmissionBody({ ...VALID, playerId: 'nope' })).toThrow(/playerId must be a UUID/);
  expect(() => parseSubmissionBody({ ...VALID, walletId: 'nope' })).toThrow(/walletId must be a UUID/);
});

test('parseSubmissionBody rejects a zero or negative money amount', () => {
  expect(() => parseSubmissionBody({ ...VALID, money: { amount: '0.00', currency: 'EUR' } }))
    .toThrow(/must be positive/);
  expect(() => parseSubmissionBody({ ...VALID, money: { amount: '-5.00', currency: 'EUR' } }))
    .toThrow(/must be positive/);
});

test('parseSubmissionBody rejects a malformed money object', () => {
  expect(() => parseSubmissionBody({ ...VALID, money: '25.00' })).toThrow(/money/);
  expect(() => parseSubmissionBody({ ...VALID, money: { amount: '25.00' } }))
    .toThrow(/money.currency/);
});

test('parseIdempotencyKeyHeader accepts a normal key', () => {
  expect(parseIdempotencyKeyHeader('key-1')).toBe('key-1');
  expect(parseIdempotencyKeyHeader(['key-2'])).toBe('key-2');
});

test('parseIdempotencyKeyHeader requires the header', () => {
  expect(() => parseIdempotencyKeyHeader(undefined)).toThrow(/required/);
});

test('parseIdempotencyKeyHeader rejects blank or oversized keys', () => {
  expect(() => parseIdempotencyKeyHeader('')).toThrow(/must not be empty/);
  expect(() => parseIdempotencyKeyHeader('   ')).toThrow(/must not be empty/);
  expect(() => parseIdempotencyKeyHeader('k'.repeat(256))).toThrow(/at most 255/);
});
