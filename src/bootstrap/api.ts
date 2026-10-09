import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ApiModule } from '../composition/api.module.js';
import { loadConfiguration } from '../platform/config/configuration.js';
import type { ConfigurationByRole } from '../platform/config/configuration.js';
import { JsonLogger } from '../platform/logging/json-logger.js';
import { httpLogging } from '../platform/logging/http-logging.js';

export async function createApiApplication(
  config: ConfigurationByRole['api'] = loadConfiguration('api'),
  logger = new JsonLogger('api'),
): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule.register(logger, config), { abortOnError: false, logger });
  app.use(httpLogging(logger));
  return app;
}

if (import.meta.main) {
  const logger = new JsonLogger('api');
  let app: INestApplication | undefined;
  try {
    const config = loadConfiguration('api');
    logger.event('process.starting', { runtime: `bun:${Bun.version}` });
    app = await createApiApplication(config, logger);
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    await app.listen(config.port, '0.0.0.0');
    logger.event('process.started', { port: Number(new URL(await app.getUrl()).port), runtime: `bun:${Bun.version}` });
  } catch (error) {
    logger.event('bootstrap.failed', { error }, 'error');
    await app?.close();
    process.exitCode = 1;
  }
}
