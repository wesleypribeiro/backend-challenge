import { createHash } from 'node:crypto';
import { canonicalize } from './payload-hash.js';

export const INBOX_MESSAGE_MAX_LENGTH = {
  messageId: 200,
  consumerName: 100,
} as const;

/** Thrown on invalid identity input or an invalid processing transition —
 * a programming/contract error, never a business rejection. */
export class InvalidInboxStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInboxStateError';
  }
}

export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt?: Date | undefined;
}

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | undefined;
}

/**
 * Persistent inbox record (README §6.5). Identity is `(consumerName,
 * messageId)` — enforced by a database unique constraint; this entity only
 * guards its own invariants. `receive` validates structural identity at the
 * boundary; `rehydrate` reconstructs persisted state without re-running
 * transition rules (README §6.0). The row participates in the same SQL
 * transaction as the financial processing (F3 decision 1); the nullable
 * `processedAt` is flipped in that transaction before commit.
 */
export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt: Date | undefined,
  ) {}

  /** New message received from the transport. */
  static receive(props: ReceiveInboxProps): InboxMessage {
    assertIdentityString('messageId', props.messageId, INBOX_MESSAGE_MAX_LENGTH.messageId);
    if (props.messageId !== props.messageId.trim()) {
      throw new InvalidInboxStateError('messageId must not carry leading or trailing whitespace');
    }
    assertIdentityString('consumerName', props.consumerName, INBOX_MESSAGE_MAX_LENGTH.consumerName);
    if (!/^[0-9a-f]{64}$/.test(props.payloadHash)) {
      throw new InvalidInboxStateError(
        `payloadHash must be a sha-256 hex digest, got ${JSON.stringify(props.payloadHash)}`,
      );
    }
    const receivedAt = props.receivedAt ?? new Date();
    assertValidDate('receivedAt', receivedAt);
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      receivedAt,
      undefined,
    );
  }

  /** Reconstruction from persistence — does not revalidate (README §6.0). */
  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidInboxStateError(
        `Inbox message ${this.messageId} is already processed at ${this._processedAt?.toISOString()}`,
      );
    }
    assertValidDate('at', at);
    this._processedAt = at;
  }
}

/**
 * Canonical hash of the SQS envelope's `data` (F3 decision 1): SHA-256 over
 * the recursively key-sorted JSON of the complete `data` object, including
 * `idempotencyKey`. Differs from the financial `computePayloadHash` (F2),
 * which hashes only the business fields with transport metadata excluded:
 * the financial hash answers "is this the same business operation under the
 * F2 contract?", while the inbox hash answers "is this the same message
 * content end-to-end?" — any divergence in `data` (including the
 * idempotency key) is an identity conflict. Envelope metadata outside
 * `data` (`messageId`, `type`, `occurredAt`) never enters the hash because
 * only `data` is an input. Decimal money strings are serialized verbatim;
 * no numeric conversion ever happens.
 */
export function computeInboxPayloadHash(
  data: Readonly<Record<string, unknown>>,
): string {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new InvalidInboxStateError('computeInboxPayloadHash requires a data object');
  }
  return createHash('sha256').update(canonicalize(data), 'utf8').digest('hex');
}

function assertIdentityString(field: string, value: unknown, maxLength: number): void {
  if (typeof value !== 'string') {
    throw new InvalidInboxStateError(`${field} must be a string, got ${typeof value}`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new InvalidInboxStateError(`${field} must not be empty`);
  }
  if (value.length > maxLength) {
    throw new InvalidInboxStateError(
      `${field} must have at most ${maxLength} characters, got ${value.length}`,
    );
  }
}

function assertValidDate(field: string, value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidInboxStateError(`${field} must be a valid Date`);
  }
}
