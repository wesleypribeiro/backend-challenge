import type { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import { Wallet } from '../../../domain/wallet/wallet.js';
import { WalletRepository } from '../../../platform/database/wallet.repository.js';
import { InvalidWalletInputError, WalletAlreadyExistsError } from './errors.js';

export interface OpenWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface OpenWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Opens a wallet (README §9). Validates the opening input structurally before
 * any write, delegates the atomic persistence (wallet + OPENING + ledger +
 * outbox in one flush) to WalletRepository, and maps the unique
 * (playerId, currency) violation to a conflict — never a server error.
 */
export class OpenWallet {
  private readonly idGenerator: () => string;

  constructor(
    private readonly em: EntityManager,
    options: { idGenerator?: () => string } = {},
  ) {
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  async execute(input: OpenWalletInput): Promise<OpenWalletResult> {
    if (typeof input.playerId !== 'string' || !UUID_PATTERN.test(input.playerId)) {
      throw new InvalidWalletInputError('playerId', `playerId must be a UUID, got ${JSON.stringify(input.playerId)}`);
    }
    let initialBalance: Money;
    try {
      initialBalance = Money.from(input.initialBalance);
    } catch (error) {
      throw new InvalidWalletInputError('initialBalance', (error as Error).message);
    }
    if (initialBalance.isNegative()) {
      throw new InvalidWalletInputError('initialBalance', 'initialBalance cannot be negative');
    }

    const { wallet, ledgerEntry } = Wallet.open({
      id: this.idGenerator(),
      playerId: input.playerId,
      initialBalance,
      idGenerator: this.idGenerator,
    });
    try {
      await new WalletRepository(this.em).saveOpen(wallet, ledgerEntry);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WalletAlreadyExistsError(input.playerId, initialBalance.currency);
      }
      throw error;
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}
