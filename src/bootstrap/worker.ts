import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerModule } from '../composition/worker.module.js';
import { loadConfiguration } from '../platform/config/configuration.js';
import type { ConfigurationByRole } from '../platform/config/configuration.js';
import { JsonLogger } from '../platform/logging/json-logger.js';

export async function createWorkerApplication(
  _config: ConfigurationByRole['worker'] = loadConfiguration('worker'),
  logger = new JsonLogger('worker'),
): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule.register(logger), { abortOnError: false, logger });
}

if (import.meta.main) {
  const logger = new JsonLogger('worker');
  try {
    const config = loadConfiguration('worker');
    logger.event('process.starting', { runtime: `bun:${Bun.version}` });
    const app = await createWorkerApplication(config, logger);
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    logger.event('process.started', { runtime: `bun:${Bun.version}` });
  } catch (error) {
    logger.event('bootstrap.failed', { error }, 'error');
    process.exitCode = 1;
  }
}
