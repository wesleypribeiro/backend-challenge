import type { MoneyProps } from '../wallet/money.js';
import type { LedgerDirection } from '../wallet/ledger-entry.js';
import type { WagerTransactionKind } from './wager-transaction.js';
import type { FailureCode } from './failure-code.js';

export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string | undefined;
  occurredAt: Date;
  data: T;
}

export interface EventContext {
  correlationId: string;
  causationId?: string | undefined;
}

/**
 * Base envelope for integration events. `eventType` and `version` live on the
 * concrete class; `toJSON` is the stable serialization written to the outbox
 * payload (README §11). `data` always carries MoneyProps (decimal strings),
 * never live Money instances.
 */
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze({ ...props.data });
    // Not frozen here: subclass field initializers (eventType, version) run
    // after the base constructor; factories freeze once fully constructed.
  }

  toJSON(): {
    eventId: string;
    eventType: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string | undefined;
    occurredAt: string;
    version: number;
    data: T;
  } {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data as T,
    };
  }
}

interface TransactionEventBase {
  eventId: string;
  aggregateId: string;
  ctx: EventContext;
  occurredAt?: Date;
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
}

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceTransactionId: string | undefined;
  /** Balance observed when the transaction was applied — replay returns this. */
  resultBalance: MoneyProps;
}

/** Emitted for every applied transaction, including LOSS (README §11). */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(props: TransactionEventBase & {
    referenceTransactionId: string | undefined;
    resultBalance: MoneyProps;
  }): WagerTransactionProcessed {
    const event = new WagerTransactionProcessed({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.occurredAt ?? new Date(),
      data: {
        transactionId: props.transactionId,
        walletId: props.walletId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        kind: props.kind,
        money: props.money,
        referenceTransactionId: props.referenceTransactionId,
        resultBalance: props.resultBalance,
      },
    });
    return Object.freeze(event);
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
}

/** Emitted for business-rule rejections (status REJECTED). */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(props: TransactionEventBase & { failureCode: FailureCode }): WagerTransactionRejected {
    const event = new WagerTransactionRejected({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.occurredAt ?? new Date(),
      data: {
        transactionId: props.transactionId,
        walletId: props.walletId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        kind: props.kind,
        money: props.money,
        failureCode: props.failureCode,
      },
    });
    return Object.freeze(event);
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/** Emitted only when the balance actually moved (never for LOSS/REJECTED). */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(props: {
    eventId: string;
    aggregateId: string;
    ctx: EventContext;
    occurredAt?: Date;
  } & WalletBalanceChangedData): WalletBalanceChanged {
    const event = new WalletBalanceChanged({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.occurredAt ?? new Date(),
      data: {
        walletId: props.walletId,
        transactionId: props.transactionId,
        direction: props.direction,
        money: props.money,
        balanceBefore: props.balanceBefore,
        balanceAfter: props.balanceAfter,
        walletVersion: props.walletVersion,
      },
    });
    return Object.freeze(event);
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

/** Emitted when a reference is missing and the transaction waits as PENDING_REFERENCE. */
export class WagerTransactionPendingReference
  extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(props: TransactionEventBase & {
    referenceExternalTransactionId: string;
  }): WagerTransactionPendingReference {
    const event = new WagerTransactionPendingReference({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.occurredAt ?? new Date(),
      data: {
        transactionId: props.transactionId,
        walletId: props.walletId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        kind: props.kind,
        money: props.money,
        referenceExternalTransactionId: props.referenceExternalTransactionId,
      },
    });
    return Object.freeze(event);
  }
}
