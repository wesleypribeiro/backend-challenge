/**
 * Structural validation of the business identifiers carried by a submission.
 * Invalid identifiers are malformed payloads, not business rejections: they
 * raise InvalidBusinessIdentifierError before any persistence, so a bad field
 * can never produce a partial write (README §9 — the API must distinguish
 * invalid payload from a persisted rejection).
 */

export class InvalidBusinessIdentifierError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidBusinessIdentifierError';
  }
}

/** UUID v4/v7 textual form used for playerId and walletId (README §9). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const IDENTIFIER_MAX_LENGTH = {
  providerId: 64,
  externalTransactionId: 128,
  idempotencyKey: 255,
  roundId: 64,
  gameId: 64,
} as const;

export interface BusinessIdentifiersInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId?: string | undefined;
}

const assertString = (field: string, value: unknown, maxLength: number, uuid: boolean): void => {
  if (typeof value !== 'string') {
    throw new InvalidBusinessIdentifierError(field, `${field} must be a string, got ${typeof value}`);
  }
  if (value.length === 0) {
    throw new InvalidBusinessIdentifierError(field, `${field} must not be empty`);
  }
  if (value.length > maxLength) {
    throw new InvalidBusinessIdentifierError(
      field,
      `${field} must have at most ${maxLength} characters, got ${value.length}`,
    );
  }
  if (uuid && !UUID_PATTERN.test(value)) {
    throw new InvalidBusinessIdentifierError(field, `${field} must be a UUID, got ${JSON.stringify(value)}`);
  }
};

/**
 * Validates every business identifier of a submission. Throws on the first
 * violation; the optional reference id is validated only when informed.
 */
export function assertValidBusinessIdentifiers(input: BusinessIdentifiersInput): void {
  assertString('providerId', input.providerId, IDENTIFIER_MAX_LENGTH.providerId, false);
  assertString(
    'externalTransactionId',
    input.externalTransactionId,
    IDENTIFIER_MAX_LENGTH.externalTransactionId,
    false,
  );
  assertString('idempotencyKey', input.idempotencyKey, IDENTIFIER_MAX_LENGTH.idempotencyKey, false);
  assertString('playerId', input.playerId, 36, true);
  assertString('walletId', input.walletId, 36, true);
  assertString('roundId', input.roundId, IDENTIFIER_MAX_LENGTH.roundId, false);
  assertString('gameId', input.gameId, IDENTIFIER_MAX_LENGTH.gameId, false);
  if (input.referenceExternalTransactionId !== undefined) {
    assertString(
      'referenceExternalTransactionId',
      input.referenceExternalTransactionId,
      IDENTIFIER_MAX_LENGTH.externalTransactionId,
      false,
    );
  }
}
