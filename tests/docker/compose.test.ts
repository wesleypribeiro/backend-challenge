import { expect, test } from 'bun:test';
import { GetQueueAttributesCommand, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { TestInfrastructure, dockerCommand } from '../support/infrastructure.js';
import { receiveTechnicalMessage, acknowledgeTechnicalMessage } from '../support/sqs.js';

interface Container {
  Id: string;
  Config: { Env: string[]; Cmd: string[]; Labels: Record<string, string> };
  State: { Running: boolean; ExitCode: number; StartedAt: string; FinishedAt: string; Health?: { Status: string } };
  HostConfig: { PortBindings: Record<string, unknown> | null };
}

async function inspect(id: string): Promise<Container> {
  return JSON.parse(await dockerCommand(['inspect', id]))[0];
}

test('compiled Compose foundation gates startup, scales three workers, probes and drains without consuming messages', async () => {
  const infra = await TestInfrastructure.start();
  let built = false;
  try {
    await infra.compose(['--profile', 'foundation', 'build', 'api'], 300_000);
    built = true;
    await infra.compose(['--profile', 'foundation', 'up', '--detach', '--no-build', '--scale', 'worker=3', '--wait', '--wait-timeout', '120'], 240_000);
    const all = await Promise.all((await infra.resources('container')).map(inspect));
    const service = (name: string) => all.filter((c) => c.Config.Labels['com.docker.compose.service'] === name);
    const api = service('api')[0]!;
    const workers = service('worker');
    expect(workers).toHaveLength(3);
    expect(new Set(workers.map((w) => w.Id)).size).toBe(3);
    for (const name of ['migrate', 'provision']) {
      const job = service(name)[0]!;
      expect(job.State.ExitCode).toBe(0);
      expect(job.State.Running).toBe(false);
      for (const app of [api, ...workers]) expect(Date.parse(app.State.StartedAt)).toBeGreaterThanOrEqual(Date.parse(job.State.FinishedAt));
    }
    for (const app of [api, ...workers]) {
      expect(app.State.Health?.Status).toBe('healthy');
      expect(app.Config.Env.some((v) => v.startsWith('DATABASE_URL=postgresql://wagering_app:'))).toBe(true);
      expect(app.Config.Env.some((v) => v.startsWith('MIGRATION_DATABASE_URL=') || v.startsWith('WAGERING_MIGRATOR_PASSWORD='))).toBe(false);
      expect(app.Config.Env.join('\n')).not.toContain('local_test_migrator_password');
    }
    for (const w of workers) expect(Object.keys(w.HostConfig.PortBindings ?? {})).toEqual([]);
    const migratorEnv = service('migrate')[0]!.Config.Env.join('\n');
    expect(migratorEnv).toContain('MIGRATION_DATABASE_URL=postgresql://wagering_migrator:');
    expect(migratorEnv).not.toContain('AWS_ACCESS_KEY_ID=');
    const provisionEnv = service('provision')[0]!.Config.Env.join('\n');
    expect(provisionEnv).not.toContain('DATABASE_URL=');
    expect(provisionEnv).not.toContain('local_test_app_password');

    const origin = `http://127.0.0.1:${await infra.port('api', 3000)}`;
    const live = await fetch(`${origin}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });
    const ready = await fetch(`${origin}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok', checks: { postgresql: 'up', sqs: 'up' } });
    const history = (await infra.query('app', 'SELECT name FROM public.mikro_orm_migrations ORDER BY name')).rows;
    expect(history).toEqual([
      { name: 'Migration20261009000100' },
      { name: 'Migration20261009000200' },
      { name: 'Migration20261009000300' },
    ]);
    expect((await infra.query('app', "SELECT tablename FROM pg_tables WHERE schemaname='wagering' ORDER BY tablename COLLATE \"C\"")).rows)
      .toEqual([{ tablename: 'outbox_event' }, { tablename: 'wager_transaction' }, { tablename: 'wallet' }, { tablename: 'wallet_ledger_entry' }]);
    const { QueueUrl } = await infra.sqs.send(new GetQueueUrlCommand({ QueueName: infra.queueName }));
    const sent = await infra.sqs.send(new SendMessageCommand({
      QueueUrl: QueueUrl!, MessageBody: 'technical-scaffold-does-not-consume',
      MessageGroupId: 'scaffold-test', MessageDeduplicationId: crypto.randomUUID(),
    }));
    // Cada CLI é executado na própria imagem, sem fontes ou endpoint HTTP de worker.
    for (const w of workers) {
      const started = performance.now();
      const output = await dockerCommand(['exec', w.Id, 'bun', 'run', 'health:worker']);
      expect(performance.now() - started).toBeLessThan(2000);
      expect(JSON.parse(output)).toEqual({ status: 'ok', checks: { postgresql: 'up', sqs: 'up' } });
    }
    expect((await infra.sqs.send(new GetQueueAttributesCommand({ QueueUrl: QueueUrl!, AttributeNames: ['ApproximateNumberOfMessagesNotVisible'] }))).Attributes?.ApproximateNumberOfMessagesNotVisible).toBe('0');
    // Configuração inválida na imagem deve falhar de forma segura antes do boot.
    const invalidName = `jungle-invalid-${crypto.randomUUID()}`;
    try {
      await dockerCommand(['run', '--name', invalidName, '--network', 'none', '--env', 'NODE_ENV=production', '--env', 'DATABASE_URL=secret-invalid-url', infra.image, 'dist/bootstrap/api.js']).then(
        () => { throw new Error('Invalid configuration unexpectedly succeeded'); },
        (error: unknown) => { expect(error).toBeInstanceOf(Error); },
      );
      const invalid = await inspect(invalidName);
      expect(invalid.State.ExitCode).toBe(1);
      const log = await dockerCommand(['logs', invalidName]);
      expect(log).toContain('bootstrap.failed');
      expect(log).toContain('ConfigurationError');
      expect(log).not.toContain('secret-invalid-url');
    } finally { await dockerCommand(['rm', '--force', invalidName]); }

    const started = performance.now();
    await dockerCommand(['kill', '--signal', 'SIGINT', workers[0]!.Id]);
    expect(await dockerCommand(['wait', workers[0]!.Id], {}, 30_000)).toBe('0');
    expect((await inspect(workers[1]!.Id)).State.Running).toBe(true);
    await infra.compose(['stop', '--timeout', '30', 'api', 'worker'], 40_000);
    expect(performance.now() - started).toBeLessThan(25_000);
    for (const c of [api, ...workers]) {
      const stopped = await inspect(c.Id);
      expect(stopped.State.Running).toBe(false);
      expect(stopped.State.ExitCode).toBe(0);
      const logs = await dockerCommand(['logs', c.Id]);
      expect(logs).toContain('"event":"process.draining"');
      expect(logs).toContain('"event":"process.stopped"');
      expect(logs).not.toContain('shutdown.failed');
    }
    const message = await receiveTechnicalMessage(infra.sqs, QueueUrl!);
    expect(message.MessageId).toBe(sent.MessageId);
    expect(message.Body).toBe('technical-scaffold-does-not-consume');
    expect(message.Attributes?.ApproximateReceiveCount).toBe('1');
    await acknowledgeTechnicalMessage(infra.sqs, QueueUrl!, message);
    expect((await infra.query('app', 'SELECT name FROM public.mikro_orm_migrations')).rows).toEqual(history);
  } finally {
    await infra.cleanup();
    if (built) await dockerCommand(['image', 'rm', infra.image]);
  }
}, 600_000);
