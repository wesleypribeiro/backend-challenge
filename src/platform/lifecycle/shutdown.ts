import type { INestApplicationContext } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Readiness } from '../health/readiness.js';
import type { JsonLogger } from '../logging/json-logger.js';

export function installShutdown(
  app: INestApplicationContext, readiness: Readiness, logger: JsonLogger,
  timeoutMs: number, server?: Server,
): void {
  let stopping = false;
  const shutdown = async (signal: 'SIGTERM' | 'SIGINT') => {
    if (stopping) return;
    stopping = true;
    readiness.beginDraining();
    logger.event('process.draining', { signal });
    const deadline = setTimeout(() => {
      logger.event('shutdown.failed', { signal, error: new Error('Shutdown deadline exceeded') }, 'error');
      process.exit(1);
    }, timeoutMs);
    try {
      // Parar aceite e drenar HTTP antes de liberar pools/clientes usados por requests em andamento.
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
      }
      await app.close();
      clearTimeout(deadline);
      process.exitCode = 0;
    } catch (error) {
      logger.event('shutdown.failed', { signal, error }, 'error');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}
