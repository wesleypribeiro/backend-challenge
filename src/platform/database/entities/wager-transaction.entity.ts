import { DecimalType, EntitySchema } from '@mikro-orm/core';
import { Money } from '../../../domain/wallet/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import type { FailureCode } from '../../../domain/wagering/failure-code.js';

/**
 * Persistence shape for wagering.wager_transaction (MikroORM 7 class-less
 * EntitySchema). Statuses are inserted already final for the F2 use case —
 * the row is never updated by the processing path.
 */
export interface WagerTransactionPersistence {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  moneyAmount: string;
  moneyCurrency: string;
  referenceExternalTransactionId: string | undefined;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  resultBalance: string | undefined;
  createdAt: Date;
  processedAt: Date | undefined;
}

export const WagerTransactionSchema = new EntitySchema<WagerTransactionPersistence>({
  name: 'WagerTransaction',
  schema: 'wagering',
  tableName: 'wager_transaction',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', length: 100 },
    externalTransactionId: { type: 'string', length: 200 },
    idempotencyKey: { type: 'string', length: 300 },
    payloadHash: { type: 'string', length: 64 },
    walletId: { type: 'uuid' },
    playerId: { type: 'uuid' },
    roundId: { type: 'string', length: 100 },
    gameId: { type: 'string', length: 100 },
    kind: { type: 'string', length: 20 },
    status: { type: 'string', length: 20 },
    moneyAmount: { type: new DecimalType('string'), precision: 20, scale: 2 },
    moneyCurrency: { type: 'string', length: 3 },
    referenceExternalTransactionId: { type: 'string', length: 200, nullable: true },
    referenceTransactionId: { type: 'uuid', nullable: true },
    failureCode: { type: 'string', length: 50, nullable: true },
    resultBalance: { type: new DecimalType('string'), precision: 20, scale: 2, nullable: true },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
    processedAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
  },
});
WagerTransactionSchema.addUnique({
  name: 'wager_transaction_provider_external_unique',
  properties: ['providerId', 'externalTransactionId'],
});
WagerTransactionSchema.addUnique({
  name: 'wager_transaction_idempotency_key_unique',
  properties: ['idempotencyKey'],
});

export function toWagerTransactionDomain(p: WagerTransactionPersistence): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: p.id,
    providerId: p.providerId,
    externalTransactionId: p.externalTransactionId,
    idempotencyKey: p.idempotencyKey,
    payloadHash: p.payloadHash,
    walletId: p.walletId,
    playerId: p.playerId,
    roundId: p.roundId,
    gameId: p.gameId,
    kind: p.kind,
    money: Money.from({ amount: p.moneyAmount, currency: p.moneyCurrency }),
    // Nullable columns hydrate as `null`, not `undefined` — normalize both.
    referenceExternalTransactionId: p.referenceExternalTransactionId ?? undefined,
    createdAt: p.createdAt,
    status: p.status,
    referenceTransactionId: p.referenceTransactionId ?? undefined,
    failureCode: p.failureCode ?? undefined,
    processedAt: p.processedAt ?? undefined,
    resultBalance: p.resultBalance == null
      ? undefined
      : Money.from({ amount: p.resultBalance, currency: p.moneyCurrency }),
  });
}

export function fromWagerTransactionDomain(tx: WagerTransaction): WagerTransactionPersistence {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    idempotencyKey: tx.idempotencyKey,
    payloadHash: tx.payloadHash,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    status: tx.status,
    moneyAmount: tx.money.amountString,
    moneyCurrency: tx.money.currency,
    referenceExternalTransactionId: tx.referenceExternalTransactionId,
    referenceTransactionId: tx.referenceTransactionId,
    failureCode: tx.failureCode,
    // Snapshot of the balance observed when the transaction was applied;
    // replay returns this value (README rule 7). Not a source of truth for
    // reconstruction — the ledger is.
    resultBalance: tx.resultBalance?.amountString,
    createdAt: tx.createdAt,
    processedAt: tx.processedAt,
  };
}
