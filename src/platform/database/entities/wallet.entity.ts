import { DecimalType, EntitySchema } from '@mikro-orm/core';
import { Money } from '../../../domain/wallet/money.js';
import { Wallet } from '../../../domain/wallet/wallet.js';

/**
 * Persistence shape for wagering.wallet (MikroORM 7 class-less EntitySchema;
 * the v7 line has no decorator API). `version` is a plain integer owned by the
 * domain — no `version: true`, so the ORM never auto-increments it behind the
 * domain's back (increments follow real balance changes only, under the
 * pessimistic locking strategy of D7).
 */
export interface WalletPersistence {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const WalletSchema = new EntitySchema<WalletPersistence>({
  name: 'Wallet',
  schema: 'wagering',
  tableName: 'wallet',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'uuid' },
    currency: { type: 'string', length: 3 },
    balance: { type: new DecimalType('string'), precision: 20, scale: 2 },
    version: { type: 'integer' },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
    updatedAt: { type: 'Date', columnType: 'timestamptz' },
  },
});
WalletSchema.addUnique({ name: 'wallet_player_currency_unique', properties: ['playerId', 'currency'] });

export function toWalletDomain(persistence: WalletPersistence): Wallet {
  return Wallet.rehydrate({
    id: persistence.id,
    playerId: persistence.playerId,
    currency: persistence.currency,
    balance: Money.from({ amount: persistence.balance, currency: persistence.currency }),
    version: persistence.version,
    createdAt: persistence.createdAt,
    updatedAt: persistence.updatedAt,
  });
}

export function fromWalletDomain(wallet: Wallet): WalletPersistence {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.amountString,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}
