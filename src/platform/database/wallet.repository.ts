import type { EntityManager } from '@mikro-orm/postgresql';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { LedgerDirection, type WalletLedgerEntry } from '../../domain/wallet/ledger-entry.js';
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
 *
 * Before scheduling anything, `saveOpen` enforces the opening correspondence:
 * a positive balance requires its OPENING CREDIT entry (and vice versa), and
 * wallet and entry must agree on wallet id, currency, operation, direction and
 * balances. Violations throw before any row is scheduled, so a rejected call
 * leaves the database untouched.
 */
export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async saveOpen(wallet: Wallet, ledgerEntry?: WalletLedgerEntry): Promise<void> {
    this.assertOpeningPair(wallet, ledgerEntry);
    this.em.create(WalletSchema, fromWalletDomain(wallet));
    if (ledgerEntry) {
      this.em.create(WalletLedgerEntrySchema, fromWalletLedgerEntryDomain(ledgerEntry));
    }
    await this.em.flush();
  }

  private assertOpeningPair(wallet: Wallet, entry?: WalletLedgerEntry): void {
    const balance = wallet.balance;
    if (balance.isNegative()) {
      throw new Error(`Wallet ${wallet.id} cannot be persisted with a negative balance of ${balance.amountString}`);
    }
    if (!entry) {
      if (!balance.isZero()) {
        throw new Error(
          `Wallet ${wallet.id} has a positive balance of ${balance.amountString} but no OPENING ledger entry`,
        );
      }
      return;
    }
    if (entry.walletId !== wallet.id) {
      throw new Error(
        `Ledger entry ${entry.id} targets wallet ${entry.walletId} but the persisted wallet is ${wallet.id}`,
      );
    }
    for (const [label, money] of [
      ['amount', entry.amount],
      ['balanceBefore', entry.balanceBefore],
      ['balanceAfter', entry.balanceAfter],
    ] as const) {
      if (money.currency !== wallet.currency) {
        throw new Error(
          `Ledger entry ${label} currency ${money.currency} does not match wallet currency ${wallet.currency}`,
        );
      }
    }
    if (entry.operation !== 'OPENING') {
      throw new Error(
        `Ledger entry for a wallet opening must have operation OPENING, got ${entry.operation}`,
      );
    }
    if (entry.direction !== LedgerDirection.Credit) {
      throw new Error(
        `Ledger entry for a wallet opening must be a CREDIT, got ${entry.direction}`,
      );
    }
    if (!entry.balanceBefore.isZero()) {
      throw new Error(
        `Ledger entry OPENING must start from a zero balance, got ${entry.balanceBefore.amountString}`,
      );
    }
    if (balance.isZero()) {
      throw new Error(`Wallet ${wallet.id} has a zero balance and must not carry a ledger entry`);
    }
    if (!entry.balanceAfter.equals(balance)) {
      throw new Error(
        `Ledger entry balance ${entry.balanceAfter.amountString} does not match wallet balance ${balance.amountString}`,
      );
    }
  }
}
