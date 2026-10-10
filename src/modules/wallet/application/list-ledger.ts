import type { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import {
  WalletLedgerEntrySchema,
  type WalletLedgerEntryPersistence,
} from '../../../platform/database/entities/wallet-ledger-entry.entity.js';
import { WalletSchema } from '../../../platform/database/entities/wallet.entity.js';
import { InvalidPayloadError } from '../../../platform/http/invalid-payload.js';
import { WalletNotFoundError } from './errors.js';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  operation: string;
  direction: string;
  amount: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface ListLedgerPage {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

export const LEDGER_DEFAULT_LIMIT = 50;
export const LEDGER_MAX_LIMIT = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Opaque, stable keyset cursor over (created_at, id). Base64url of a small
 * JSON object; clients must treat it as opaque (README §9).
 */
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8')
    .toString('base64url');
}

export function decodeLedgerCursor(value: string): LedgerCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidPayloadError('cursor', 'cursor is not a valid ledger token');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidPayloadError('cursor', 'cursor is not a valid ledger token');
  }
  const { t, id } = parsed as { t?: unknown; id?: unknown };
  const createdAt = typeof t === 'string' ? new Date(t) : undefined;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new InvalidPayloadError('cursor', 'cursor is not a valid ledger token');
  }
  return { createdAt, id };
}

export function parseLedgerLimit(raw: string | undefined): number {
  if (raw === undefined) return LEDGER_DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPayloadError('limit', `limit must be an integer between 1 and ${LEDGER_MAX_LIMIT}`);
  }
  const limit = Number(raw);
  if (limit < 1 || limit > LEDGER_MAX_LIMIT) {
    throw new InvalidPayloadError('limit', `limit must be an integer between 1 and ${LEDGER_MAX_LIMIT}`);
  }
  return limit;
}

/**
 * Keyset pagination over the append-only ledger: stable insertion order via
 * (created_at, id), no OFFSET, no duplicates or gaps across pages even when
 * two entries share a timestamp. Fetches limit + 1 rows to know whether a
 * next page exists without a second count query.
 */
export class ListLedger {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string, options: { cursor?: LedgerCursor; limit: number }): Promise<ListLedgerPage> {
    const wallet = await this.em.findOne(WalletSchema, walletId, { fields: ['id'] });
    if (!wallet) throw new WalletNotFoundError(walletId);

    const after = options.cursor;
    const rows = await this.em.find(WalletLedgerEntrySchema, {
      walletId,
      ...(after
        ? {
            $or: [
              { createdAt: { $gt: after.createdAt } },
              { createdAt: after.createdAt, id: { $gt: after.id } },
            ],
          }
        : {}),
    }, {
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      limit: options.limit + 1,
    });

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      entries: page.map(toEntryView),
      nextCursor: hasMore && last ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}

function toEntryView(row: WalletLedgerEntryPersistence): LedgerEntryView {
  const money = (amount: string): MoneyProps =>
    Money.from({ amount, currency: row.currency }).toJSON();
  return {
    id: row.id,
    transactionId: row.transactionId,
    operation: row.operation,
    direction: row.direction,
    amount: money(row.amount),
    balanceBefore: money(row.balanceBefore),
    balanceAfter: money(row.balanceAfter),
    createdAt: row.createdAt.toISOString(),
  };
}
