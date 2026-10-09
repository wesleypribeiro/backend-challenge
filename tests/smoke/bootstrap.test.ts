import { expect, test } from 'bun:test';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, runBun, startService } from '../support/process.js';

test('compiled decorators, metadata and cross-module constructor injection work under Bun', () => {
  const result = runBun(['.test-dist/di-probe.js']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(`bun:${Bun.version}:compiled-imports`);
});

test('an unresolved dependency makes a real Bun Test invocation fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jungle-di-failure-'));
  try {
    const fixtureUrl = pathToFileURL(join(projectRoot, '.test-dist/di-probe.js')).href;
    await writeFile(join(directory, 'injection.test.js'), [
      "import { test } from 'bun:test';",
      `import { verifyCompiledInjection } from ${JSON.stringify(fixtureUrl)};`,
      "test('constructor injection must resolve', async () => { await verifyCompiledInjection(true); });",
    ].join('\n'));

    const result = runBun(['test', './injection.test.js'], directory);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('RuntimeDependency');
    expect(result.stderr).toContain('1 fail');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a missing compiled import aborts bootstrap without falling back to TypeScript sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jungle-import-failure-'));
  try {
    await cp(join(projectRoot, 'dist'), join(directory, 'dist'), { recursive: true });
    await symlink(join(projectRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await rm(join(directory, 'dist/composition/worker-lifetime.js'));

    const result = runBun(['dist/bootstrap/worker.js'], directory);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('worker-lifetime.js');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('compiled API and worker stay alive and can be stopped independently', async () => {
  const api = startService('dist/bootstrap/api.js');
  const worker = startService('dist/bootstrap/worker.js');
  const processes = [api, worker];

  try {
    const [address] = await Promise.all([
      api.waitFor(/"event":"process.started","port":(\d+)/),
      worker.waitFor(/"event":"process.started"/),
    ]);
    const response = await fetch(`http://127.0.0.1:${address[1]}/unimplemented`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(404);

    await api.stop();
    expect(worker.process.exitCode).toBeNull();

    const secondApi = startService('dist/bootstrap/api.js');
    processes.push(secondApi);
    const secondAddress = await secondApi.waitFor(/"event":"process.started","port":(\d+)/);
    await worker.stop();
    expect(secondApi.process.exitCode).toBeNull();
    const stillServing = await fetch(`http://127.0.0.1:${secondAddress[1]}/unimplemented`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(stillServing.status).toBe(404);
  } finally {
    await Promise.all(processes.map((process) => process.stop()));
  }
});
