import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggingModule } from '../platform/logging/logging.module.js';
import type { JsonLogger } from '../platform/logging/json-logger.js';

@Module({})
export class ApiModule {
  static register(logger: JsonLogger): DynamicModule {
    return { module: ApiModule, imports: [LoggingModule.register(logger)] };
  }
}
