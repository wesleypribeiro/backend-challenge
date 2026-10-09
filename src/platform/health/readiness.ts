import { Socket } from 'node:net';
import { Client } from 'pg';
import type { ConfigurationByRole } from '../config/configuration.js';
import { migrationNames } from '../database/migration-catalog.js';
import { SqsConnection } from '../messaging/sqs/sqs-connection.js';
import { checkTopology } from '../messaging/sqs/queue-topology.js';

type Configuration = ConfigurationByRole['api'] | ConfigurationByRole['worker'];
export type CheckStatus = 'up' | 'down';
export interface HealthResult {
  status: 'ok' | 'error';
  checks: { postgresql: CheckStatus; sqs: CheckStatus };
  reason?: 'shutting_down';
}

// Reserva 300 ms do orçamento externo de 2 s para bootstrap CLI, cleanup e serialização.
export const probeTimeoutMs = 1700;

async function postgresqlCheck(config: Configuration['database'], signal: AbortSignal): Promise<void> {
  const url = new URL(config.url);
  const socket = new Socket();
  const client = new Client({
    host: decodeURIComponent(url.hostname), port: Number(url.port || '5432'),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    stream: () => socket,
    connectionTimeoutMillis: Math.min(config.connectTimeoutMs, 1000),
    statement_timeout: Math.min(config.queryTimeoutMs, 1500),
    query_timeout: Math.min(config.queryTimeoutMs, 1500),
    application_name: 'jungle-readiness',
    options: '-c default_transaction_read_only=on',
  });
  // O socket pertence exclusivamente a este probe; abortar não afeta o pool de trabalho.
  const cancel = () => { socket.destroy(); };
  client.on('error', cancel);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect();
    await client.query('SELECT 1');
    const result = await client.query<{ name: string }>('SELECT name FROM public.mikro_orm_migrations');
    if (!migrationNames.every((name) => result.rows.some((row) => row.name === name))) {
      throw new Error('Pending migrations');
    }
    const schema = await client.query<{ present: boolean }>("SELECT to_regnamespace('wagering') IS NOT NULL AS present");
    if (!schema.rows[0]?.present) throw new Error('Missing schema');
    signal.throwIfAborted();
  } finally {
    // Desconexão física também interrompe consultas pendentes (não apenas Promise.race).
    socket.destroy();
    await client.end();
    signal.removeEventListener('abort', cancel);
  }
}

async function sqsCheck(config: Configuration['sqs'], signal: AbortSignal): Promise<void> {
  const connection = new SqsConnection({ ...config, maxAttempts: 1, requestTimeoutMs: probeTimeoutMs });
  const cancel = () => connection.onModuleDestroy();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const [main, dlq] = await Promise.all([
      connection.resolveQueue(config.queueName, signal), connection.resolveQueue(config.dlqName, signal),
    ]);
    checkTopology(main, dlq);
    signal.throwIfAborted();
  } finally {
    cancel();
    signal.removeEventListener('abort', cancel);
  }
}

export class Readiness {
  private draining = false;
  private readonly active = new Set<AbortController>();
  constructor(private readonly config: Configuration) {}

  beginDraining(): void {
    this.draining = true;
    for (const controller of this.active) controller.abort();
  }

  async check(): Promise<HealthResult> {
    if (this.draining) return { status: 'error', checks: { postgresql: 'down', sqs: 'down' }, reason: 'shutting_down' };
    const controller = new AbortController();
    this.active.add(controller);
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
    const status = async (operation: Promise<void>): Promise<CheckStatus> => {
      try { await operation; return 'up'; } catch { return 'down'; }
    };
    try {
      const [postgresql, sqs] = await Promise.all([
        status(postgresqlCheck(this.config.database, controller.signal)),
        status(sqsCheck(this.config.sqs, controller.signal)),
      ]);
      return {
        status: !this.draining && postgresql === 'up' && sqs === 'up' ? 'ok' : 'error',
        checks: { postgresql, sqs }, ...(this.draining ? { reason: 'shutting_down' as const } : {}),
      };
    } finally { clearTimeout(timer); this.active.delete(controller); }
  }
}
