import { expect, test } from 'bun:test';
import { JsonLogger } from '../../src/platform/logging/json-logger.js';
import { requestContext } from '../../src/platform/logging/request-context.js';
import { projectRoot, startService } from '../support/process.js';
import { testProcessEnvironment } from '../support/environment.js';

function records(output: string): Record<string, unknown>[] {
  return output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('logger uses a safe allowlist for errors and arbitrary Nest messages', () => {
  const lines: string[] = [];
  const logger = new JsonLogger('api', (line) => lines.push(line));
  const secret = 'must-never-be-logged';
  const error = Object.assign(new Error(`postgresql://user:${secret}@database/db?token=${secret}`), {
    code: 'ECONNREFUSED', cause: { Authorization: `Bearer ${secret}` },
  });
  requestContext.run({ correlationId: 'request-123' }, () => {
    logger.error(error, secret, { password: secret });
    logger.log({ headers: { authorization: secret }, body: { amount: '25.00' }, token: secret });
    logger.warn(secret); logger.debug(secret); logger.verbose(secret); logger.fatal(error);
  });
  expect(lines).toHaveLength(6);
  expect(lines.join('\n')).not.toContain(secret);
  expect(lines.join('\n')).not.toContain('postgresql://');
  expect(lines.join('\n')).not.toContain('25.00');
  const parsed = records(lines.join('\n'));
  expect(parsed[0]?.errorCode).toBe('ECONNREFUSED');
  for (const line of parsed) {
    expect(line.service).toBe('jungle-api');
    expect(line.correlationId).toBe('request-123');
    expect(Number.isNaN(Date.parse(String(line.timestamp)))).toBe(false);
  }
});

test('compiled API propagates or generates correlation IDs and logs JSON through shutdown', async () => {
  const api = startService('dist/bootstrap/api.js');
  try {
    const address = await api.waitFor(/"event":"process.started","port":(\d+)/);
    const accepted: string[] = [];
    for (const header of [undefined, 'provider-a:request.123_ok', 'invalid value', 'x'.repeat(129), 'x'.repeat(128)]) {
      const response = await fetch(`http://127.0.0.1:${address[1]}/unimplemented?token=secret-query`, {
        headers: { ...(header ? { 'x-correlation-id': header } : {}), authorization: 'Bearer secret-header' },
      });
      expect(response.status).toBe(404);
      const id = response.headers.get('x-correlation-id')!;
      if (header && /^[A-Za-z0-9._:-]{1,128}$/.test(header)) expect(id).toBe(header);
      else expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      accepted.push(id);
    }
    await api.stop();
    const logs = records(api.output.stdout + api.output.stderr);
    expect(logs.filter((line) => line.event === 'http.completed').map((line) => line.correlationId)).toEqual(accepted);
    expect(logs.map((line) => line.event)).toContain('process.stopping');
    expect(logs.map((line) => line.event)).toContain('process.stopped');
    expect(api.output.stdout + api.output.stderr).not.toContain('secret-query');
    expect(api.output.stdout + api.output.stderr).not.toContain('secret-header');
  } finally { await api.stop(); }
});

test('concurrent HTTP errors retain their own correlation ID without exposing connection credentials', async () => {
  // Middleware técnico somente no processo do teste; nenhum endpoint adicionado à aplicação.
  const code = `
    import { createApiApplication } from './dist/bootstrap/api.js';
    import { JsonLogger } from './dist/platform/logging/json-logger.js';
    const app = await createApiApplication();
    const logger = app.get(JsonLogger);
    app.use('/technical-error', (request, response) => {
      setTimeout(() => {
        logger.error(Object.assign(new Error('postgresql://wagering_app:secret-password@db/wagering?token=secret-token'), {code:'ECONNREFUSED'}));
        response.statusCode = 503;
        response.end('unavailable');
      }, Number(request.headers['x-delay']));
    });
    app.enableShutdownHooks(['SIGTERM']);
    await app.listen(0, '127.0.0.1');
    logger.event('process.started', {port: Number(new URL(await app.getUrl()).port)});
  `;
  const api = startService('--eval', {}, [code]);
  try {
    const address = await api.waitFor(/"event":"process.started","port":(\d+)/);
    const ids = Array.from({ length: 12 }, (_, index) => `concurrent-${index}`);
    await Promise.all(ids.map(async (id, index) => {
      const response = await fetch(`http://127.0.0.1:${address[1]}/technical-error`, {
        headers: { 'x-correlation-id': id, 'x-delay': String(12 - index), authorization: 'Bearer secret-token' },
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('x-correlation-id')).toBe(id);
    }));
    await api.stop();
    const errors = records(api.output.stderr);
    expect(errors.map((line) => line.correlationId).sort()).toEqual(ids.sort());
    for (const error of errors) {
      expect(error.service).toBe('jungle-api');
      expect(error.event).toBe('nest.error');
      expect(error.errorCode).toBe('ECONNREFUSED');
    }
    for (const secret of ['postgresql://', 'secret-password', 'secret-token']) expect(api.output.stdout + api.output.stderr).not.toContain(secret);
  } finally { await api.stop(); }
});

test.each(['api', 'worker'])('compiled %s configuration failure emits safe JSON and exits nonzero', (role) => {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', `dist/bootstrap/${role}.js`], {
    cwd: projectRoot,
    env: testProcessEnvironment({ DATABASE_URL: 'postgresql://wrong-user:secret-password@db/wagering', AWS_SECRET_ACCESS_KEY: 'secret-token' }),
    stdout: 'pipe', stderr: 'pipe', timeout: 5000,
  });
  expect(result.exitCode).toBe(1);
  const [log] = records(result.stderr.toString());
  expect(log?.event).toBe('bootstrap.failed');
  expect(log?.service).toBe(`jungle-${role}`);
  expect(log?.variables).toEqual(['AWS_SECRET_ACCESS_KEY', 'DATABASE_URL']);
  expect(result.stderr.toString()).not.toContain('secret-password');
  expect(result.stderr.toString()).not.toContain('secret-token');
});

test('compiled worker emits structured lifecycle events', async () => {
  const worker = startService('dist/bootstrap/worker.js');
  try {
    await worker.waitFor(/"event":"process.started"/);
    await worker.stop();
    const logs = records(worker.output.stdout + worker.output.stderr);
    expect(logs.every((line) => line.service === 'jungle-worker')).toBe(true);
    for (const event of ['process.starting', 'process.started', 'process.stopping', 'process.stopped']) {
      expect(logs.some((line) => line.event === event)).toBe(true);
    }
  } finally { await worker.stop(); }
});
