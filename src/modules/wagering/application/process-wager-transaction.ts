import { LockMode, type EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../../domain/wallet/money.js';
import { Wallet } from '../../../domain/wallet/wallet.js';
import { LedgerDirection, WalletLedgerEntry } from '../../../domain/wallet/ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import { FailureCode } from '../../../domain/wagering/failure-code.js';
import { computePayloadHash } from '../../../domain/wagering/payload-hash.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../../domain/wagering/events.js';
import { OutboxMessage } from '../../../domain/wagering/outbox-message.js';
import { WalletSchema, toWalletDomain } from '../../../platform/database/entities/wallet.entity.js';
import { WalletLedgerEntrySchema, fromWalletLedgerEntryDomain } from '../../../platform/database/entities/wallet-ledger-entry.entity.js';
import {
  WagerTransactionSchema,
  fromWagerTransactionDomain,
  toWagerTransactionDomain,
} from '../../../platform/database/entities/wager-transaction.entity.js';
import { OutboxEventSchema, toOutboxEventPersistence } from '../../../platform/database/entities/outbox-event.entity.js';

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string | undefined;
}

export type ProcessWagerTransactionResult =
  | { outcome: 'processed'; transactionId: string; balance: MoneyProps; idempotentReplay: boolean }
  | { outcome: 'rejected'; transactionId: string; failureCode: FailureCode; idempotentReplay: boolean }
  | { outcome: 'pendingReference'; transactionId: string; idempotentReplay: boolean }
  | { outcome: 'conflict'; transactionId: string; idempotentReplay: false };

export interface ProcessWagerTransactionOptions {
  /** Seam for atomic-rollback tests: every id the use case generates flows
   * through here (ledger entry ids, event ids). Defaults to crypto.randomUUID. */
  idGenerator?: () => string;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Transaction-processing use case (README §7/§8). Owns the SQL transaction
 * (D5): locks the wallet FOR UPDATE, resolves persistent idempotency, applies
 * business rules, and persists transaction + ledger + outbox in one flush.
 * The unit of concurrency is the walletId; distinct wallets never block each
 * other. Rejections and pending references are persisted rows with their
 * events; idempotency conflicts produce neither.
 */
export class ProcessWagerTransaction {
  private readonly idGenerator: () => string;

