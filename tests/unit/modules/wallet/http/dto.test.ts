import { expect, test } from 'bun:test';
import { parseCreateWalletBody } from '../../../../../src/modules/wallet/http/dto.js';
import { InvalidPayloadError } from '../../../../../src/platform/http/invalid-payload.js';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

test('parseCreateWalletBody accepts a valid body and normalizes the money', () => {
  const parsed = parseCreateWalletBody({
    playerId: PLAYER_ID,
    initialBalance: { amount: '10.00', currency: 'EUR' },
  });
  expect(parsed).toEqual({
    playerId: PLAYER_ID,
    initialBalance: { amount: '10.00', currency: 'EUR' },
  });
});

test('parseCreateWalletBody accepts a zero opening balance', () => {
  const parsed = parseCreateWalletBody({
    playerId: PLAYER_ID,
    initialBalance: { amount: '0.00', currency: 'USD' },
  });
  expect(parsed.initialBalance).toEqual({ amount: '0.00', currency: 'USD' });
});

test('parseCreateWalletBody rejects a non-object body naming body', () => {
  expect(() => parseCreateWalletBody('nope')).toThrow(InvalidPayloadError);
  expect(() => parseCreateWalletBody(null)).toThrow(InvalidPayloadError);
  expect(() => parseCreateWalletBody([])).toThrow(InvalidPayloadError);
});

test('parseCreateWalletBody rejects a missing or malformed playerId', () => {
  expect(() => parseCreateWalletBody({ initialBalance: { amount: '1.00', currency: 'EUR' } }))
    .toThrow(/playerId/);
  expect(() => parseCreateWalletBody({ playerId: 'x', initialBalance: { amount: '1.00', currency: 'EUR' } }))
    .toThrow(/playerId must be a UUID/);
});

test('parseCreateWalletBody rejects a malformed initialBalance with the field path', () => {
  expect(() => parseCreateWalletBody({ playerId: PLAYER_ID, initialBalance: '10' }))
    .toThrow(/initialBalance/);
  expect(() => parseCreateWalletBody({ playerId: PLAYER_ID, initialBalance: { currency: 'EUR' } }))
    .toThrow(/initialBalance.amount/);
  expect(() => parseCreateWalletBody({ playerId: PLAYER_ID, initialBalance: { amount: '10.00' } }))
    .toThrow(/initialBalance.currency/);
});

test('parseCreateWalletBody rejects an invalid money format or currency via Money', () => {
  expect(() => parseCreateWalletBody({
    playerId: PLAYER_ID,
    initialBalance: { amount: '10.005', currency: 'EUR' },
  })).toThrow(InvalidPayloadError);
  expect(() => parseCreateWalletBody({
    playerId: PLAYER_ID,
    initialBalance: { amount: '10.00', currency: 'euros' },
  })).toThrow(InvalidPayloadError);
});

test('parseCreateWalletBody rejects a negative opening balance', () => {
  expect(() => parseCreateWalletBody({
    playerId: PLAYER_ID,
    initialBalance: { amount: '-1.00', currency: 'EUR' },
  })).toThrow(/cannot be negative/);
});
