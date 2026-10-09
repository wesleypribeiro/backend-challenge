export const localEnvironment = {
  NODE_ENV: 'test',
  API_PORT: '0',
  DATABASE_URL: 'postgresql://wagering_app:local_test_password@127.0.0.1:5432/wagering',
  MIGRATION_DATABASE_URL: '',
  AWS_ENDPOINT_URL: 'http://127.0.0.1:4566',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_SESSION_TOKEN: '',
  SQS_QUEUE_NAME: 'wager-transactions.fifo',
  SQS_DLQ_NAME: 'wager-transactions-dlq.fifo',
} as const;

export function testProcessEnvironment(overrides: Record<string, string | undefined> = {}) {
  // Não herdar configuração/credenciais do ambiente de desenvolvimento.
  return { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', ...localEnvironment, ...overrides };
}
