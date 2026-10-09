import { createHash } from 'node:crypto';
import type { Money } from '../wallet/money.js';

export interface WagerPayloadBusinessFields {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: Money;
  referenceExternalTransactionId?: string | undefined;
}

/**
 * Canonical payload hash (README §9): SHA-256 over a sorted-key JSON
 * serialization of the business fields only — transport metadata (headers,
 * timestamps, ids generated locally) never enters the hash. Amount is the
 * fixed 2-place decimal string; a missing reference is serialized as null so
 * its presence/absence is distinguishable from an unrelated field.
 */
export function computePayloadHash(fields: WagerPayloadBusinessFields): string {
  const canonical = canonicalize({
    providerId: fields.providerId,
    externalTransactionId: fields.externalTransactionId,
    playerId: fields.playerId,
    walletId: fields.walletId,
    roundId: fields.roundId,
    gameId: fields.gameId,
    kind: fields.kind,
    amount: fields.money.amountString,
    currency: fields.money.currency,
    referenceExternalTransactionId: fields.referenceExternalTransactionId ?? null,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Recursively sorts object keys so field insertion order cannot change the hash. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',');
  return `{${body}}`;
}
