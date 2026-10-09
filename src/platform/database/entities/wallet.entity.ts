import { DecimalType, EntitySchema } from '@mikro-orm/core';
import { Money } from '../../../domain/wallet/money.js';
import { Wallet } from '../../../domain/wallet/wallet.js';

/**
 * Persistence shape for wagering.wallet (MikroORM 7 class-less EntitySchema;
 * the v7 line has no decorator API).
 */
export interface WalletPersistence {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
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
    version: { type: 'integer', version: true },
  },
});
WalletSchema.addUnique({ name: 'wallet_player_currency_unique', properties: ['playerId', 'currency'] });

export function toWalletDomain(persistence: WalletPersistence): Wallet {
  return new Wallet(
    persistence.id,
    persistence.playerId,
    persistence.currency,
    new Money(persistence.balance, persistence.currency),
    persistence.version,
  );
}

export function fromWalletDomain(wallet: Wallet): WalletPersistence {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.amountString,
    version: wallet.version,
  };
}
