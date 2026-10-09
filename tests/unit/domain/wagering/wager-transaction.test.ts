import { expect, test } from 'bun:test';
import { Money } from '../../../../src/domain/wallet/money.js';
import { LedgerDirection } from '../../../../src/domain/wallet/ledger-entry.js';
import {
  InvalidTransactionStateError,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../../src/domain/wagering/wager-transaction.js';
import { FailureCode } from '../../../../src/domain/wagering/failure-code.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const betProps = {
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  payloadHash: 'hash-1',
  walletId: 'w1',
  playerId: 'p1',
  roundId: 'r1',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.Bet,
  money: brl('25.00'),
};

test('create starts a provider transaction in PENDING with no terminal fields', () => {
  const tx = WagerTransaction.create(betProps);
  expect(tx.status).toBe(WagerTransactionStatus.Pending);
  expect(tx.isTerminal()).toBe(false);
  expect(tx.processedAt).toBeUndefined();
  expect(tx.failureCode).toBeUndefined();
  expect(tx.referenceTransactionId).toBeUndefined();
  expect(tx.createdAt).toBeInstanceOf(Date);
});

test('create rejects OPENING — it is internal only', () => {
  expect(() => WagerTransaction.create({ ...betProps, kind: WagerTransactionKind.Opening }))
    .toThrow(InvalidTransactionStateError);
});

test('REFUND without a reference is rejected at creation', () => {
  expect(() => WagerTransaction.create({ ...betProps, kind: WagerTransactionKind.Refund }))
    .toThrow(/requires referenceExternalTransactionId/);
});

test('ROLLBACK without a reference is rejected at creation', () => {
  expect(() => WagerTransaction.create({ ...betProps, kind: WagerTransactionKind.Rollback }))
    .toThrow(/requires referenceExternalTransactionId/);
});

test('BET with a reference is rejected at creation', () => {
  expect(() => WagerTransaction.create({
    ...betProps,
    referenceExternalTransactionId: 'ext-0',
  })).toThrow(/must not carry referenceExternalTransactionId/);
});

test('WIN with an optional BET reference is accepted', () => {
  const win = WagerTransaction.create({
    ...betProps,
    kind: WagerTransactionKind.Win,
    referenceExternalTransactionId: 'ext-0',
  });
  expect(win.referenceExternalTransactionId).toBe('ext-0');
  expect(win.requiresReference()).toBe(false);
});

test('LOSS with a reference is rejected at creation', () => {
  expect(() => WagerTransaction.create({
    ...betProps,
    kind: WagerTransactionKind.Loss,
    referenceExternalTransactionId: 'ext-0',
  })).toThrow(/must not carry referenceExternalTransactionId/);
});

test('REFUND with a reference is accepted and requiresReference/affectsBalance hold', () => {
  const tx = WagerTransaction.create({
    ...betProps,
    kind: WagerTransactionKind.Refund,
    referenceExternalTransactionId: 'ext-1',
  });
  expect(tx.requiresReference()).toBe(true);
  expect(tx.affectsBalance()).toBe(true);
  expect(tx.referenceExternalTransactionId).toBe('ext-1');
});

test('zero or negative amounts are rejected at creation', () => {
  expect(() => WagerTransaction.create({ ...betProps, money: brl('0.00') }))
    .toThrow(/must be positive/);
  expect(() => WagerTransaction.create({ ...betProps, money: brl('-5.00') }))
    .toThrow(/must be positive/);
});

test('unrecognized kind is rejected at creation', () => {
  expect(() => WagerTransaction.create({ ...betProps, kind: 'COINFLIP' as WagerTransactionKind }))
    .toThrow(/Unrecognized transaction kind/);
});

test('markProcessed sets terminal status, reference and processedAt', () => {
  const tx = WagerTransaction.create(betProps);
  const at = new Date('2026-10-09T12:00:00Z');
  tx.markProcessed('ref-tx-9', at, brl('75.00'));
  expect(tx.status).toBe(WagerTransactionStatus.Processed);
  expect(tx.isTerminal()).toBe(true);
  expect(tx.referenceTransactionId).toBe('ref-tx-9');
  expect(tx.processedAt).toBe(at);
});

