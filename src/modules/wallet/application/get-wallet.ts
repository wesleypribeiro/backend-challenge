import type { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import { WalletSchema } from '../../../platform/database/entities/wallet.entity.js';
import { WalletNotFoundError } from './errors.js';

export interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

/** Reads a wallet by id, or raises the not-found error (HTTP 404). */
export class GetWallet {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string): Promise<WalletView> {
    const row = await this.em.findOne(WalletSchema, walletId);
    if (!row) throw new WalletNotFoundError(walletId);
    return {
      id: row.id,
      playerId: row.playerId,
      balance: Money.from({ amount: row.balance, currency: row.currency }).toJSON(),
      version: row.version,
    };
  }
}
