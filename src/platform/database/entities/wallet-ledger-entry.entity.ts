import { DecimalType, EntitySchema } from '@mikro-orm/core';
import { Money } from '../../../domain/wallet/money.js';
import { WalletLedgerEntry, type WalletLedgerOperation } from '../../../domain/wallet/wallet.js';

/**
 * Persistence shape for wagering.wallet_ledger_entry (append-only; denied
 * UPDATE/DELETE/TRUNCATE by triggers installed in the financial migration).
 */
export interface WalletLedgerEntryPersistence {
  id: string;
  walletId: string;
  operation: string;
  amount: string;
  currency: string;
  createdAt: Date;
}

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryPersistence>({
  name: 'WalletLedgerEntry',
  schema: 'wagering',
  tableName: 'wallet_ledger_entry',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid' },
    operation: { type: 'string', length: 20 },
    amount: { type: new DecimalType('string'), precision: 20, scale: 2 },
    currency: { type: 'string', length: 3 },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
  },
});

export function toWalletLedgerEntryDomain(persistence: WalletLedgerEntryPersistence): WalletLedgerEntry {
  return new WalletLedgerEntry(
    persistence.id,
    persistence.walletId,
    persistence.operation as WalletLedgerOperation,
    new Money(persistence.amount, persistence.currency),
    persistence.createdAt,
  );
}

export function fromWalletLedgerEntryDomain(entry: WalletLedgerEntry): WalletLedgerEntryPersistence {
  return {
    id: entry.id,
    walletId: entry.walletId,
    operation: entry.operation,
    amount: entry.amount.amountString,
    currency: entry.amount.currency,
    createdAt: entry.createdAt,
  };
}
