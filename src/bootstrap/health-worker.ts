import { loadConfiguration } from '../platform/config/configuration.js';
import { Readiness } from '../platform/health/readiness.js';
import { JsonLogger } from '../platform/logging/json-logger.js';

try {
  const result = await new Readiness(loadConfiguration('worker')).check();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'ok' ? 0 : 1;
} catch (error) {
  new JsonLogger('worker').event('bootstrap.failed', { error }, 'error');
  process.exitCode = 1;
}
