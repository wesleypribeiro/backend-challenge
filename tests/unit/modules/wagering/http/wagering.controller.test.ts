import { expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import { toSubmissionResponse } from '../../../../../src/modules/wagering/http/wagering.controller.js';
import { NoopAuthGuard } from '../../../../../src/platform/auth/noop-auth.guard.js';

test('processed maps to 200 with the replay flag and the resulting balance', () => {
  const body = toSubmissionResponse({
    outcome: 'processed',
    transactionId: 'tx-1',
    balance: { amount: '75.00', currency: 'EUR' },
    idempotentReplay: false,
  });
  expect(body).toEqual({
    transactionId: 'tx-1',
    status: 'PROCESSED',
    balance: { amount: '75.00', currency: 'EUR' },
    idempotentReplay: false,
  });
});

test('rejected maps to 422 TRANSACTION_REJECTED carrying failureCode', () => {
  try {
    toSubmissionResponse({
      outcome: 'rejected',
      transactionId: 'tx-2',
      failureCode: 'INSUFFICIENT_FUNDS',
      idempotentReplay: false,
    });
    throw new Error('expected HttpException');
  } catch (exception) {
    expect(exception).toBeInstanceOf(HttpException);
    const http = exception as HttpException;
    expect(http.getStatus()).toBe(422);
    expect(http.getResponse()).toMatchObject({
      statusCode: 422,
      code: 'TRANSACTION_REJECTED',
      transactionId: 'tx-2',
      failureCode: 'INSUFFICIENT_FUNDS',
      idempotentReplay: false,
    });
  }
});

test('pendingReference maps to 202 PENDING_REFERENCE', () => {
  try {
    toSubmissionResponse({ outcome: 'pendingReference', transactionId: 'tx-3', idempotentReplay: false });
    throw new Error('expected HttpException');
  } catch (exception) {
    const http = exception as HttpException;
    expect(http.getStatus()).toBe(202);
    expect(http.getResponse()).toMatchObject({ code: 'PENDING_REFERENCE', transactionId: 'tx-3' });
  }
});

test('conflict maps to 409 IDEMPOTENCY_CONFLICT', () => {
  try {
    toSubmissionResponse({ outcome: 'conflict', transactionId: 'tx-4', idempotentReplay: false });
    throw new Error('expected HttpException');
  } catch (exception) {
    const http = exception as HttpException;
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', transactionId: 'tx-4' });
  }
});

test('NoopAuthGuard always admits (documented auth extension point)', () => {
  expect(new NoopAuthGuard().canActivate()).toBe(true);
});
