import { CreateQueueCommand, QueueDoesNotExist, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { SqsConnection } from './sqs-connection.js';
import type { ResolvedQueue, SqsConfiguration } from './sqs-connection.js';
import { ProvisionConflict } from './provision-conflict.js';
import type { QueueAttribute, QueueRole } from './provision-conflict.js';

const common = {
  FifoQueue: 'true', ContentBasedDeduplication: 'false',
  VisibilityTimeout: '60', ReceiveMessageWaitTimeSeconds: '20',
} as const;
const attributes = {
  main: { ...common, MessageRetentionPeriod: '345600' },
  dlq: { ...common, MessageRetentionPeriod: '1209600' },
} as const;

function checkBase(queue: ResolvedQueue, role: QueueRole): void {
  for (const [key, value] of Object.entries(attributes[role])) {
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

function checkRedrive(main: ResolvedQueue, dlq: ResolvedQueue | undefined): void {
  const actual = policy(main.attributes.RedrivePolicy);
  if (!dlq || actual.deadLetterTargetArn !== dlq.arn || String(actual.maxReceiveCount) !== '5') {
    throw new ProvisionConflict('main', 'RedrivePolicy');
  }
}

function checkAllow(dlq: ResolvedQueue, main: ResolvedQueue | undefined): void {
  const actual = policy(dlq.attributes.RedriveAllowPolicy);
  if (!main || actual.redrivePermission !== 'byQueue' || !Array.isArray(actual.sourceQueueArns) ||
      actual.sourceQueueArns.length !== 1 || actual.sourceQueueArns[0] !== main.arn) {
    throw new ProvisionConflict('dlq', 'RedriveAllowPolicy');
  }
}

export async function provisionQueues(
  connection: SqsConnection,
  names: Pick<SqsConfiguration, 'queueName' | 'dlqName'>,
  signal = AbortSignal.timeout(120_000),
): Promise<{ main: ResolvedQueue; dlq: ResolvedQueue }> {
  async function find(name: string): Promise<ResolvedQueue | undefined> {
    try { return await connection.resolveQueue(name, signal); }
    catch (error) {
      if (error instanceof QueueDoesNotExist) return undefined;
      throw error;
    }
  }

  // Preflight de ambas antes de criar/alterar qualquer recurso existente.
  let dlq = await find(names.dlqName);
  let main = await find(names.queueName);
  if (dlq) checkBase(dlq, 'dlq');
  if (main) { checkBase(main, 'main'); checkRedrive(main, dlq); }
  if (dlq?.attributes.RedriveAllowPolicy) checkAllow(dlq, main);

  if (!dlq) {
    await connection.client.send(new CreateQueueCommand({
      QueueName: names.dlqName, Attributes: attributes.dlq,
    }), { abortSignal: signal });
    dlq = await connection.resolveQueue(names.dlqName, signal);
  }
  if (!main) {
    await connection.client.send(new CreateQueueCommand({
      QueueName: names.queueName,
      Attributes: {
        ...attributes.main,
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 5 }),
      },
    }), { abortSignal: signal });
    main = await connection.resolveQueue(names.queueName, signal);
  }
  // Completar a ligação inicial após conhecer o ARN real da principal. Não reconciliar drift.
  if (!dlq.attributes.RedriveAllowPolicy) {
    await connection.client.send(new SetQueueAttributesCommand({
      QueueUrl: dlq.url,
      Attributes: { RedriveAllowPolicy: JSON.stringify({ redrivePermission: 'byQueue', sourceQueueArns: [main.arn] }) },
    }), { abortSignal: signal });
  }
  // Sucesso exige leitura dos atributos efetivos do emulador, não apenas resposta de Create/Set.
  dlq = await connection.resolveQueue(names.dlqName, signal);
  main = await connection.resolveQueue(names.queueName, signal);
  checkBase(dlq, 'dlq');
  checkBase(main, 'main');
  checkRedrive(main, dlq);
  checkAllow(dlq, main);
  return { main, dlq };
}
