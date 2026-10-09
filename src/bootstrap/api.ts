import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ApiModule } from '../composition/api.module.js';

export async function createApiApplication(): Promise<INestApplication> {
  return NestFactory.create(ApiModule, { abortOnError: false });
}

if (import.meta.main) {
  const app = await createApiApplication();
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.listen(Number(process.env.API_PORT ?? 3000), '0.0.0.0');
  console.info(`API listening on ${await app.getUrl()}`);
}
