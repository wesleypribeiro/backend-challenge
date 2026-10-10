import { Body, Controller, Get, Headers, HttpCode, HttpException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { NoopAuthGuard } from '../../../platform/auth/noop-auth.guard.js';
import { IDENTIFIER_MAX_LENGTH } from '../../../domain/wagering/business-identifiers.js';
import { parseIdentifierPath, parseUuidPath } from '../../../platform/http/path-params.js';
import { ProcessWagerTransaction } from '../application/process-wager-transaction.js';
import type { ProcessWagerTransactionResult } from '../application/process-wager-transaction.js';
import { GetTransaction } from '../application/get-transaction.js';
import { parseIdempotencyKeyHeader, parseSubmissionBody } from './dto.js';

/**
 * Transaction HTTP surface (README §9). POST delegates to the single
 * processing use case (the future SQS consumer reuses it too); the header
 * Idempotency-Key is the source of truth and never enters the payload hash.
 * Result-to-status mapping keeps the five provider situations distinguishable:
 * 200 processed/replay, 202 pending reference, 409 idempotency conflict,
 * 422 business rejection, 400 structural, 404 unknown, 503 transient.
 */
@Controller()
@UseGuards(NoopAuthGuard)
export class WageringController {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  @Post('wagering/transactions')
  @HttpCode(200)
  async submit(
    @Headers('idempotency-key') idempotencyKeyHeader: string | string[] | undefined,
    @Body() body: unknown,
  ) {
    const idempotencyKey = parseIdempotencyKeyHeader(idempotencyKeyHeader);
    const input = parseSubmissionBody(body);
    const result = await new ProcessWagerTransaction(this.em).execute({ ...input, idempotencyKey });
    return toSubmissionResponse(result);
  }

  @Get('wagering/transactions/:transactionId')
  async getById(@Param('transactionId') transactionId: string) {
    return new GetTransaction(this.em).byId(parseUuidPath('transactionId', transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async byProviderIdentity(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return new GetTransaction(this.em).byProviderIdentity(
      parseIdentifierPath('providerId', providerId, IDENTIFIER_MAX_LENGTH.providerId),
      parseIdentifierPath('externalTransactionId', externalTransactionId, IDENTIFIER_MAX_LENGTH.externalTransactionId),
    );
  }
}

/**
 * Maps the use-case discriminated union onto the status contract without
 * collapsing situations: replay preserves the original observed balance.
 * Exported for direct unit testing of every status branch.
 */
export function toSubmissionResponse(result: ProcessWagerTransactionResult): unknown {
  switch (result.outcome) {
    case 'processed':
      return {
        transactionId: result.transactionId,
        status: 'PROCESSED',
        balance: result.balance,
        idempotentReplay: result.idempotentReplay,
      };
    case 'rejected':
      throw new HttpException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'TRANSACTION_REJECTED',
        message: 'Transaction was rejected by a business rule',
        transactionId: result.transactionId,
        failureCode: result.failureCode,
        idempotentReplay: result.idempotentReplay,
      }, 422);
    case 'pendingReference':
      throw new HttpException({
        statusCode: 202,
        error: 'Accepted',
        code: 'PENDING_REFERENCE',
        message: 'Transaction accepted, waiting for its reference',
        transactionId: result.transactionId,
        idempotentReplay: result.idempotentReplay,
      }, 202);
    case 'conflict':
      throw new HttpException({
        statusCode: 409,
        error: 'Conflict',
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'The same Idempotency-Key arrived with a different payload',
        transactionId: result.transactionId,
      }, 409);
  }
}