  constructor(
    private readonly em: EntityManager,
    options: ProcessWagerTransactionOptions = {},
  ) {
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  async execute(input: ProcessWagerTransactionInput): Promise<ProcessWagerTransactionResult> {
    const money = Money.from({ amount: input.amount, currency: input.currency });
    const payloadHash = computePayloadHash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
    try {
      return await this.em.transactional((tx) => this.process(tx, input, money, payloadHash));
    } catch (error) {
      // A concurrent writer won the unique race (idempotency key, provider
      // pair or reversal). The failed transaction is rolled back; decide the
      // outcome in a fresh context — never continue in an aborted one.
      if (isUniqueViolation(error)) return this.recover(input, payloadHash);
      throw error;
    }
  }

  private async process(
    tx: EntityManager,
    input: ProcessWagerTransactionInput,
    money: Money,
    payloadHash: string,
  ): Promise<ProcessWagerTransactionResult> {
    const existing = await this.findByIdempotency(tx, input);
    if (existing) return this.decideReplay(existing, payloadHash);

    const walletRow = await tx.findOne(WalletSchema, input.walletId, {
      lockMode: LockMode.PESSIMISTIC_WRITE,
    });
    if (!walletRow) {
      throw new Error(`Wallet ${input.walletId} not found`);
    }

    // Re-lookup after the lock: a concurrent commit may have landed between
    // the first probe and lock acquisition.
    const raced = await this.findByIdempotency(tx, input);
    if (raced) return this.decideReplay(raced, payloadHash);

    const entity = WagerTransaction.create({
      id: this.idGenerator(),
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    if (input.playerId !== walletRow.playerId) {
      return this.rejectAndPersist(tx, entity, FailureCode.WalletPlayerMismatch);
    }
    if (money.currency !== walletRow.currency) {
      return this.rejectAndPersist(tx, entity, FailureCode.CurrencyMismatch);
    }

    const needsReference = entity.requiresReference()
      || (entity.kind === WagerTransactionKind.Win && entity.referenceExternalTransactionId !== undefined);
    let reference: WagerTransaction | undefined;
    if (needsReference) {
      const referenceExternalId = entity.referenceExternalTransactionId;
      if (!referenceExternalId) {
        throw new Error(`Transaction ${entity.id} requires a reference external id`);
      }
      const referenceRow = await tx.findOne(WagerTransactionSchema, {
        providerId: input.providerId,
        externalTransactionId: referenceExternalId,
      });
      reference = referenceRow ? toWagerTransactionDomain(referenceRow) : undefined;
      if (!reference || reference.status !== WagerTransactionStatus.Processed) {
        return this.pendingReferenceAndPersist(tx, entity, input);
      }
      const scopeFailure = this.validateReferenceScope(entity, reference, money);
      if (scopeFailure) {
        return this.rejectAndPersist(tx, entity, scopeFailure);
      }
      if (entity.requiresReference()) {
        const reversal = await tx.findOne(WagerTransactionSchema, {
          referenceTransactionId: reference.id,
          kind: entity.kind,
          status: WagerTransactionStatus.Processed,
        });
        if (reversal) {
          return this.rejectAndPersist(tx, entity, FailureCode.DuplicateReversal);
        }
      }
    }

    const wallet = toWalletDomain(walletRow);
    const balanceBefore = wallet.balance;

    // LOSS records the round outcome without moving money (README §7).
    if (!entity.affectsBalance()) {
      const now = new Date();
      entity.markProcessed(reference?.id, now, wallet.balance);
      tx.create(WagerTransactionSchema, fromWagerTransactionDomain(entity));
      tx.create(OutboxEventSchema, toOutboxEventPersistence(OutboxMessage.enqueue(
        WagerTransactionProcessed.from({
          eventId: this.idGenerator(),
          aggregateId: entity.id,
          ctx: { correlationId: entity.idempotencyKey },
          occurredAt: now,
          transactionId: entity.id,
          walletId: entity.walletId,
          providerId: entity.providerId,
          externalTransactionId: entity.externalTransactionId,
          kind: entity.kind,
          money: money.toJSON(),
          referenceTransactionId: reference?.id,
          resultBalance: wallet.balance.toJSON(),
        }),
      )));
      return {
        outcome: 'processed',
        transactionId: entity.id,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    const direction = entity.ledgerDirectionFor(reference);
    if (direction === LedgerDirection.Debit && balanceBefore.isLessThan(money)) {
      return this.rejectAndPersist(
        tx,
        entity,
        entity.kind === WagerTransactionKind.Rollback
          ? FailureCode.RollbackInsufficientFunds
          : FailureCode.InsufficientFunds,
      );
    }

    const now = new Date();
    if (direction === LedgerDirection.Debit) wallet.debit(money);
    else wallet.credit(money);
    walletRow.balance = wallet.balance.amountString;
    walletRow.version = wallet.version;
    walletRow.updatedAt = wallet.updatedAt;

    const entry = WalletLedgerEntry.create({
      id: this.idGenerator(),
      walletId: wallet.id,
      transactionId: entity.id,
      operation: entity.kind,
      direction,
      amount: money,
      balanceBefore,
      balanceAfter: wallet.balance,
      createdAt: now,
    });

    entity.markProcessed(reference?.id, now, wallet.balance);
    tx.create(WagerTransactionSchema, fromWagerTransactionDomain(entity));
    tx.create(WalletLedgerEntrySchema, fromWalletLedgerEntryDomain(entry));

    const ctx = { correlationId: input.idempotencyKey };
    const messages: OutboxMessage[] = [
      OutboxMessage.enqueue(WagerTransactionProcessed.from({
        eventId: this.idGenerator(),
        aggregateId: entity.id,
        ctx,
        occurredAt: now,
        transactionId: entity.id,
        walletId: entity.walletId,
        providerId: entity.providerId,
        externalTransactionId: entity.externalTransactionId,
        kind: entity.kind,
        money: money.toJSON(),
        referenceTransactionId: reference?.id,
        resultBalance: wallet.balance.toJSON(),
      })),
      OutboxMessage.enqueue(WalletBalanceChanged.from({
        eventId: this.idGenerator(),
        aggregateId: wallet.id,
        ctx,
        occurredAt: now,
        walletId: wallet.id,
        transactionId: entity.id,
        direction,
        money: money.toJSON(),
        balanceBefore: balanceBefore.toJSON(),
        balanceAfter: wallet.balance.toJSON(),
        walletVersion: wallet.version,
      })),
    ];
    for (const message of messages) {
      tx.create(OutboxEventSchema, toOutboxEventPersistence(message));
    }

    return {
      outcome: 'processed',
      transactionId: entity.id,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private validateReferenceScope(
    entity: WagerTransaction,
    reference: WagerTransaction,
    money: Money,
  ): FailureCode | undefined {
    if (reference.playerId !== entity.playerId) return FailureCode.ReferencePlayerMismatch;
    if (reference.walletId !== entity.walletId) return FailureCode.ReferenceWalletMismatch;
    if (reference.money.currency !== money.currency) return FailureCode.ReferenceCurrencyMismatch;
    if (reference.roundId !== entity.roundId) return FailureCode.ReferenceRoundMismatch;

    if (entity.kind === WagerTransactionKind.Refund) {
      if (reference.kind !== WagerTransactionKind.Bet) return FailureCode.ReferenceKindNotAllowed;
      if (!reference.money.equals(money)) return FailureCode.ReferenceMoneyMismatch;
      return undefined;
    }
    if (entity.kind === WagerTransactionKind.Rollback) {
      if (
        reference.kind !== WagerTransactionKind.Bet
        && reference.kind !== WagerTransactionKind.Win
        && reference.kind !== WagerTransactionKind.Refund
      ) return FailureCode.ReferenceKindNotAllowed;
      if (!reference.money.equals(money)) return FailureCode.ReferenceMoneyMismatch;
      return undefined;
    }
    // WIN with an optional reference: same-round BET, no amount equality.
    if (reference.kind !== WagerTransactionKind.Bet) return FailureCode.ReferenceKindNotAllowed;
    return undefined;
  }

  private async findByIdempotency(
    tx: EntityManager,
    input: ProcessWagerTransactionInput,
  ): Promise<WagerTransaction | undefined> {
    const row = await tx.findOne(WagerTransactionSchema, {
      $or: [
        { idempotencyKey: input.idempotencyKey },
        {
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
        },
      ],
    });
    return row ? toWagerTransactionDomain(row) : undefined;
  }

  private decideReplay(
    existing: WagerTransaction,
    payloadHash: string,
  ): ProcessWagerTransactionResult {
    if (!existing.matchesPayload(payloadHash)) {
      return { outcome: 'conflict', transactionId: existing.id, idempotentReplay: false };
    }
    switch (existing.status) {
      case WagerTransactionStatus.Processed:
        return {
          outcome: 'processed',
          transactionId: existing.id,
          balance: (existing.resultBalance ?? existing.money).toJSON(),
          idempotentReplay: true,
        };
      case WagerTransactionStatus.Rejected:
        return {
          outcome: 'rejected',
          transactionId: existing.id,
          failureCode: existing.failureCode ?? FailureCode.ReferenceNotFound,
          idempotentReplay: true,
        };
      case WagerTransactionStatus.PendingReference:
        return { outcome: 'pendingReference', transactionId: existing.id, idempotentReplay: true };
      default:
        throw new Error(`Transaction ${existing.id} is in non-terminal status ${existing.status} and cannot be replayed`);
    }
  }

  private async rejectAndPersist(
    tx: EntityManager,
    entity: WagerTransaction,
    code: FailureCode,
  ): Promise<ProcessWagerTransactionResult> {
    entity.reject(code);
    tx.create(WagerTransactionSchema, fromWagerTransactionDomain(entity));
    tx.create(OutboxEventSchema, toOutboxEventPersistence(OutboxMessage.enqueue(
      WagerTransactionRejected.from({
        eventId: this.idGenerator(),
        aggregateId: entity.id,
        ctx: { correlationId: entity.idempotencyKey },
        transactionId: entity.id,
        walletId: entity.walletId,
        providerId: entity.providerId,
        externalTransactionId: entity.externalTransactionId,
        kind: entity.kind,
        money: entity.money.toJSON(),
        failureCode: code,
      }),
    )));
    return { outcome: 'rejected', transactionId: entity.id, failureCode: code, idempotentReplay: false };
  }

  private async pendingReferenceAndPersist(
    tx: EntityManager,
    entity: WagerTransaction,
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionResult> {
    entity.markPendingReference();
    tx.create(WagerTransactionSchema, fromWagerTransactionDomain(entity));
    tx.create(OutboxEventSchema, toOutboxEventPersistence(OutboxMessage.enqueue(
      WagerTransactionPendingReference.from({
        eventId: this.idGenerator(),
        aggregateId: entity.id,
        ctx: { correlationId: entity.idempotencyKey },
        transactionId: entity.id,
        walletId: entity.walletId,
        providerId: entity.providerId,
        externalTransactionId: entity.externalTransactionId,
        kind: entity.kind,
        money: entity.money.toJSON(),
        referenceExternalTransactionId: input.referenceExternalTransactionId ?? '',
      }),
    )));
    return { outcome: 'pendingReference', transactionId: entity.id, idempotentReplay: false };
  }

  private async recover(
    input: ProcessWagerTransactionInput,
    payloadHash: string,
  ): Promise<ProcessWagerTransactionResult> {
    const fresh = this.em.fork();
    const existing = await this.findByIdempotency(fresh, input);
    if (existing) return this.decideReplay(existing, payloadHash);
    // The race was not on this submission's identity (e.g. a concurrent
    // reversal won the partial unique index). Re-run once in a clean
    // context: the winner is now visible and the rules decide the outcome.
    return fresh.transactional((tx) => this.process(
      tx,
      input,
      Money.from({ amount: input.amount, currency: input.currency }),
      payloadHash,
    ));
  }
}
