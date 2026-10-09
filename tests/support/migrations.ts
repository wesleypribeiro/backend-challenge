import { projectRoot } from './process.js';
import type { TestInfrastructure } from './infrastructure.js';

export function runMigration(infra: TestInfrastructure, command: 'migrate' | 'rollback' | 'status', overrides: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', 'run', `db:${command}`], {
    cwd: projectRoot,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: infra.databaseUrl('migrator'), ...overrides,
    },
    stdout: 'pipe', stderr: 'pipe', timeout: 20_000,
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
