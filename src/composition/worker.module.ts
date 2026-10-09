import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { WorkerLifetime } from './worker-lifetime.js';
import { LoggingModule } from '../platform/logging/logging.module.js';
import type { JsonLogger } from '../platform/logging/json-logger.js';

@Module({ providers: [WorkerLifetime] })
export class WorkerModule {
  static register(logger: JsonLogger): DynamicModule {
    return { module: WorkerModule, imports: [LoggingModule.register(logger)] };
  }
}
