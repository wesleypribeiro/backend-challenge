import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import type { SQSClient, Message } from '@aws-sdk/client-sqs';
import type { TestInfrastructure } from './infrastructure.js';
import { projectRoot } from './process.js';

export function provisionEnvironment(infra: TestInfrastructure, suffix = ''): Record<string, string> {
  const prefix = infra.queueName.slice(0, -5) + suffix;
  return {
    NODE_ENV: 'test', AWS_ENDPOINT_URL: infra.sqsEndpoint, AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
    SQS_QUEUE_NAME: `${prefix}.fifo`, SQS_DLQ_NAME: `${prefix}-dlq.fifo`,
    SQS_MAX_ATTEMPTS: '2', SQS_REQUEST_TIMEOUT_MS: '25000',
  };
}

export function runProvision(env: Record<string, string | undefined>) {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', 'run', 'infra:provision'], {
    cwd: projectRoot, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdout: 'pipe', stderr: 'pipe', timeout: 130_000,
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

export async function receiveTechnicalMessage(client: SQSClient, url: string): Promise<Message> {
  const signal = AbortSignal.timeout(5000);
  while (!signal.aborted) {
    const response = await client.send(new ReceiveMessageCommand({
      QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1, MessageSystemAttributeNames: ['All'],
    }), { abortSignal: signal });
    if (response.Messages?.[0]) return response.Messages[0];
  }
  throw new Error('Technical message was not received before deadline');
}

export async function acknowledgeTechnicalMessage(client: SQSClient, url: string, message: Message): Promise<void> {
  if (!message.ReceiptHandle) throw new Error('Technical message missing ReceiptHandle');
  await client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }), {
    abortSignal: AbortSignal.timeout(3000),
  });
}
