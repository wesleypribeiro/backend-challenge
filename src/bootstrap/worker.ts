import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerModule } from '../composition/worker.module.js';

export async function createWorkerApplication(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule, { abortOnError: false });
}

if (import.meta.main) {
  const app = await createWorkerApplication();
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  console.info('Worker application context started');
}
