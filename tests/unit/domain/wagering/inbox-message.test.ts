import { expect, test } from 'bun:test';
import {
  computeInboxPayloadHash,
  InboxMessage,
  InvalidInboxStateError,
} from '../../../../src/domain/wagering/inbox-message.js';

const validData = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  idempotencyKey: 'provider-a:transaction-123',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

const receivedAt = new Date('2026-10-11T12:00:00.000Z');
const processedAt = new Date('2026-10-11T12:00:01.000Z');

const receiveProps = {
  messageId: 'msg-123',
  consumerName: 'wager-transaction-consumer',
  payloadHash: computeInboxPayloadHash(validData),
  receivedAt,
};

test('receive creates a message with the informed identity', () => {
  const message = InboxMessage.receive(receiveProps);
  expect(message.messageId).toBe('msg-123');
  expect(message.consumerName).toBe('wager-transaction-consumer');
  expect(message.payloadHash).toBe(computeInboxPayloadHash(validData));
  expect(message.receivedAt).toBe(receivedAt);
});

test('a freshly received message is not processed', () => {
  const message = InboxMessage.receive(receiveProps);
  expect(message.isProcessed()).toBe(false);
  expect(message.processedAt).toBeUndefined();
});

test('markProcessed records the processing timestamp', () => {
  const message = InboxMessage.receive(receiveProps);
  message.markProcessed(processedAt);
  expect(message.processedAt).toBe(processedAt);
});

test('isProcessed flips only after markProcessed', () => {
  const message = InboxMessage.receive(receiveProps);
  expect(message.isProcessed()).toBe(false);
  message.markProcessed(processedAt);
  expect(message.isProcessed()).toBe(true);
});

test('markProcessed cannot run twice', () => {
  const message = InboxMessage.receive(receiveProps);
  message.markProcessed(processedAt);
  expect(() => message.markProcessed(new Date('2026-10-11T12:00:02.000Z'))).toThrow(
    InvalidInboxStateError,
  );
  expect(message.processedAt).toBe(processedAt);
});

test('rehydrate reconstructs a processed message without re-running transitions', () => {
  const message = InboxMessage.rehydrate({
    ...receiveProps,
    receivedAt,
    processedAt,
  });
  expect(message.isProcessed()).toBe(true);
  expect(message.processedAt).toBe(processedAt);
  expect(message.messageId).toBe('msg-123');
  expect(message.consumerName).toBe('wager-transaction-consumer');
  expect(message.payloadHash).toBe(receiveProps.payloadHash);
  expect(message.receivedAt).toBe(receivedAt);
});

test('rehydrate reconstructs a still-pending message', () => {
  const message = InboxMessage.rehydrate({
    ...receiveProps,
    receivedAt,
    processedAt: undefined,
  });
  expect(message.isProcessed()).toBe(false);
  expect(message.processedAt).toBeUndefined();
});

test('identity properties survive receive and rehydrate', () => {
  const received = InboxMessage.receive(receiveProps);
  const rehydrated = InboxMessage.rehydrate({
    messageId: received.messageId,
    consumerName: received.consumerName,
    payloadHash: received.payloadHash,
    receivedAt: received.receivedAt,
    processedAt: received.processedAt,
  });
  for (const m of [received, rehydrated]) {
    expect(m.messageId).toBe(receiveProps.messageId);
    expect(m.consumerName).toBe(receiveProps.consumerName);
    expect(m.payloadHash).toBe(receiveProps.payloadHash);
    expect(m.receivedAt).toBe(receivedAt);
  }
});

test('identity survives markProcessed', () => {
  const message = InboxMessage.receive(receiveProps);
  message.markProcessed(processedAt);
  expect(message.messageId).toBe(receiveProps.messageId);
  expect(message.consumerName).toBe(receiveProps.consumerName);
  expect(message.payloadHash).toBe(receiveProps.payloadHash);
  expect(message.receivedAt).toBe(receivedAt);
});

test('inbox hash is deterministic across key insertion order', () => {
  const reordered = {
    kind: validData.kind,
    gameId: validData.gameId,
    walletId: validData.walletId,
    playerId: validData.playerId,
    idempotencyKey: validData.idempotencyKey,
    externalTransactionId: validData.externalTransactionId,
    providerId: validData.providerId,
    roundId: validData.roundId,
    money: { currency: validData.money.currency, amount: validData.money.amount },
  };
  expect(computeInboxPayloadHash(validData)).toBe(computeInboxPayloadHash(reordered));
});

test('inbox hash is deterministic for nested objects regardless of key order', () => {
  const nested = {
    outer: { inner: { a: '1', b: '2' }, list: [1, 2] },
    top: 'x',
  };
  const reordered = {
    top: 'x',
    outer: { list: [1, 2], inner: { b: '2', a: '1' } },
  };
  expect(computeInboxPayloadHash(nested)).toBe(computeInboxPayloadHash(reordered));
});

test('array element order is preserved in the hash', () => {
  expect(computeInboxPayloadHash({ items: ['a', 'b'] })).not.toBe(
    computeInboxPayloadHash({ items: ['b', 'a'] }),
  );
  expect(computeInboxPayloadHash({ items: ['a', 'b'] })).toBe(
    computeInboxPayloadHash({ items: ['a', 'b'] }),
  );
});

