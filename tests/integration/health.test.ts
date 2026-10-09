import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SendMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { provisionEnvironment, runProvision, receiveTechnicalMessage, acknowledgeTechnicalMessage } from '../support/sqs.js';
import { startService, projectRoot } from '../support/process.js';

let infra: TestInfrastructure;
beforeAll(async () => { infra = await TestInfrastructure.start(); }, 240_000);
afterAll(async () => { await infra?.cleanup(); }, 30_000);

function workerProbe(env: Record<string, string>) {
  const started = performance.now();
  const child = Bun.spawnSync([process.execPath, '--no-env-file', 'run', 'health:worker'], {
    cwd: projectRoot, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdout: 'pipe', stderr: 'pipe', timeout: 3000,
  });
  expect(performance.now() - started).toBeLessThan(3000);
  expect(child.stderr.toString()).not.toContain(infra.databaseUrl('app'));
  return { code: child.exitCode, body: JSON.parse(child.stdout.toString()) };
}

test('public HTTP and worker checks reflect preparation, recover without restart and preserve SQL/messages', async () => {
  const env: Record<string, string> = { ...provisionEnvironment(infra), DATABASE_URL: infra.databaseUrl('app'), API_PORT: '0' };
  const api = startService('dist/bootstrap/api.js', env);
  try {
    const address = await api.waitFor(/"event":"process.started","port":(\d+)/);
    const origin = `http://127.0.0.1:${address[1]}`;
    const check = async (checks: { postgresql: string; sqs: string }) => {
      const live = await fetch(`${origin}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: 'ok' });
      const started = performance.now();
      const response = await fetch(`${origin}/health/ready`, { headers: { 'x-correlation-id': 'health-test' } });
      const body = await response.json();
      expect(performance.now() - started).toBeLessThan(2000);
      const healthy = Object.values(checks).every((value) => value === 'up');
      expect(response.status).toBe(healthy ? 200 : 503);
      expect(response.headers.get('x-correlation-id')).toBe('health-test');
      expect(body).toEqual({ status: healthy ? 'ok' : 'error', checks });
      expect(workerProbe(env)).toEqual({ code: healthy ? 0 : 1, body });
    };
    await check({ postgresql: 'down', sqs: 'down' });
    expect((await infra.query('app', "SELECT to_regclass('public.mikro_orm_migrations') AS history")).rows[0].history).toBeNull();
    expect(runMigration(infra, 'migrate').code).toBe(0);
    await check({ postgresql: 'up', sqs: 'down' });
    expect(runProvision(env).code).toBe(0);
    // Schema vazio descartável: histórico permanece legível, mas a migration fica pendente.
    expect(runMigration(infra, 'rollback').code).toBe(0);
    await check({ postgresql: 'down', sqs: 'up' });
    expect(runMigration(infra, 'migrate').code).toBe(0);
    const { GetQueueUrlCommand } = await import('@aws-sdk/client-sqs');
    const { QueueUrl } = await infra.sqs.send(new GetQueueUrlCommand({ QueueName: env.SQS_QUEUE_NAME! }));
    const sent = await infra.sqs.send(new SendMessageCommand({
      QueueUrl: QueueUrl!, MessageBody: 'technical-health-preservation',
      MessageGroupId: 'health-test', MessageDeduplicationId: crypto.randomUUID(),
    }));
    const history = (await infra.query('app', 'SELECT * FROM public.mikro_orm_migrations ORDER BY id')).rows;
    await check({ postgresql: 'up', sqs: 'up' });
    await check({ postgresql: 'up', sqs: 'up' });
    // Incompatibilidade real, sem excluir/recriar filas; probe não corrige o drift.
    await infra.sqs.send(new SetQueueAttributesCommand({ QueueUrl: QueueUrl!, Attributes: { VisibilityTimeout: '61' } }));
    await check({ postgresql: 'up', sqs: 'down' });
    await infra.sqs.send(new SetQueueAttributesCommand({ QueueUrl: QueueUrl!, Attributes: { VisibilityTimeout: '60' } }));
    await check({ postgresql: 'up', sqs: 'up' });
    expect((await infra.query('app', 'SELECT * FROM public.mikro_orm_migrations ORDER BY id')).rows).toEqual(history);
    expect((await infra.query('app', "SELECT tablename FROM pg_tables WHERE schemaname='wagering'")).rows).toEqual([]);
    const message = await receiveTechnicalMessage(infra.sqs, QueueUrl!);
    expect(message.MessageId).toBe(sent.MessageId);
    expect(message.Body).toBe('technical-health-preservation');
    expect(message.Attributes?.ApproximateReceiveCount).toBe('1');
    await acknowledgeTechnicalMessage(infra.sqs, QueueUrl!, message);
    await api.stop();
    const logs = api.output.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(logs.some((log) => log.event === 'health.degraded' && log.correlationId === 'health-test')).toBe(true);
    expect(api.output.stdout + api.output.stderr).not.toContain(infra.databaseUrl('app'));
  } finally { await api.stop(); }
}, 30_000);

test('unavailable real services degrade probes within budget while liveness stays independent', async () => {
  const env: Record<string, string> = { ...provisionEnvironment(infra), DATABASE_URL: infra.databaseUrl('app') };
  const api = startService('dist/bootstrap/api.js', env);
  try {
    const address = await api.waitFor(/"event":"process.started","port":(\d+)/);
    // Pause conserva as conexões TCP pendentes: exercita cancelamento real, sem mocks.
    await infra.compose(['pause', 'postgres', 'localstack']);
    try {
      const live = await fetch(`http://127.0.0.1:${address[1]}/health/live`);
      expect(live.status).toBe(200);
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${address[1]}/health/ready`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'error', checks: { postgresql: 'down', sqs: 'down' } });
      expect(performance.now() - start).toBeLessThan(2000);
      expect(workerProbe(env)).toEqual({ code: 1, body: { status: 'error', checks: { postgresql: 'down', sqs: 'down' } } });
    } finally { await infra.compose(['unpause', 'postgres', 'localstack']); }
    const response = await fetch(`http://127.0.0.1:${address[1]}/health/ready`);
    expect(response.status).toBe(200);
    expect(workerProbe(env).code).toBe(0);
    const sessions = await infra.query('app', "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='jungle-readiness'");
    expect(sessions.rows[0].count).toBe(0);
  } finally { await api.stop(); }
}, 20_000);
