import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  CreateQueueCommand, GetQueueAttributesCommand, ListQueueTagsCommand, ListQueuesCommand,
  ReceiveMessageCommand, SendMessageCommand, SetQueueAttributesCommand, TagQueueCommand,
} from '@aws-sdk/client-sqs';
import { TestInfrastructure } from '../support/infrastructure.js';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';
import { acknowledgeTechnicalMessage, provisionEnvironment, receiveTechnicalMessage, runProvision } from '../support/sqs.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { SqsConnection } = await compiled<typeof import('../../src/platform/messaging/sqs/sqs-connection.js')>('dist/platform/messaging/sqs/sqs-connection.js');
const { provisionQueues } = await compiled<typeof import('../../src/platform/messaging/sqs/provision.js')>('dist/platform/messaging/sqs/provision.js');
const { createApiApplication } = await compiled<typeof import('../../src/bootstrap/api.js')>('dist/bootstrap/api.js');
const { createWorkerApplication } = await compiled<typeof import('../../src/bootstrap/worker.js')>('dist/bootstrap/worker.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');
let infra: TestInfrastructure;
beforeAll(async () => { infra = await TestInfrastructure.start(); }, 240_000);
afterAll(async () => { await infra?.cleanup(); }, 30_000);

test('compiled provision CLI is repeatable, preserves both queues/messages and supports real FIFO transport without scaffold consumption', async () => {
  const env = provisionEnvironment(infra);
  const appEnv = { ...localEnvironment, ...env, DATABASE_URL: infra.databaseUrl('app') };
  const api = await createApiApplication(loadConfiguration('api', appEnv), new JsonLogger('api', () => {}));
  const worker = await createWorkerApplication(loadConfiguration('worker', appEnv), new JsonLogger('worker', () => {}));
  try {
    await api.listen(0, '127.0.0.1');
    expect((await infra.sqs.send(new ListQueuesCommand({}))).QueueUrls ?? []).toEqual([]);
    const first = runProvision(env);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ event: 'provision.completed', runtime: 'bun:1.4.2' });
    const connection = api.get(SqsConnection);
    const main = await connection.resolveQueue(env.SQS_QUEUE_NAME!);
    const dlq = await worker.get(SqsConnection).resolveQueue(env.SQS_DLQ_NAME!);
    for (const [queue, retention] of [[main, '345600'], [dlq, '1209600']] as const) {
      expect(new URL(queue.url).origin).toBe(infra.sqsEndpoint);
      expect(queue.attributes).toMatchObject({
        FifoQueue: 'true', ContentBasedDeduplication: 'false', VisibilityTimeout: '60',
        ReceiveMessageWaitTimeSeconds: '20', MessageRetentionPeriod: retention,
      });
    }
    expect(JSON.parse(main.attributes.RedrivePolicy!)).toEqual({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 5 });
    expect(JSON.parse(dlq.attributes.RedriveAllowPolicy!)).toEqual({ redrivePermission: 'byQueue', sourceQueueArns: [main.arn] });
    expect(dlq.attributes.RedrivePolicy).toBeUndefined();
    const handler = connection.client.config.requestHandler;
    if (!('httpHandlerConfigs' in handler) || typeof handler.httpHandlerConfigs !== 'function') throw new Error('Expected Node HTTP handler under Bun');
    expect(handler.httpHandlerConfigs()).toMatchObject({
      connectionTimeout: 1000, requestTimeout: 25000, throwOnRequestTimeout: true,
    });

    const messages = [];
    for (const queue of [main, dlq]) {
      const body = JSON.stringify({ kind: 'infrastructure-probe', id: crypto.randomUUID() });
      const group = `technical-${crypto.randomUUID()}`;
      const dedup = crypto.randomUUID();
      await connection.client.send(new TagQueueCommand({ QueueUrl: queue.url, Tags: { preservation: group } }));
      const sent = await connection.client.send(new SendMessageCommand({
        QueueUrl: queue.url, MessageBody: body, MessageGroupId: group, MessageDeduplicationId: dedup,
      }));
      messages.push({ queue, body, group, dedup, id: sent.MessageId });
    }
    const second = runProvision({ ...env, AWS_PROFILE: 'unavailable-profile', AWS_ENDPOINT_URL_SQS: 'https://must-not-be-used.invalid', AWS_MAX_ATTEMPTS: '99' });
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout).event).toBe('provision.completed');
    for (const fixture of messages) {
      const current = await connection.resolveQueue(fixture.queue === main ? env.SQS_QUEUE_NAME! : env.SQS_DLQ_NAME!);
      expect(current.url).toBe(fixture.queue.url);
      expect(current.arn).toBe(fixture.queue.arn);
      expect(current.attributes.CreatedTimestamp).toBe(fixture.queue.attributes.CreatedTimestamp);
      expect((await connection.client.send(new ListQueueTagsCommand({ QueueUrl: current.url }))).Tags)
        .toEqual({ preservation: fixture.group });
      const received = await receiveTechnicalMessage(connection.client, current.url);
      expect(received.MessageId).toBe(fixture.id);
      expect(received.Body).toBe(fixture.body);
      expect(received.Attributes).toMatchObject({
        MessageGroupId: fixture.group, MessageDeduplicationId: fixture.dedup, ApproximateReceiveCount: '1',
      });
      await acknowledgeTechnicalMessage(connection.client, current.url, received);
      const empty = await connection.client.send(new ReceiveMessageCommand({ QueueUrl: current.url, WaitTimeSeconds: 1 }), { abortSignal: AbortSignal.timeout(3000) });
      expect(empty.Messages ?? []).toEqual([]);
      expect((await infra.sqs.send(new GetQueueAttributesCommand({ QueueUrl: current.url, AttributeNames: ['ApproximateNumberOfMessagesNotVisible'] }))).Attributes?.ApproximateNumberOfMessagesNotVisible).toBe('0');
    }
  } finally { await Promise.all([api.close(), worker.close()]); }
}, 30_000);

