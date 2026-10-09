import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestInfrastructure, dockerCommand } from '../support/infrastructure.js';

test('failed one-shot jobs prevent API/worker startup without deleting prepared resources', async () => {
  const infra = await TestInfrastructure.start();
  const directory = await mkdtemp(join(tmpdir(), 'jungle-compose-failure-'));
  let built = false;
  try {
    await infra.compose(['--profile', 'foundation', 'build', 'api'], 300_000);
    built = true;
    for (const role of ['migrate', 'provision'] as const) {
      const override = join(directory, `${role}.json`);
      const environment = role === 'migrate' ? { MIGRATION_DATABASE_URL: 'invalid-secret-url' } : { SQS_QUEUE_NAME: 'invalid-standard-name' };
      await writeFile(override, JSON.stringify({ services: { [role]: { environment } } }));
      await expect(infra.compose(['-f', override, '--profile', 'foundation', 'up', '--detach', '--no-build', 'api', 'worker'], 120_000)).rejects.toThrow('Docker compose failed');
      const containers = await Promise.all((await infra.resources('container')).map(async (id) => JSON.parse(await dockerCommand(['inspect', id]))[0]));
      const job = containers.find((c) => c.Config.Labels['com.docker.compose.service'] === role);
      expect(job.State.ExitCode).toBe(1);
      const logs = await dockerCommand(['logs', job.Id]);
      expect(logs).toContain(role === 'migrate' ? 'migration.failed' : 'provision.failed');
      expect(logs).toContain('ConfigurationError');
      expect(logs).not.toContain('invalid-secret-url');
      for (const app of containers.filter((c) => ['api', 'worker'].includes(c.Config.Labels['com.docker.compose.service']))) {
        expect(app.State.Running).toBe(false);
        expect(app.State.StartedAt).toBe('0001-01-01T00:00:00Z');
      }
      expect((await infra.query('app', 'SELECT 1 AS alive')).rows[0].alive).toBe(1);
      // Só containers deste projeto descartável; volumes/filas são preservados.
      await infra.compose(['--profile', 'foundation', 'rm', '--stop', '--force', 'api', 'worker', 'migrate', 'provision']);
    }
  } finally {
    await infra.cleanup();
    if (built) await dockerCommand(['image', 'rm', infra.image]);
    await rm(directory, { recursive: true, force: true });
  }
}, 600_000);
