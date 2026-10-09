import { EntitySchema } from '@mikro-orm/core';
import { OutboxMessage, OutboxStatus } from '../../../domain/wagering/outbox-message.js';

/**
 * Persistence shape for wagering.outbox_event (MikroORM 7 class-less
 * EntitySchema). Rows are inserted PENDING inside the financial transaction;
 * the F4 publisher flips them to PUBLISHED (granted in a later change).
 */
export interface OutboxEventPersistence {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | undefined;
  createdAt: Date;
  publishedAt: Date | undefined;
}

export const OutboxEventSchema = new EntitySchema<OutboxEventPersistence>({
  name: 'OutboxEvent',
  schema: 'wagering',
  tableName: 'outbox_event',
  properties: {
    id: { type: 'uuid', primary: true },
    aggregateId: { type: 'uuid' },
    eventType: { type: 'string', length: 100 },
    payload: { type: 'json' },
    status: { type: 'string', length: 20 },
    attempts: { type: 'integer' },
    nextAttemptAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
    createdAt: { type: 'Date', columnType: 'timestamptz' },
    publishedAt: { type: 'Date', columnType: 'timestamptz', nullable: true },
  },
});

export function toOutboxEventPersistence(message: OutboxMessage): OutboxEventPersistence {
  return {
    id: message.id,
    aggregateId: message.aggregateId,
    eventType: message.eventType,
    payload: { ...message.payload },
    status: message.isPending() ? OutboxStatus.Pending : OutboxStatus.Published,
    attempts: message.attempts,
    nextAttemptAt: message.nextAttemptAt,
    createdAt: message.occurredAt,
    publishedAt: message.publishedAt,
  };
}