test('provision creates DLQ before main, resolves ARNs and performs only reads on a compatible rerun', async () => {
  const config = loadConfiguration('provision', provisionEnvironment(infra, '-order'));
  const connection = new SqsConnection(config.sqs);
  const commands: { command: string; name?: string }[] = [];
  connection.client.middlewareStack.add((next, context) => async (args) => {
    commands.push({ command: context.commandName!, ...(args.input && 'QueueName' in args.input ? { name: String(args.input.QueueName) } : {}) });
    return next(args); // Observar chamadas reais, sem substituir o serviço.
  }, { step: 'initialize', name: 'observeRealCommands' });
  try {
    await provisionQueues(connection, config.sqs);
    expect(commands.filter(({ command }) => command === 'CreateQueueCommand').map(({ name }) => name))
      .toEqual([config.sqs.dlqName, config.sqs.queueName]);
    commands.length = 0;
    await provisionQueues(connection, config.sqs);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every(({ command }) => ['GetQueueUrlCommand', 'GetQueueAttributesCommand'].includes(command))).toBe(true);
  } finally { connection.onModuleDestroy(); }
});

test('drift and incompatible queue type fail without mutation, deleting resources or losing messages', async () => {
  const env = provisionEnvironment(infra, '-conflict');
  expect(runProvision(env).code).toBe(0);
  const config = loadConfiguration('provision', env);
  const connection = new SqsConnection(config.sqs);
  try {
    const main = await connection.resolveQueue(config.sqs.queueName);
    const dlq = await connection.resolveQueue(config.sqs.dlqName);
    await connection.client.send(new SetQueueAttributesCommand({ QueueUrl: main.url, Attributes: { VisibilityTimeout: '61' } }));
    const sent = await connection.client.send(new SendMessageCommand({
      QueueUrl: main.url, MessageBody: 'preserve-on-conflict', MessageGroupId: 'technical-group', MessageDeduplicationId: crypto.randomUUID(),
    }));
    const failed = runProvision(env);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('SQS_QUEUE_CONFLICT');
    expect(failed.stderr).toContain('VisibilityTimeout');
    expect(failed.stderr).not.toContain(infra.sqsEndpoint);
    const preserved = await connection.resolveQueue(config.sqs.queueName);
    expect(preserved.attributes.VisibilityTimeout).toBe('61');
    expect(preserved.url).toBe(main.url);
    expect(await connection.resolveQueue(config.sqs.dlqName)).toEqual(dlq);
    const received = await receiveTechnicalMessage(connection.client, main.url);
    expect(received.MessageId).toBe(sent.MessageId);
    expect(received.Body).toBe('preserve-on-conflict');
    await acknowledgeTechnicalMessage(connection.client, main.url, received);

    // Defesa no provisionador: uma standard real exige recriação para virar FIFO.
    // O CLI também rejeita esse nome sem .fifo na validação de configuração.
    const standardName = `technical-standard-${crypto.randomUUID()}`;
    await connection.client.send(new CreateQueueCommand({ QueueName: standardName }));
    const standard = await connection.resolveQueue(standardName);
    const missingDlq = `technical-unused-${crypto.randomUUID()}.fifo`;
    await expect(provisionQueues(connection, { queueName: standardName, dlqName: missingDlq }))
      .rejects.toMatchObject({ code: 'SQS_QUEUE_CONFLICT', queueRole: 'main', attribute: 'FifoQueue' });
    expect(await connection.resolveQueue(standardName)).toEqual(standard);
    await expect(connection.resolveQueue(missingDlq)).rejects.toMatchObject({ name: 'QueueDoesNotExist' });
  } finally { connection.onModuleDestroy(); }
});
