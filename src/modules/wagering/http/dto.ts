import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import type { WagerTransactionKind } from '../../../domain/wagering/wager-transaction.js';
import { IDENTIFIER_MAX_LENGTH } from '../../../domain/wagering/business-identifiers.js';
import { InvalidPayloadError } from '../../../platform/http/invalid-payload.js';

/** Business fields of a submission; idempotencyKey arrives via header. */
export interface SubmissionBody {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Provider-submittable kinds; OPENING is reserved for internal operations. */
const SUBMITTABLE_KINDS = new Set(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']);

const asObject = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidPayloadError('body', 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
};

const requireString = (body: Record<string, unknown>, field: string, maxLength: number): string => {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new InvalidPayloadError(field, `${field} must be a string`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new InvalidPayloadError(field, `${field} must not be empty`);
  }
  if (value.length > maxLength) {
    throw new InvalidPayloadError(field, `${field} must have at most ${maxLength} characters`);
  }
  return value;
};

const requireUuid = (body: Record<string, unknown>, field: string): string => {
  const value = requireString(body, field, 36);
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidPayloadError(field, `${field} must be a UUID`);
  }
  return value;
};

/**
 * Parses and structurally validates POST /wagering/transactions. Identifier
 * length/space/reserved rules also live in the domain guard (defense in
 * depth); this parser owns types, required fields, Money and kind so the
 * boundary answers 400 before any SQL transaction opens.
 */
export function parseSubmissionBody(body: unknown): SubmissionBody {
  const parsed = asObject(body);

  const providerId = requireString(parsed, 'providerId', IDENTIFIER_MAX_LENGTH.providerId);
  if (providerId === 'internal') {
    throw new InvalidPayloadError('providerId', 'providerId "internal" is reserved for internal operations');
  }
  const externalTransactionId = requireString(parsed, 'externalTransactionId', IDENTIFIER_MAX_LENGTH.externalTransactionId);
  const playerId = requireUuid(parsed, 'playerId');
  const walletId = requireUuid(parsed, 'walletId');
  const roundId = requireString(parsed, 'roundId', IDENTIFIER_MAX_LENGTH.roundId);
  const gameId = requireString(parsed, 'gameId', IDENTIFIER_MAX_LENGTH.gameId);

  const kind = parsed.kind;
  if (typeof kind !== 'string' || !SUBMITTABLE_KINDS.has(kind)) {
    throw new InvalidPayloadError('kind', `kind must be one of ${[...SUBMITTABLE_KINDS].join(', ')}`);
  }

  const money = parsed.money;
  if (typeof money !== 'object' || money === null || Array.isArray(money)) {
    throw new InvalidPayloadError('money', 'money must be an object with amount and currency');
  }
  const { amount, currency } = money as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string') {
    throw new InvalidPayloadError('money.amount', 'money.amount must be a decimal string');
  }
  if (typeof currency !== 'string') {
    throw new InvalidPayloadError('money.currency', 'money.currency must be an ISO 4217 code');
  }
  let parsedMoney: MoneyProps;
  try {
    parsedMoney = Money.from({ amount, currency }).toJSON();
  } catch (error) {
    throw new InvalidPayloadError('money', (error as Error).message);
  }
  if (Money.from(parsedMoney).isNegative() || Money.from(parsedMoney).isZero()) {
    throw new InvalidPayloadError('money.amount', 'money.amount must be positive');
  }

  const reference = parsed.referenceExternalTransactionId;
  if (reference !== undefined) {
    if (typeof reference !== 'string') {
      throw new InvalidPayloadError('referenceExternalTransactionId', 'referenceExternalTransactionId must be a string');
    }
    if (reference.length === 0 || reference.trim().length === 0) {
      throw new InvalidPayloadError('referenceExternalTransactionId', 'referenceExternalTransactionId must not be empty');
    }
    if (reference.length > IDENTIFIER_MAX_LENGTH.externalTransactionId) {
      throw new InvalidPayloadError(
        'referenceExternalTransactionId',
        `referenceExternalTransactionId must have at most ${IDENTIFIER_MAX_LENGTH.externalTransactionId} characters`,
      );
    }
  }

  return {
    providerId,
    externalTransactionId,
    playerId,
    walletId,
    roundId,
    gameId,
    kind: kind as WagerTransactionKind,
    amount: parsedMoney.amount,
    currency: parsedMoney.currency,
    referenceExternalTransactionId: reference as string | undefined,
  };
}

/**
 * The Idempotency-Key header is required and is the source of truth
 * (README §9): missing, blank or oversized keys are structural 400s.
 */
export function parseIdempotencyKeyHeader(raw: string | string[] | undefined): string {
  if (raw === undefined) {
    throw new InvalidPayloadError('Idempotency-Key', 'Idempotency-Key header is required');
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    throw new InvalidPayloadError('Idempotency-Key', 'Idempotency-Key header must not be empty');
  }
  if (value.length > IDENTIFIER_MAX_LENGTH.idempotencyKey) {
    throw new InvalidPayloadError(
      'Idempotency-Key',
      `Idempotency-Key header must have at most ${IDENTIFIER_MAX_LENGTH.idempotencyKey} characters`,
    );
  }
  return value;
}
