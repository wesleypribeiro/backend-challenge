import { expect, test } from 'bun:test';
import { startService } from '../support/process.js';

for (const role of ['api', 'worker']) {
  test.each(['SIGINT', 'SIGTERM'] as const)(`compiled ${role} drains and exits zero on %s`, async (signal) => {
    const service = startService(`dist/bootstrap/${role}.js`);
    try {
      await service.waitFor(/"event":"process.started"/);
      const start = performance.now();
      service.process.kill(signal);
      await service.waitFor(/"event":"process.draining"/);
      await service.stop();
      expect(service.process.exitCode).toBe(0);
      expect(performance.now() - start).toBeLessThan(25_000);
      const logs = service.output.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(logs.some((line) => line.event === 'process.draining' && line.signal === signal)).toBe(true);
      expect(logs.some((line) => line.event === 'process.stopped')).toBe(true);
      expect(service.output.stderr).toBe('');
    } finally { await service.stop(); }
  });
}
