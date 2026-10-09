import { expect, test } from 'bun:test';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';
import { runProvision } from '../support/sqs.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { SqsConnection } = await compiled<typeof import('../../src/platform/messaging/sqs/sqs-connection.js')>('dist/platform/messaging/sqs/sqs-connection.js');

test('SQS client uses explicit validated endpoint, credentials and retry limits', async () => {
  const settings = loadConfiguration('provision', {
    ...localEnvironment, AWS_PROFILE: 'must-not-be-used', AWS_MAX_ATTEMPTS: '99',
    AWS_ENDPOINT_URL_SQS: 'https://must-not-be-used.invalid', SQS_MAX_ATTEMPTS: '2',
  });
  const connection = new SqsConnection(settings.sqs);
  try {
    const config = connection.client.config;
    expect((await config.endpoint?.())?.hostname).toBe('127.0.0.1');
    expect(await config.region()).toBe('us-east-1');
    expect(await config.credentials()).toMatchObject({ accessKeyId: 'test', secretAccessKey: 'test' });
    expect(await config.maxAttempts()).toBe(2);
    expect(typeof config.retryMode === 'function' ? await config.retryMode() : config.retryMode).toBe('standard');
    expect(config.useQueueUrlAsEndpoint).toBe(false);
    expect(Object.isFrozen(settings.sqs.credentials)).toBe(true);
    expect(settings.sqs.credentials).toEqual({ accessKeyId: 'test', secretAccessKey: 'test' });
  } finally { connection.onModuleDestroy(); }
});

test.each([
  { AWS_ENDPOINT_URL: undefined },
  { AWS_ENDPOINT_URL: 'https://sqs.us-east-1.amazonaws.com' },
  { AWS_SECRET_ACCESS_KEY: 'invalid-secret-must-not-leak' },
  { SQS_QUEUE_NAME: 'standard-queue' },
])('compiled provision CLI refuses invalid local configuration before network access: %j', (override) => {
  const result = runProvision({
    ...localEnvironment, AWS_ENDPOINT_URL_SQS: 'https://must-not-be-used.invalid', ...override,
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  const diagnostics = result.stderr.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  expect(diagnostics).toEqual([expect.objectContaining({ event: 'provision.failed', errorType: 'ConfigurationError' })]);
  expect(result.stderr).not.toContain('invalid-secret-must-not-leak');
  expect(result.stderr).not.toContain('https://');
});
