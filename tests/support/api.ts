import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { compiled } from './compiled.js';
import type { TestInfrastructure } from './infrastructure.js';
import { provisionEnvironment } from './sqs.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { createApiApplication } = await compiled<typeof import('../../src/bootstrap/api.js')>('dist/bootstrap/api.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');

export interface RunningApi {
  origin: string;
  close: () => Promise<void>;
}

/**
 * Boots the compiled API in-process on an ephemeral port against the isolated
 * test infrastructure. F6's HTTP suites exercise the real Nest application —
 * controllers, DI, exception filter and MikroORM request context — without a
 * container round-trip per request. Passing no infrastructure boots against a
 * dead endpoint (used by the transient-failure suite); SQS is never contacted.
 */
export async function startApi(
  infra?: TestInfrastructure,
  overrides: Record<string, string> = {},
): Promise<RunningApi> {
  const environment = {
    NODE_ENV: 'test',
    AWS_ENDPOINT_URL: 'http://127.0.0.1:4566',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    SQS_QUEUE_NAME: 'wager-transactions.fifo',
    SQS_DLQ_NAME: 'wager-transactions-dlq.fifo',
    ...(infra ? provisionEnvironment(infra) : {}),
    ...(infra ? { DATABASE_URL: infra.databaseUrl('app') } : {}),
    API_PORT: '0',
    ...overrides,
  };
  const app: INestApplication = await createApiApplication(
    loadConfiguration('api', environment),
    new JsonLogger('api', () => {}),
  );
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => app.close() };
}

export interface ApiJson {
  status: number;
  body: Record<string, unknown>;
}

/** fetch helper that always parses JSON and keeps the status visible. */
export async function apiJson(url: string, init?: RequestInit): Promise<ApiJson> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/** Seeds a wallet through the real HTTP surface; returns its ids. */
export async function seedWallet(origin: string, amount: string, currency = 'BRL') {
  const playerId = crypto.randomUUID();
  const created = await apiJson(`${origin}/wallets`, postJson(`${origin}/wallets`, {
    playerId,
    initialBalance: { amount, currency },
  }));
  if (created.status !== 201) throw new Error(`seedWallet failed: ${created.status} ${JSON.stringify(created.body)}`);
  return { playerId, walletId: created.body.id as string, currency };
}