test('transitions out of a terminal state raise InvalidTransactionStateError', () => {
  const processed = WagerTransaction.create(betProps);
  processed.markProcessed(undefined, new Date(), brl('75.00'));
  expect(() => processed.markProcessed(undefined, new Date(), brl('75.00'))).toThrow(InvalidTransactionStateError);
  expect(() => processed.markPendingReference()).toThrow(InvalidTransactionStateError);
  expect(() => processed.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
  expect(() => processed.fail(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);

  const rejected = WagerTransaction.create({ ...betProps, id: 'tx-2', externalTransactionId: 'ext-2', idempotencyKey: 'k2' });
  rejected.reject(FailureCode.InsufficientFunds);
  expect(rejected.status).toBe(WagerTransactionStatus.Rejected);
  expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);
  expect(rejected.processedAt).toBeInstanceOf(Date);
  expect(() => rejected.markProcessed(undefined, new Date(), brl('75.00'))).toThrow(InvalidTransactionStateError);
});

test('failed is terminal and carries the failure code', () => {
  const tx = WagerTransaction.create(betProps);
  tx.fail(FailureCode.ReferenceNotFound);
  expect(tx.status).toBe(WagerTransactionStatus.Failed);
  expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
  expect(tx.isTerminal()).toBe(true);
});

test('markPendingReference requires a reference kind', () => {
  const refund = WagerTransaction.create({
    ...betProps,
    id: 'tx-3',
    kind: WagerTransactionKind.Refund,
    referenceExternalTransactionId: 'ext-9',
  });
  refund.markPendingReference();
  expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
  expect(refund.isTerminal()).toBe(false);

  const bet = WagerTransaction.create({ ...betProps, id: 'tx-4' });
  expect(() => bet.markPendingReference()).toThrow(/does not require a reference/);
});

test('a PENDING_REFERENCE transaction can later be processed', () => {
  const refund = WagerTransaction.create({
    ...betProps,
    kind: WagerTransactionKind.Refund,
    referenceExternalTransactionId: 'ext-9',
  });
  refund.markPendingReference();
  refund.markProcessed('ref-found', new Date(), brl('125.00'));
  expect(refund.status).toBe(WagerTransactionStatus.Processed);
  expect(refund.referenceTransactionId).toBe('ref-found');
});

test('affectsBalance is false only for LOSS', () => {
  const loss = WagerTransaction.create({ ...betProps, kind: WagerTransactionKind.Loss });
  expect(loss.affectsBalance()).toBe(false);
  expect(WagerTransaction.create(betProps).affectsBalance()).toBe(true);
});

test('requiresReference is true only for REFUND and ROLLBACK', () => {
  const kinds: [WagerTransactionKind, boolean][] = [
    [WagerTransactionKind.Bet, false],
    [WagerTransactionKind.Win, false],
    [WagerTransactionKind.Loss, false],
    [WagerTransactionKind.Refund, true],
    [WagerTransactionKind.Rollback, true],
  ];
  for (const [kind, expected] of kinds) {
    const tx = WagerTransaction.create({
      ...betProps,
      kind,
      ...(expected ? { referenceExternalTransactionId: 'ext-0' } : {}),
    });
    expect(tx.requiresReference()).toBe(expected);
  }
});

test('matchesPayload compares the stored hash', () => {
  const tx = WagerTransaction.create(betProps);
  expect(tx.matchesPayload('hash-1')).toBe(true);
  expect(tx.matchesPayload('hash-2')).toBe(false);
});

test('ledgerDirectionFor maps BET/WIN/REFUND and inverts for ROLLBACK', () => {
  const bet = WagerTransaction.create(betProps);
  expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

  const win = WagerTransaction.create({ ...betProps, id: 'w', kind: WagerTransactionKind.Win, externalTransactionId: 'w1', idempotencyKey: 'wk' });
  expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

  const refund = WagerTransaction.create({
    ...betProps,
    id: 'rf',
    kind: WagerTransactionKind.Refund,
    externalTransactionId: 'rf1',
    idempotencyKey: 'rfk',
    referenceExternalTransactionId: 'ext-1',
  });
  expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

  const rollbackOfBet = WagerTransaction.create({
    ...betProps,
    id: 'rb',
    kind: WagerTransactionKind.Rollback,
    externalTransactionId: 'rb1',
    idempotencyKey: 'rbk',
    referenceExternalTransactionId: 'ext-1',
  });
  expect(rollbackOfBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);

  const winRef = WagerTransaction.create({ ...betProps, id: 'w2', kind: WagerTransactionKind.Win, externalTransactionId: 'w2', idempotencyKey: 'w2k' });
  const rollbackOfWin = WagerTransaction.create({
    ...betProps,
    id: 'rb2',
    kind: WagerTransactionKind.Rollback,
    externalTransactionId: 'rb2',
    idempotencyKey: 'rb2k',
    referenceExternalTransactionId: 'ext-2',
  });
  expect(rollbackOfWin.ledgerDirectionFor(winRef)).toBe(LedgerDirection.Debit);
});

test('ledgerDirectionFor raises for LOSS and for ROLLBACK without a reference', () => {
  const loss = WagerTransaction.create({ ...betProps, kind: WagerTransactionKind.Loss });
  expect(() => loss.ledgerDirectionFor()).toThrow(InvalidTransactionStateError);

  const rollback = WagerTransaction.create({
    ...betProps,
    id: 'rb3',
    kind: WagerTransactionKind.Rollback,
    externalTransactionId: 'rb3',
    idempotencyKey: 'rb3k',
    referenceExternalTransactionId: 'ext-1',
  });
  expect(() => rollback.ledgerDirectionFor()).toThrow(/requires a resolved reference/);
});

test('ledgerDirectionFor raises when ROLLBACK references LOSS or OPENING', () => {
  const lossRef = WagerTransaction.create({ ...betProps, id: 'l1', kind: WagerTransactionKind.Loss, externalTransactionId: 'l1', idempotencyKey: 'l1k' });
  const rollback = WagerTransaction.create({
    ...betProps,
    id: 'rb4',
    kind: WagerTransactionKind.Rollback,
    externalTransactionId: 'rb4',
    idempotencyKey: 'rb4k',
    referenceExternalTransactionId: 'ext-1',
  });
  expect(() => rollback.ledgerDirectionFor(lossRef)).toThrow(/cannot invert a reference of kind LOSS/);
});

test('opening factory is born PROCESSED with canonical internal identifiers', () => {
  const opening = WagerTransaction.opening({
    id: 'tx-open',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'internal',
    gameId: 'internal',
    money: brl('100.00'),
    payloadHash: 'open-hash',
  });
  expect(opening.status).toBe(WagerTransactionStatus.Processed);
  expect(opening.isTerminal()).toBe(true);
  expect(opening.providerId).toBe('internal');
  expect(opening.externalTransactionId).toBe('opening-w1');
  expect(opening.idempotencyKey).toBe('internal:opening-w1');
  expect(opening.kind).toBe(WagerTransactionKind.Opening);
  expect(opening.processedAt).toBeInstanceOf(Date);
  expect(opening.affectsBalance()).toBe(true);
  expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
});

test('opening factory rejects a non-positive amount', () => {
  expect(() => WagerTransaction.opening({
    id: 'tx-open',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'internal',
    gameId: 'internal',
    money: brl('0.00'),
    payloadHash: 'h',
  })).toThrow(/must be positive/);
});

test('rehydrate restores persisted state without revalidation', () => {
  const tx = WagerTransaction.rehydrate({
    ...betProps,
    money: brl('25.00'),
    referenceExternalTransactionId: undefined,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    status: WagerTransactionStatus.Rejected,
    referenceTransactionId: undefined,
    failureCode: FailureCode.InsufficientFunds,
    processedAt: new Date('2026-01-01T00:00:01Z'),
  });
  expect(tx.status).toBe(WagerTransactionStatus.Rejected);
  expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
  expect(tx.isTerminal()).toBe(true);
  expect(() => tx.markProcessed(undefined, new Date(), brl('75.00'))).toThrow(InvalidTransactionStateError);
});
