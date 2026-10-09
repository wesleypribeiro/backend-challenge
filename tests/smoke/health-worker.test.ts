import { expect, test } from 'bun:test';
import { projectRoot } from '../support/process.js';
import { testProcessEnvironment } from '../support/environment.js';

test('compiled worker probe rejects invalid config with bounded JSON and no secret', () => {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', 'dist/bootstrap/health-worker.js'], {
    cwd: projectRoot, env: testProcessEnvironment({ DATABASE_URL: 'invalid-private-value' }),
    stdout: 'pipe', stderr: 'pipe', timeout: 2000,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  const line = JSON.parse(result.stderr.toString());
  expect(line).toMatchObject({ event: 'bootstrap.failed', errorType: 'ConfigurationError', variables: ['DATABASE_URL'] });
  expect(result.stderr.toString()).not.toContain('invalid-private-value');
});
