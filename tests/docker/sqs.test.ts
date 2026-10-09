import { expect, test } from 'bun:test';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { compiled } from '../support/compiled.js';
import { dockerCommand, withTestInfrastructure } from '../support/infrastructure.js';
import { provisionEnvironment, receiveTechnicalMessage, acknowledgeTechnicalMessage } from '../support/sqs.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { SqsConnection } = await compiled<typeof import('../../src/platform/messaging/sqs/sqs-connection.js')>('dist/platform/messaging/sqs/sqs-connection.js');

test('compiled Docker provision and SQS client preserve queues and exchange technical FIFO messages with the host', async () => {
  const image = `jungle-sqs-test:${crypto.randomUUID()}`;
  let built = false;
  try {
    await dockerCommand(['build', '--target', 'runtime', '--tag', image, '.'], {}, 300_000);
    built = true;
    await withTestInfrastructure(async (infra) => {
      const [network] = await infra.resources('network');
      if (!network) throw new Error('Test network missing');
      const env = provisionEnvironment(infra);
      // Endpoint é configuração da rede Compose; URLs/ARNs das filas sempre vêm do serviço.
      const containerEnv = Object.entries({ ...env, AWS_ENDPOINT_URL: 'http://localstack:4566' })
        .flatMap(([key, value]) => ['--env', `${key}=${value}`]);
      const run = (args: string[]) => dockerCommand(['run', '--rm', '--network', network, ...containerEnv, image, ...args]);
      expect(JSON.parse(await run(['run', 'infra:provision']))).toMatchObject({ event: 'provision.completed', runtime: 'bun:1.4.2' });
      const connection = new SqsConnection(loadConfiguration('provision', env).sqs);
      try {
        const main = await connection.resolveQueue(env.SQS_QUEUE_NAME!);
        const dlq = await connection.resolveQueue(env.SQS_DLQ_NAME!);
        const sent = await connection.client.send(new SendMessageCommand({
          QueueUrl: main.url, MessageBody: 'host-to-container-probe', MessageGroupId: 'technical-group',
          MessageDeduplicationId: crypto.randomUUID(),
        }));
        expect(JSON.parse(await run(['run', 'infra:provision'])).event).toBe('provision.completed');
        const result = JSON.parse(await run(['--eval', `
          import assert from 'node:assert/strict';
          import { existsSync } from 'node:fs';
          import { SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
          import { loadConfiguration } from './dist/platform/config/configuration.js';
          import { SqsConnection } from './dist/platform/messaging/sqs/sqs-connection.js';
          const config = loadConfiguration('provision');
          const connection = new SqsConnection(config.sqs);
          try {
            const main = await connection.resolveQueue(config.sqs.queueName);
            const dlq = await connection.resolveQueue(config.sqs.dlqName);
            const { Messages = [] } = await connection.client.send(new ReceiveMessageCommand({
              QueueUrl: main.url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1, MessageSystemAttributeNames: ['All'],
            }), { abortSignal: AbortSignal.timeout(5000) });
            assert.equal(Messages.length, 1);
            const message = Messages[0];
            assert.ok(message.ReceiptHandle);
            await connection.client.send(new DeleteMessageCommand({ QueueUrl: main.url, ReceiptHandle: message.ReceiptHandle }));
            const empty = await connection.client.send(new ReceiveMessageCommand({ QueueUrl: main.url, WaitTimeSeconds: 1 }));
            const reverse = await connection.client.send(new SendMessageCommand({
              QueueUrl: dlq.url, MessageBody: 'container-to-host-probe', MessageGroupId: 'technical-reverse', MessageDeduplicationId: crypto.randomUUID(),
            }));
            console.log(JSON.stringify({
              main, dlq, id: message.MessageId, body: message.Body, count: message.Attributes.ApproximateReceiveCount,
              remaining: empty.Messages ?? [], reverseId: reverse.MessageId,
              sources: existsSync('src'), fixtures: existsSync('tests'), bun: Bun.version,
            }));
          } finally { connection.onModuleDestroy(); }
        `]));
        expect(result.bun).toBe('1.4.2');
        expect(result.sources).toBe(false);
        expect(result.fixtures).toBe(false);
        expect(result.main.arn).toBe(main.arn);
        expect(result.dlq.arn).toBe(dlq.arn);
        expect(result.main.attributes.CreatedTimestamp).toBe(main.attributes.CreatedTimestamp);
        expect(result.dlq.attributes.CreatedTimestamp).toBe(dlq.attributes.CreatedTimestamp);
        expect(new URL(result.main.url).origin).toBe('http://localstack:4566');
        expect(new URL(main.url).origin).toBe(infra.sqsEndpoint);
        expect(JSON.parse(result.main.attributes.RedrivePolicy)).toEqual({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 5 });
        expect(JSON.parse(result.dlq.attributes.RedriveAllowPolicy)).toEqual({ redrivePermission: 'byQueue', sourceQueueArns: [main.arn] });
        expect(result.id).toBe(sent.MessageId);
        expect(result.body).toBe('host-to-container-probe');
        expect(result.count).toBe('1');
        expect(result.remaining).toEqual([]);
        const reverse = await receiveTechnicalMessage(connection.client, dlq.url);
        expect(reverse.MessageId).toBe(result.reverseId);
        expect(reverse.Body).toBe('container-to-host-probe');
        await acknowledgeTechnicalMessage(connection.client, dlq.url, reverse);
      } finally { connection.onModuleDestroy(); }
    });
  } finally {
    if (built) await dockerCommand(['image', 'rm', image]);
  }
}, 600_000);
