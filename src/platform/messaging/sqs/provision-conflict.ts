export type QueueRole = 'main' | 'dlq';
export type QueueAttribute = 'FifoQueue' | 'ContentBasedDeduplication' | 'VisibilityTimeout' |
  'ReceiveMessageWaitTimeSeconds' | 'MessageRetentionPeriod' | 'RedrivePolicy' | 'RedriveAllowPolicy';

export class ProvisionConflict extends Error {
  readonly code = 'SQS_QUEUE_CONFLICT';
  constructor(readonly queueRole: QueueRole, readonly attribute: QueueAttribute) {
    super(`Incompatible ${queueRole} queue attribute: ${attribute}`);
    this.name = 'ProvisionConflict';
  }
}
