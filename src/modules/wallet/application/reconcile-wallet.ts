import type { EntityManager } from '@mikro-orm/postgresql';
import { raw } from '@mikro-orm/postgresql';
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

interface LedgerSumRow {
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
 */
export class ReconcileWallet {
  constructor(
    private readonly em: EntityManager,
    private readonly logger: JsonLogger,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const wallet = await this.em.findOne(WalletSchema, walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    // Exact NUMERIC aggregation computed by the database — no float, no
    // loading of rows into memory. The query builder keeps the wallet id a
    // bound parameter (raw execute would inline or drop it).
    const rows = await this.em.createQueryBuilder(WalletLedgerEntrySchema, 'e')
      .select([
        raw('count(*)::int as count'),
        raw("coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0) as calculated"),
      ])
      .where({ walletId })
      .execute('all') as LedgerSumRow[];
    const row = rows[0]!;

    const stored = Money.from({ amount: wallet.balance, currency: wallet.currency });
    const calculated = Money.from({ amount: row.calculated, currency: wallet.currency });
    const difference = stored.subtract(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger.event('reconciliation.divergence', {
        walletId,
        storedBalance: stored.amountString,
        calculatedBalance: calculated.amountString,
        differenceAmount: difference.amountString,
        currency: wallet.currency,
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
