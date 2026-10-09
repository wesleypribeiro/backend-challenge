import { DecimalType, EntitySchema } from '@mikro-orm/core';
import { Money } from '../../../domain/wallet/money.js';
import {
  WalletLedgerEntry,
  type WalletLedgerOperation,
  type LedgerDirection,
} from '../../../domain/wallet/ledger-entry.js';

/**
 * Persistence shape for wagering.wallet_ledger_entry (append-only; denied
 * UPDATE/DELETE/TRUNCATE by triggers installed in the financial migration).
 * CHECK constraints additionally enforce direction values and the
 * balanceBefore ± amount === balanceAfter arithmetic at the database level.
 */
export interface WalletLedgerEntryPersistence {
  id: string;
  walletId: string;
  transactionId: string;
  operation: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryPersistence>({
  name: 'WalletLedgerEntry',
  schema: 'wagering',
  tableName: 'wallet_ledger_entry',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid' },
    transactionId: { type: 'uuid' },
    operation: { type: 'string', length: 20 },
    direction: { type: 'string', length: 8 },
    amount: { type: new DecimalType('string'), precision: 20, scale: 2 },
    currency: { type: 'string', length: 3 },
    balanceBefore: { type: new DecimalType('string'), precision: 20, scale: 2 },
    balanceAfter: { type: new DecimalType('string'), precision: 20, scale: 2 },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
  },
});

export function toWalletLedgerEntryDomain(persistence: WalletLedgerEntryPersistence): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: persistence.id,
    walletId: persistence.walletId,
    transactionId: persistence.transactionId,
    operation: persistence.operation as WalletLedgerOperation,
    direction: persistence.direction as LedgerDirection,
    amount: Money.from({ amount: persistence.amount, currency: persistence.currency }),
    balanceBefore: Money.from({ amount: persistence.balanceBefore, currency: persistence.currency }),
    balanceAfter: Money.from({ amount: persistence.balanceAfter, currency: persistence.currency }),
    createdAt: persistence.createdAt,
  });
}

export function fromWalletLedgerEntryDomain(entry: WalletLedgerEntry): WalletLedgerEntryPersistence {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    operation: entry.operation,
    direction: entry.direction,
    amount: entry.amount.amountString,
    currency: entry.amount.currency,
    balanceBefore: entry.balanceBefore.amountString,
    balanceAfter: entry.balanceAfter.amountString,
    createdAt: entry.createdAt,
  };
}