test('a divergent idempotencyKey produces a different hash', () => {
  const other = { ...validData, idempotencyKey: 'provider-a:transaction-999' };
  expect(computeInboxPayloadHash(validData)).not.toBe(computeInboxPayloadHash(other));
});

test('divergent money or business fields produce a different hash', () => {
  expect(computeInboxPayloadHash(validData)).not.toBe(
    computeInboxPayloadHash({ ...validData, money: { ...validData.money, amount: '25.01' } }),
  );
  expect(computeInboxPayloadHash(validData)).not.toBe(
    computeInboxPayloadHash({ ...validData, money: { ...validData.money, currency: 'USD' } }),
  );
  expect(computeInboxPayloadHash(validData)).not.toBe(
    computeInboxPayloadHash({ ...validData, roundId: 'round-999' }),
  );
  expect(computeInboxPayloadHash(validData)).not.toBe(
    computeInboxPayloadHash({ ...validData, kind: 'WIN' }),
  );
});

test('envelope metadata outside data never enters the hash', () => {
  const envelopeA = {
    messageId: 'msg-1',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-07-29T15:00:00.000Z',
    data: validData,
  };
  const envelopeB = {
    messageId: 'msg-2',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-08-01T09:30:00.000Z',
    data: { ...validData },
  };
  expect(computeInboxPayloadHash(envelopeA.data)).toBe(computeInboxPayloadHash(envelopeB.data));
  expect(computeInboxPayloadHash(envelopeA.data)).not.toBe(
    computeInboxPayloadHash({ ...envelopeA.data, messageId: envelopeA.messageId }),
  );
});

test('decimal money strings are hashed verbatim without numeric conversion', () => {
  expect(computeInboxPayloadHash({ money: { amount: '25.00' } })).not.toBe(
    computeInboxPayloadHash({ money: { amount: '25.0' } }),
  );
  expect(computeInboxPayloadHash({ money: { amount: '25.00' } })).not.toBe(
    computeInboxPayloadHash({ money: { amount: 25 } }),
  );
});

test('inbox hash is a sha-256 hex digest', () => {
  expect(computeInboxPayloadHash(validData)).toMatch(/^[0-9a-f]{64}$/);
});

test('receive rejects empty, overlong or whitespace-padded messageId', () => {
  expect(() => InboxMessage.receive({ ...receiveProps, messageId: '' })).toThrow(
    InvalidInboxStateError,
  );
  expect(() => InboxMessage.receive({ ...receiveProps, messageId: '   ' })).toThrow(
    InvalidInboxStateError,
  );
  expect(() => InboxMessage.receive({ ...receiveProps, messageId: ' msg-123 ' })).toThrow(
    InvalidInboxStateError,
  );
  expect(() => InboxMessage.receive({ ...receiveProps, messageId: 'm'.repeat(201) })).toThrow(
    InvalidInboxStateError,
  );
  expect(() => InboxMessage.receive({ ...receiveProps, messageId: 'm'.repeat(200) })).not.toThrow();
});

test('receive rejects empty, overlong or non-string consumerName', () => {
  expect(() => InboxMessage.receive({ ...receiveProps, consumerName: '' })).toThrow(
    InvalidInboxStateError,
  );
  expect(() =>
    InboxMessage.receive({ ...receiveProps, consumerName: 'c'.repeat(101) }),
  ).toThrow(InvalidInboxStateError);
  expect(() =>
    InboxMessage.receive({ ...receiveProps, consumerName: 42 as unknown as string }),
  ).toThrow(InvalidInboxStateError);
});

test('receive rejects a payloadHash that is not a sha-256 hex digest', () => {
  expect(() => InboxMessage.receive({ ...receiveProps, payloadHash: 'not-a-hash' })).toThrow(
    InvalidInboxStateError,
  );
  expect(() => InboxMessage.receive({ ...receiveProps, payloadHash: 'A'.repeat(64) })).toThrow(
    InvalidInboxStateError,
  );
});

test('receive defaults receivedAt to now and rejects invalid dates', () => {
  const message = InboxMessage.receive({
    messageId: receiveProps.messageId,
    consumerName: receiveProps.consumerName,
    payloadHash: receiveProps.payloadHash,
  });
  expect(message.receivedAt).toBeInstanceOf(Date);
  expect(Number.isNaN(message.receivedAt.getTime())).toBe(false);
  expect(() =>
    InboxMessage.receive({ ...receiveProps, receivedAt: new Date('invalid') }),
  ).toThrow(InvalidInboxStateError);
});

test('markProcessed rejects an invalid date', () => {
  const message = InboxMessage.receive(receiveProps);
  expect(() => message.markProcessed(new Date('invalid'))).toThrow(InvalidInboxStateError);
  expect(message.isProcessed()).toBe(false);
});

test('computeInboxPayloadHash rejects non-object data', () => {
  expect(() => computeInboxPayloadHash(null as unknown as Record<string, unknown>)).toThrow(
    InvalidInboxStateError,
  );
  expect(() =>
    computeInboxPayloadHash(['array'] as unknown as Record<string, unknown>),
  ).toThrow(InvalidInboxStateError);
  expect(() => computeInboxPayloadHash('str' as unknown as Record<string, unknown>)).toThrow(
    InvalidInboxStateError,
  );
});
