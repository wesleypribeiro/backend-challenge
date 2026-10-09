import { expect, test } from 'bun:test';
import {
  assertValidBusinessIdentifiers,
  InvalidBusinessIdentifierError,
  type BusinessIdentifiersInput,
} from '../../../../src/domain/wagering/business-identifiers.js';

const valid: BusinessIdentifiersInput = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  idempotencyKey: 'provider-a:transaction-123',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
};

test('a valid submission passes untouched', () => {
  expect(() => assertValidBusinessIdentifiers(valid)).not.toThrow();
  expect(() => assertValidBusinessIdentifiers({ ...valid, referenceExternalTransactionId: 'bet-1' }))
    .not.toThrow();
});

test('playerId and walletId must be UUIDs', () => {
  expect(() => assertValidBusinessIdentifiers({ ...valid, playerId: 'not-a-uuid' }))
    .toThrow(InvalidBusinessIdentifierError);
  expect(() => assertValidBusinessIdentifiers({ ...valid, playerId: 'p1' }))
    .toThrow(/playerId must be a UUID/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, walletId: 'w1' }))
    .toThrow(/walletId must be a UUID/);
  // Uppercase UUID is not the canonical textual form.
  expect(() => assertValidBusinessIdentifiers({
    ...valid,
    playerId: '0192F28F-5DC0-7D58-BDB2-814AD6A0F4A1',
  })).toThrow(/playerId must be a UUID/);
});

test('empty strings are rejected on every required identifier', () => {
  for (const field of ['providerId', 'externalTransactionId', 'idempotencyKey', 'roundId', 'gameId'] as const) {
    expect(() => assertValidBusinessIdentifiers({ ...valid, [field]: '' }))
      .toThrow(new RegExp(`${field} must not be empty`));
  }
});

test('non-string values are rejected with the field name', () => {
  expect(() => assertValidBusinessIdentifiers({ ...valid, providerId: 42 as unknown as string }))
    .toThrow(/providerId must be a string/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, roundId: null as unknown as string }))
    .toThrow(/roundId must be a string/);
});

test('size limits are enforced per field', () => {
  expect(() => assertValidBusinessIdentifiers({ ...valid, providerId: 'p'.repeat(65) }))
    .toThrow(/providerId must have at most 64 characters/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, externalTransactionId: 'e'.repeat(129) }))
    .toThrow(/externalTransactionId must have at most 128 characters/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, idempotencyKey: 'k'.repeat(256) }))
    .toThrow(/idempotencyKey must have at most 255 characters/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, roundId: 'r'.repeat(65) }))
    .toThrow(/roundId must have at most 64 characters/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, gameId: 'g'.repeat(65) }))
    .toThrow(/gameId must have at most 64 characters/);
});

test('the optional reference id is validated only when informed', () => {
  expect(() => assertValidBusinessIdentifiers({ ...valid, referenceExternalTransactionId: '' }))
    .toThrow(/referenceExternalTransactionId must not be empty/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, referenceExternalTransactionId: 'r'.repeat(129) }))
    .toThrow(/referenceExternalTransactionId must have at most 128 characters/);
  expect(() => assertValidBusinessIdentifiers({ ...valid, referenceExternalTransactionId: undefined }))
    .not.toThrow();
});

test('error carries the offending field for HTTP mapping', () => {
  try {
    assertValidBusinessIdentifiers({ ...valid, gameId: '' });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidBusinessIdentifierError);
    expect((error as InvalidBusinessIdentifierError).field).toBe('gameId');
  }
});
