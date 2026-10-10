import type { EntityManager } from '@mikro-orm/postgresql';
import { raw, sql } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import { WalletLedgerEntrySchema } from '../../../platform/database/entities/wallet-ledger-entry.entity.js';
import { WalletSchema } from '../../../platform/database/entities/wallet.entity.js';
import type { JsonLogger } from '../../../platform/logging/json-logger.js';
import { WalletNotFoundError } from './errors.js';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

interface SnapshotRow {
  balance: string;
  currency: string;
  count: number;
  calculated: string;
}

/**
 * Reconciliation (README §9): compares the materialized wallet balance with
 * the exact NUMERIC sum of its ledger entries computed in the database — no
 * floating point, no loading of rows into memory. Read-only: never corrects,
 * never writes. A divergence is logged at warn level with wallet identity and
 * exact amounts, counted via the structured event (no metrics infrastructure
 * exists in this project), and returned in the response with consistent=false.
 *
 * Snapshot consistency: both values come from a single SQL statement (wallet
 * LEFT JOIN ledger, GROUP BY the wallet PK). Any single PostgreSQL statement
 * runs under one statement snapshot — even at READ COMMITTED — so a
 * transaction committed between partial reads cannot produce a false
 * divergence. The previous two-query version was racy; an explicit
 * REPEATABLE READ transaction was rejected in favor of statement-level
 * atomicity (see stabilize-reconciliation-snapshot design.md). No locks are
 * taken: reconciliation never blocks, nor is blocked by, financial
 * processing on any wallet.
 */
export class ReconcileWallet {
  constructor(
    private readonly em: EntityManager,
    private readonly logger: JsonLogger,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    // Exact NUMERIC aggregation computed by the database — no float, no
    // loading of rows into memory, no interpolation: the wallet id stays a
    // bound parameter. The ledger is joined as a bare table via `sql.ref`
    // (no relation is declared between the two EntitySchemas), so the ON
    // clause and the aggregate fragments reference physical column names
    // (`wallet_id`, `direction`, `amount`) that the QB cannot map for an
    // untyped alias. `count(e.id)` (not `count(*)`) yields 0 for an empty
    // ledger under the LEFT JOIN. GROUP BY the wallet PK lets PostgreSQL
    // project balance/currency (functional dependency). One statement, one
    // statement-level snapshot, one row.
    const rows = await this.em.createQueryBuilder(WalletSchema, 'w')
      .select([
        'w.balance',
        'w.currency',
        raw('count(e.id)::int as count'),
        raw("coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0) as calculated"),
      ])
      .leftJoin(
        sql.ref(WalletLedgerEntrySchema.meta.schema!, WalletLedgerEntrySchema.tableName),
        'e',
        { [raw('e.wallet_id = w.id')]: [] },
      )
      .where({ id: walletId })
      .groupBy('id')
      .execute('all') as SnapshotRow[];
    const row = rows[0];
    if (!row) throw new WalletNotFoundError(walletId);

    const stored = Money.from({ amount: row.balance, currency: row.currency });
    const calculated = Money.from({ amount: row.calculated, currency: row.currency });
    const difference = stored.subtract(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger.event('reconciliation.divergence', {
        walletId,
        storedBalance: stored.amountString,
        calculatedBalance: calculated.amountString,
        differenceAmount: difference.amountString,
        currency: row.currency,
        checkedEntries: row.count,
      }, 'warn');
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: row.count,
    };
  }
}
