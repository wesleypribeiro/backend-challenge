import { expect, test } from 'bun:test';
import { ConfigurationError, loadConfiguration } from '../../src/platform/config/configuration.js';
import { localEnvironment, testProcessEnvironment } from '../support/environment.js';
import { projectRoot } from '../support/process.js';

test('configuration separates API, worker, migrator and provision requirements', () => {
  expect(loadConfiguration('api', localEnvironment).port).toBe(0);
  expect(loadConfiguration('worker', { ...localEnvironment, API_PORT: 'invalid' })).not.toHaveProperty('port');
  const migrator = loadConfiguration('migrator', {
    NODE_ENV: 'test',
    MIGRATION_DATABASE_URL: 'postgresql://wagering_migrator:local_password@localhost:5432/wagering',
    API_PORT: 'invalid',
  });
  expect(migrator).not.toHaveProperty('sqs');
  expect(migrator.database.poolMax).toBe(5);
  expect(loadConfiguration('provision', { ...localEnvironment, DATABASE_URL: undefined, API_PORT: undefined })).not.toHaveProperty('database');
  expect(() => loadConfiguration('worker', { ...localEnvironment, MIGRATION_DATABASE_URL: 'secret' })).toThrow('MIGRATION_DATABASE_URL');
});

test.each(['NODE_ENV', 'DATABASE_URL', 'AWS_ENDPOINT_URL', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SQS_QUEUE_NAME', 'SQS_DLQ_NAME'])(
  'rejects missing %s without SDK defaults', (name) => {
    expect(() => loadConfiguration('api', { ...localEnvironment, [name]: undefined })).toThrow(name);
  },
);

test.each([
  ['NODE_ENV', 'invalid'], ['API_PORT', '-1'], ['API_PORT', '65536'], ['API_PORT', '1.5'],
  ['PG_POOL_MAX', '0'], ['PG_CONNECT_TIMEOUT_MS', 'NaN'], ['PG_QUERY_TIMEOUT_MS', 'Infinity'],
  ['SHUTDOWN_TIMEOUT_MS', '25001'], ['SQS_REQUEST_TIMEOUT_MS', '20000'], ['SQS_MAX_ATTEMPTS', '0'],
  ['DATABASE_URL', 'postgresql://wagering_migrator:secret@localhost/db'],
  ['DATABASE_URL', 'https://wagering_app:secret@localhost/db'],
  ['SQS_QUEUE_NAME', 'standard-queue'], ['SQS_DLQ_NAME', 'wager-transactions.fifo'],
  ['AWS_REGION', 'eu-west-1'], ['AWS_ACCESS_KEY_ID', 'real-credentials'], ['AWS_SESSION_TOKEN', 'secret'],
])('rejects invalid %s = %s', (name, value) => {
  expect(() => loadConfiguration('api', { ...localEnvironment, [name]: value })).toThrow(name);
});

test.each([
  'https://sqs.us-east-1.amazonaws.com', 'https://sqs.us-east-1.amazonaws.com.cn',
  'http://localstack.attacker.test:4566', 'http://localhost@amazonaws.com',
  'http://user:secret@localstack:4566', 'http://localstack:4566/?token=secret',
  'file:///tmp/sqs', 'http://192.0.2.1:4566',
])('rejects non-local or credential-bearing SQS endpoint %s', (endpoint) => {
  expect(() => loadConfiguration('worker', { ...localEnvironment, AWS_ENDPOINT_URL: endpoint })).toThrow('AWS_ENDPOINT_URL');
});

test('explicit SQS config ignores AWS profile and service endpoint overrides', () => {
  const config = loadConfiguration('worker', {
    ...localEnvironment,
    AWS_PROFILE: 'production', AWS_ENDPOINT_URL_SQS: 'https://sqs.us-east-1.amazonaws.com',
  });
  expect(config.sqs.endpoint).toBe(localEnvironment.AWS_ENDPOINT_URL);
  expect(config.sqs.credentials).toEqual({ accessKeyId: 'test', secretAccessKey: 'test' });
  expect(Object.isFrozen(config.sqs.credentials)).toBe(true);
});

test('configuration diagnostics never include invalid values', () => {
  try {
    loadConfiguration('api', { ...localEnvironment, DATABASE_URL: 'postgresql://secret:password@host/db', AWS_SECRET_ACCESS_KEY: 'token-value' });
    throw new Error('Expected configuration failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).toContain('DATABASE_URL');
    for (const secret of ['postgresql://', 'password', 'token-value']) expect(String(error)).not.toContain(secret);
  }
});

test.each(['api', 'worker'])('compiled %s refuses missing SQS endpoint before starting', (role) => {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', `dist/bootstrap/${role}.js`], {
    cwd: projectRoot, env: testProcessEnvironment({ AWS_ENDPOINT_URL: '' }), timeout: 5000,
    stdout: 'pipe', stderr: 'pipe',
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('AWS_ENDPOINT_URL');
  expect(result.stdout.toString()).not.toContain('started');
});
