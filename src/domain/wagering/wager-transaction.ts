import { LedgerDirection } from '../wallet/ledger-entry.js';
import { Money } from '../wallet/money.js';
import { FailureCode } from './failure-code.js';

export const WagerTransactionKind = {
  Opening: 'OPENING',
  Bet: 'BET',
  Win: 'WIN',
  Loss: 'LOSS',
  Refund: 'REFUND',
  Rollback: 'ROLLBACK',
} as const;
export type WagerTransactionKind =
  (typeof WagerTransactionKind)[keyof typeof WagerTransactionKind];

export const WagerTransactionStatus = {
  Pending: 'PENDING',
  PendingReference: 'PENDING_REFERENCE',
  Processed: 'PROCESSED',
  Rejected: 'REJECTED',
  Failed: 'FAILED',
} as const;
export type WagerTransactionStatus =
  (typeof WagerTransactionStatus)[keyof typeof WagerTransactionStatus];

/** Thrown when a transition is attempted from a terminal state or an
 * unrecognized kind/direction combination is queried — a programming error,
 * never a business rejection. */
export class InvalidTransactionStateError extends Error {}

const RECOGNIZED_KINDS = new Set<string>(Object.values(WagerTransactionKind));

const REFERENCE_REQUIRED_KINDS = new Set<WagerTransactionKind>([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

/** BET and LOSS never reference; WIN may reference a BET of the same round
 * (README §7 table) but does not require it. */
const REFERENCE_FORBIDDEN_KINDS = new Set<WagerTransactionKind>([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Loss,
]);

/** Ledger direction each kind produces when it moves the balance. LOSS never
 * does; ROLLBACK's direction depends on the referenced transaction. */
const KIND_LEDGER_DIRECTION: Partial<Record<WagerTransactionKind, LedgerDirection>> = {
  [WagerTransactionKind.Opening]: LedgerDirection.Credit,
  [WagerTransactionKind.Bet]: LedgerDirection.Debit,
  [WagerTransactionKind.Win]: LedgerDirection.Credit,
  [WagerTransactionKind.Refund]: LedgerDirection.Credit,
};

const TERMINAL_STATUSES = new Set<WagerTransactionStatus>([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

export interface CreateWagerTransactionProps {
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
  money: Money;
  /** Provider-side id of the referenced transaction (not the internal id). */
  referenceExternalTransactionId?: string | undefined;
  createdAt?: Date;
}

export interface WagerTransactionState {
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
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  resultBalance?: Money | undefined;
}

/**
 * A financial wagering operation. Created in PENDING (provider kinds) or
 * directly PROCESSED (internal OPENING); transitions out of a terminal state
 * raise InvalidTransactionStateError. Idempotent replay and conflict detection
 * live in the use case, keyed by idempotencyKey / (providerId,
 * externalTransactionId) with payloadHash deciding replay vs conflict.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
    private _resultBalance: Money | undefined,
  ) {}

  /**
   * Factory for provider-submitted kinds (BET/WIN/LOSS/REFUND/ROLLBACK).
   * OPENING is internal and has its own factory. Reference requirements are
   * enforced here: REFUND/ROLLBACK require a reference external id; BET and
   * LOSS must not carry one; WIN may optionally reference a BET.
   */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!RECOGNIZED_KINDS.has(props.kind)) {
      throw new InvalidTransactionStateError(`Unrecognized transaction kind: ${String(props.kind)}`);
    }
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidTransactionStateError(
        'OPENING transactions are internal and cannot be created through the provider factory',
      );
    }
    if (REFERENCE_REQUIRED_KINDS.has(props.kind) && !props.referenceExternalTransactionId) {
      throw new InvalidTransactionStateError(
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }
    if (REFERENCE_FORBIDDEN_KINDS.has(props.kind) && props.referenceExternalTransactionId) {
      throw new InvalidTransactionStateError(
        `${props.kind} must not carry referenceExternalTransactionId`,
      );
    }
    if (!props.money.isPositive()) {
      throw new InvalidTransactionStateError(
        `Transaction amount must be positive, got ${props.money.amountString}`,
      );
    }
    const tx = new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return tx;
  }

  /**
   * Internal factory for the wallet-opening credit. Born PROCESSED with the
   * canonical internal identifiers (`opening-{walletId}` /
   * `internal:opening-{walletId}`).
   */
  static opening(props: {
    id: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    money: Money;
    payloadHash: string;
    createdAt?: Date;
  }): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidTransactionStateError(
        `OPENING amount must be positive, got ${props.money.amountString}`,
      );
    }
    const now = props.createdAt ?? new Date();
    const tx = new WagerTransaction(
      props.id,
      'internal',
      `opening-${props.walletId}`,
      `internal:opening-${props.walletId}`,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      now,
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      now,
      props.money,
    );
    return tx;
  }

  /** Reconstruction from persistence — does not revalidate transitions. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const tx = new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.resultBalance,
    );
    return tx;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  /** Balance observed when the transaction was applied — replay returns this
   * (README rule 7). Set by markProcessed; not a reconstruction source. */
  get resultBalance(): Money | undefined {
    return this._resultBalance;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    resultBalance: Money,
  ): void {
    this.assertNotTerminal('markProcessed');
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._resultBalance = resultBalance;
  }

  markPendingReference(): void {
    this.assertNotTerminal('markPendingReference');
    if (!this.waitsForReference()) {
      throw new InvalidTransactionStateError(
        `${this.kind} cannot be pending-reference without an informed reference`,
      );
    }
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal('reject');
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal('fail');
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  /** false only for LOSS — it records a round outcome without moving money. */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  /** true for REFUND and ROLLBACK (README rule 1). */
  requiresReference(): boolean {
    return REFERENCE_REQUIRED_KINDS.has(this.kind);
  }

  /**
   * Whether this transaction may wait as PENDING_REFERENCE: the kinds that
   * require a reference (REFUND/ROLLBACK) plus WIN with an optional reference
   * explicitly informed — an absent optional reference on WIN is processed
   * normally, but an informed one that has not resolved yet waits (README §7).
   */
  waitsForReference(): boolean {
    return this.requiresReference()
      || (this.kind === WagerTransactionKind.Win && Boolean(this.referenceExternalTransactionId));
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Ledger direction this transaction produces when applied. For ROLLBACK the
   * direction is the inverse of the referenced transaction's own direction;
   * a reference is required. LOSS and any non-balance kind raise.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === WagerTransactionKind.Rollback) {
      if (!reference) {
        throw new InvalidTransactionStateError('ROLLBACK requires a resolved reference transaction');
      }
      const referenceDirection = KIND_LEDGER_DIRECTION[reference.kind];
      if (!referenceDirection) {
        throw new InvalidTransactionStateError(
          `ROLLBACK cannot invert a reference of kind ${reference.kind}`,
        );
      }
      return referenceDirection === LedgerDirection.Credit
        ? LedgerDirection.Debit
        : LedgerDirection.Credit;
    }
    const direction = KIND_LEDGER_DIRECTION[this.kind];
    if (!direction) {
      throw new InvalidTransactionStateError(
        `${this.kind} does not produce a ledger entry`,
      );
    }
    return direction;
  }

  private assertNotTerminal(transition: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot ${transition} a ${this._status} transaction`,
      );
    }
  }
}
