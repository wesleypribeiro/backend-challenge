import type { EntityManager } from '@mikro-orm/postgresql';
import type { Wallet } from '../../domain/wallet/wallet.js';
import type { WalletLedgerEntry } from '../../domain/wallet/ledger-entry.js';
import {
  WalletSchema,
  fromWalletDomain,
} from './entities/wallet.entity.js';
import {
  WalletLedgerEntrySchema,
  fromWalletLedgerEntryDomain,
} from './entities/wallet-ledger-entry.entity.js';

/**
 * Unit of Work adapter for opening a wallet. Both change sets are scheduled in
 * the same EntityManager and written by a single flush, so the wallet row and
 * its OPENING ledger entry share one SQL transaction (all-or-nothing).
 */
export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async saveOpen(wallet: Wallet, ledgerEntry?: WalletLedgerEntry): Promise<void> {
    this.em.create(WalletSchema, fromWalletDomain(wallet));
    if (ledgerEntry) {
      this.em.create(WalletLedgerEntrySchema, fromWalletLedgerEntryDomain(ledgerEntry));
    }
    await this.em.flush();
  }
}
