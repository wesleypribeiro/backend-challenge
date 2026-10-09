import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ConfigurationByRole } from '../config/configuration.js';
import { LoggingModule } from '../logging/logging.module.js';
import type { JsonLogger } from '../logging/json-logger.js';
import { HealthController } from './health.controller.js';
import { Readiness } from './readiness.js';

@Module({})
export class HealthModule {
  static register(config: ConfigurationByRole['api'] | ConfigurationByRole['worker'], logger: JsonLogger): DynamicModule {
    return {
      module: HealthModule, imports: [LoggingModule.register(logger)],
      controllers: config.role === 'api' ? [HealthController] : [],
      providers: [{ provide: Readiness, useFactory: () => new Readiness(config) }], exports: [Readiness],
    };
  }
}
