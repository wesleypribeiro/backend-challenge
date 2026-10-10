import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import { InvalidPayloadError } from '../../../platform/http/invalid-payload.js';

export interface CreateWalletBody {
  playerId: string;
  initialBalance: MoneyProps;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const asObject = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidPayloadError('body', 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
};

/**
 * Parses and structurally validates POST /wallets. No new validation
 * dependency: explicit field-by-field parsing that names the offending field.
 * Money format/currency guards stay in the Money value object.
 */
export function parseCreateWalletBody(body: unknown): CreateWalletBody {
  const parsed = asObject(body);
  const playerId = parsed.playerId;
  if (typeof playerId !== 'string' || !UUID_PATTERN.test(playerId)) {
    throw new InvalidPayloadError('playerId', 'playerId must be a UUID');
  }
  const initialBalance = parsed.initialBalance;
  if (typeof initialBalance !== 'object' || initialBalance === null || Array.isArray(initialBalance)) {
    throw new InvalidPayloadError('initialBalance', 'initialBalance must be an object with amount and currency');
  }
  const { amount, currency } = initialBalance as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string') {
    throw new InvalidPayloadError('initialBalance.amount', 'initialBalance.amount must be a decimal string');
  }
  if (typeof currency !== 'string') {
    throw new InvalidPayloadError('initialBalance.currency', 'initialBalance.currency must be an ISO 4217 code');
  }
  // Rejects format, currency and negative before the use case runs; Money
  // guards surface as structural 400s naming the field path.
  let money: Money;
  try {
    money = Money.from({ amount, currency });
  } catch (error) {
    throw new InvalidPayloadError('initialBalance', (error as Error).message);
  }
  if (money.isNegative()) {
    throw new InvalidPayloadError('initialBalance', 'initialBalance cannot be negative');
  }
  return { playerId, initialBalance: money.toJSON() };
}
