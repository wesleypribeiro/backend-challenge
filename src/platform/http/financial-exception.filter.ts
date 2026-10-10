import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { InvalidBusinessIdentifierError } from '../../domain/wagering/business-identifiers.js';
import { InvalidTransactionStateError } from '../../domain/wagering/wager-transaction.js';
import {
  InvalidWalletInputError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '../../modules/wallet/application/errors.js';
import { TransactionNotFoundError } from '../../modules/wagering/application/errors.js';
import { InvalidPayloadError } from './invalid-payload.js';
import type { JsonLogger } from '../logging/json-logger.js';

/**
 * Structural view of the Express response the filter drives. Typed by hand to
 * avoid a dependency on @types/express (the runtime response is Express 5).
 */
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

interface HttpRequestLike {
  method?: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  field?: string;
}

interface FilteredResponse {
  status: number;
  body: unknown;
}

/** PostgreSQL driver / connection failure codes that mean "retry later". */
const TRANSIENT_PG_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', // connection exceptions
  '53300', // too many connections
  '57014', // query canceled (statement timeout)
  '57P01', // admin shutdown — retryable
]);
const TRANSIENT_SOCKET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Single mapping from thrown errors to the HTTP error contract (README §9):
 * every body carries statusCode/error/code/message and, when known, the
 * offending field. Stack traces, SQL, credentials and driver details never
 * reach the client — unexpected errors are logged server-side with the
 * correlation id and answered with a generic 500.
 */
@Catch()
export class FinancialExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponseLike>();
    const request = http.getRequest<HttpRequestLike>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) {
      this.logger.event('http.completed', {
        statusCode: status,
        ...(request.method !== undefined ? { method: request.method } : {}),
        error: exception,
      }, 'error');
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): FilteredResponse {
    // Controllers raise HttpException for dynamic statuses (202/409/422) with
    // an already-shaped body; built-ins (e.g. health's 503) carry their own
    // contract. The status comes from the exception, never from the body.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null) {
        return { status, body: payload };
      }
      return {
        status,
        body: { statusCode: status, error: 'Error', code: 'HTTP_ERROR', message: String(payload) } satisfies ErrorBody,
      };
    }
    if (exception instanceof InvalidPayloadError || exception instanceof InvalidWalletInputError) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_PAYLOAD',
          message: exception.message,
          field: exception.field,
        } satisfies ErrorBody,
      };
    }
    if (isInvalidBusinessIdentifier(exception)) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_PAYLOAD',
          message: exception.message,
          field: exception.field,
        } satisfies ErrorBody,
      };
    }
    // OPENING is internal; an unrecognized kind is a malformed payload.
    if (exception instanceof InvalidTransactionStateError) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_PAYLOAD',
          message: exception.message,
        } satisfies ErrorBody,
      };
    }
    if (exception instanceof WalletNotFoundError || exception instanceof TransactionNotFoundError) {
      return {
        status: 404,
        body: {
          statusCode: 404,
          error: 'Not Found',
          code: 'NOT_FOUND',
          message: exception.message,
        } satisfies ErrorBody,
      };
    }
    if (exception instanceof WalletAlreadyExistsError || isUniqueViolation(exception)) {
      return {
        status: 409,
        body: {
          statusCode: 409,
          error: 'Conflict',
          code: 'CONFLICT',
          message: exception instanceof WalletAlreadyExistsError
            ? exception.message
            : 'Conflicting write violates a uniqueness constraint',
        } satisfies ErrorBody,
      };
    }
    if (isTransient(exception)) {
      return {
        status: 503,
        body: {
          statusCode: 503,
          error: 'Service Unavailable',
          code: 'SERVICE_UNAVAILABLE',
          message: 'Transient infrastructure failure, the request can be retried',
        } satisfies ErrorBody,
      };
    }
    return {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
      } satisfies ErrorBody,
    };
  }
}

function isInvalidBusinessIdentifier(error: unknown): error is InvalidBusinessIdentifierError {
  return error instanceof Error && error.name === 'InvalidBusinessIdentifierError'
    && 'field' in error && typeof (error as { field: unknown }).field === 'string';
}

function isTransient(exception: unknown): boolean {
  if (!(exception instanceof Error)) return false;
  if (exception.name === 'TimeoutError' || exception.name === 'AbortError') return true;
  const code = (exception as { code?: unknown }).code;
  if (typeof code === 'string') return TRANSIENT_PG_CODES.has(code) || TRANSIENT_SOCKET_CODES.has(code);
  // Bun wraps ECONNREFUSED in AggregateError / TypeError without a top-level code.
  const cause = (exception as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const inner = (cause as { code?: unknown }).code;
    if (typeof inner === 'string') return TRANSIENT_PG_CODES.has(inner) || TRANSIENT_SOCKET_CODES.has(inner);
  }
  const aggregateErrors = (exception as unknown as { errors?: unknown }).errors;
  if (Array.isArray(aggregateErrors)) {
    return aggregateErrors.some((error) => isTransient(error));
  }
  return false;
}
