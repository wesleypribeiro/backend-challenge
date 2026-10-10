import type { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import {
  WagerTransactionSchema,
  type WagerTransactionPersistence,
} from '../../../platform/database/entities/wager-transaction.entity.js';
import { TransactionNotFoundError } from './errors.js';

export interface TransactionView {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  status: string;
  money: MoneyProps;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  failureCode: string | null;
  resultBalance: MoneyProps | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * Read-side of wagering transactions: by internal id, or by the provider's
 * identity (providerId + externalTransactionId). Both raise not-found (404)
 * for unknown but well-formed identifiers.
 */
export class GetTransaction {
  constructor(private readonly em: EntityManager) {}

  async byId(transactionId: string): Promise<TransactionView> {
    const row = await this.em.findOne(WagerTransactionSchema, transactionId);
    if (!row) throw new TransactionNotFoundError(transactionId);
    return toTransactionView(row);
  }

  async byProviderIdentity(providerId: string, externalTransactionId: string): Promise<TransactionView> {
    const row = await this.em.findOne(WagerTransactionSchema, { providerId, externalTransactionId });
    if (!row) throw new TransactionNotFoundError(`${providerId}/${externalTransactionId}`);
    return toTransactionView(row);
  }
}

function toTransactionView(p: WagerTransactionPersistence): TransactionView {
  return {
    transactionId: p.id,
    providerId: p.providerId,
    externalTransactionId: p.externalTransactionId,
    kind: p.kind,
    status: p.status,
    money: Money.from({ amount: p.moneyAmount, currency: p.moneyCurrency }).toJSON(),
    playerId: p.playerId,
    walletId: p.walletId,
    roundId: p.roundId,
    gameId: p.gameId,
    referenceExternalTransactionId: p.referenceExternalTransactionId ?? null,
    referenceTransactionId: p.referenceTransactionId ?? null,
    failureCode: p.failureCode ?? null,
    resultBalance: p.resultBalance == null
      ? null
      : Money.from({ amount: p.resultBalance, currency: p.moneyCurrency }).toJSON(),
    createdAt: p.createdAt.toISOString(),
    processedAt: p.processedAt ? p.processedAt.toISOString() : null,
  };
}
