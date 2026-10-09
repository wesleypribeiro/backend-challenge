import type { ResolvedQueue } from './sqs-connection.js';
import { ProvisionConflict } from './provision-conflict.js';
import type { QueueAttribute, QueueRole } from './provision-conflict.js';

const common = {
  FifoQueue: 'true', ContentBasedDeduplication: 'false',
  VisibilityTimeout: '60', ReceiveMessageWaitTimeSeconds: '20',
} as const;
export const queueAttributes = {
  main: { ...common, MessageRetentionPeriod: '345600' },
  dlq: { ...common, MessageRetentionPeriod: '1209600' },
} as const;

export function checkBase(queue: ResolvedQueue, role: QueueRole): void {
  for (const [key, value] of Object.entries(queueAttributes[role])) {
    if (queue.attributes[key] !== value) throw new ProvisionConflict(role, key as QueueAttribute);
  }
  if (role === 'dlq' && queue.attributes.RedrivePolicy) throw new ProvisionConflict(role, 'RedrivePolicy');
}

function policy(value: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function checkRedrive(main: ResolvedQueue, dlq: ResolvedQueue | undefined): void {
  const actual = policy(main.attributes.RedrivePolicy);
  if (!dlq || actual.deadLetterTargetArn !== dlq.arn || String(actual.maxReceiveCount) !== '5') {
    throw new ProvisionConflict('main', 'RedrivePolicy');
  }
}

export function checkAllow(dlq: ResolvedQueue, main: ResolvedQueue | undefined): void {
  const actual = policy(dlq.attributes.RedriveAllowPolicy);
  if (!main || actual.redrivePermission !== 'byQueue' || !Array.isArray(actual.sourceQueueArns) ||
      actual.sourceQueueArns.length !== 1 || actual.sourceQueueArns[0] !== main.arn) {
    throw new ProvisionConflict('dlq', 'RedriveAllowPolicy');
  }
}

export function checkTopology(main: ResolvedQueue, dlq: ResolvedQueue): void {
  checkBase(main, 'main');
  checkBase(dlq, 'dlq');
  checkRedrive(main, dlq);
  checkAllow(dlq, main);
}
