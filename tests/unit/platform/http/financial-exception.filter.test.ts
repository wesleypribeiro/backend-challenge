import { expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { FinancialExceptionFilter } from '../../../../src/platform/http/financial-exception.filter.js';
import { InvalidPayloadError } from '../../../../src/platform/http/invalid-payload.js';
import { InvalidBusinessIdentifierError } from '../../../../src/domain/wagering/business-identifiers.js';
import { InvalidTransactionStateError } from '../../../../src/domain/wagering/wager-transaction.js';
import {
  InvalidWalletInputError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '../../../../src/modules/wallet/application/errors.js';
import { TransactionNotFoundError } from '../../../../src/modules/wagering/application/errors.js';
import { JsonLogger } from '../../../../src/platform/logging/json-logger.js';

interface Captured {
  status?: number;
  json?: unknown;
  lines: string[];
}

function catchWith(exception: unknown): Captured {
  const captured: Captured = { lines: [] };
  const response = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.json = body; return this; },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;
  const logger = new JsonLogger('api', (line: string) => { captured.lines.push(line); });
  new FinancialExceptionFilter(logger).catch(exception, host);
  return captured;
}

test('InvalidPayloadError becomes 400 INVALID_PAYLOAD with the field', () => {
  const captured = catchWith(new InvalidPayloadError('cursor', 'cursor is not a valid ledger token'));
  expect(captured.status).toBe(400);
  expect(captured.json).toEqual({
    statusCode: 400,
    error: 'Bad Request',
    code: 'INVALID_PAYLOAD',
    message: 'cursor is not a valid ledger token',
    field: 'cursor',
  });
});

test('InvalidWalletInputError becomes 400 INVALID_PAYLOAD', () => {
  const captured = catchWith(new InvalidWalletInputError('initialBalance', 'nope'));
  expect(captured.status).toBe(400);
  expect((captured.json as { code: string }).code).toBe('INVALID_PAYLOAD');
  expect((captured.json as { field: string }).field).toBe('initialBalance');
});

test('InvalidBusinessIdentifierError becomes 400 with its field', () => {
  const captured = catchWith(new InvalidBusinessIdentifierError('providerId', 'bad provider'));
  expect(captured.status).toBe(400);
  expect((captured.json as { field: string }).field).toBe('providerId');
  expect((captured.json as { message: string }).message).toBe('bad provider');
});

test('InvalidTransactionStateError becomes 400 (malformed kind at the boundary)', () => {
  const captured = catchWith(new InvalidTransactionStateError('unrecognized kind'));
  expect(captured.status).toBe(400);
  expect((captured.json as { code: string }).code).toBe('INVALID_PAYLOAD');
});

test('wallet and transaction not-found become 404 NOT_FOUND', () => {
  const wallet = catchWith(new WalletNotFoundError('w-1'));
  expect(wallet.status).toBe(404);
  expect(wallet.json).toMatchObject({ code: 'NOT_FOUND', message: 'Wallet w-1 not found' });

  const transaction = catchWith(new TransactionNotFoundError('p/ext-1'));
  expect(transaction.status).toBe(404);
  expect((transaction.json as { message: string }).message)
    .toBe('Wagering transaction p/ext-1 not found');
});

test('WalletAlreadyExistsError and raw 23505 become 409 CONFLICT', () => {
  const typed = catchWith(new WalletAlreadyExistsError('p-1', 'EUR'));
  expect(typed.status).toBe(409);
  expect((typed.json as { message: string }).message).toMatch(/EUR wallet already exists/);

  const raw = catchWith(Object.assign(new Error('duplicate key value'), { code: '23505' }));
  expect(raw.status).toBe(409);
  expect((raw.json as { code: string }).code).toBe('CONFLICT');
});

test('HttpException passes through with its own status and body', () => {
  const captured = catchWith(new HttpException({
    statusCode: 202,
    error: 'Accepted',
    code: 'PENDING_REFERENCE',
    message: 'Transaction accepted',
    transactionId: 'tx-1',
  }, 202));
  expect(captured.status).toBe(202);
  expect(captured.json).toEqual({
    statusCode: 202,
    error: 'Accepted',
    code: 'PENDING_REFERENCE',
    message: 'Transaction accepted',
    transactionId: 'tx-1',
  });
});

test('transient connection and driver failures become 503 SERVICE_UNAVAILABLE', () => {
  const refused = catchWith(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  expect(refused.status).toBe(503);
  expect((refused.json as { code: string }).code).toBe('SERVICE_UNAVAILABLE');

  const admin = catchWith(Object.assign(new Error('terminating connection'), { code: '57P01' }));
  expect(admin.status).toBe(503);

  const timeout = catchWith(Object.assign(new Error('query timed out'), { name: 'TimeoutError' }));
  expect(timeout.status).toBe(503);

  const aggregate = catchWith(Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  }));
  expect(aggregate.status).toBe(503);
});

test('unexpected errors become a generic 500 and are logged at error level', () => {
  const secret = new Error('password=hunter2 in the connection string');
  const captured = catchWith(secret);
  expect(captured.status).toBe(500);
  expect(captured.json).toEqual({
    statusCode: 500,
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    message: 'Unexpected server error',
  });
  expect(JSON.stringify(captured.json)).not.toContain('hunter2');
  expect(captured.lines.length).toBe(1);
  const record = JSON.parse(captured.lines[0]!) as { event: string; level: string };
  expect(record.event).toBe('http.completed');
  expect(record.level).toBe('error');
});
