import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggingModule } from '../platform/logging/logging.module.js';
import type { JsonLogger } from '../platform/logging/json-logger.js';
import type { ConfigurationByRole } from '../platform/config/configuration.js';
import { DatabaseModule } from '../platform/database/database.module.js';
import { SqsModule } from '../platform/messaging/sqs/sqs.module.js';

@Module({})
export class ApiModule {
  static register(logger: JsonLogger, config: ConfigurationByRole['api']): DynamicModule {
    return { module: ApiModule, imports: [LoggingModule.register(logger), DatabaseModule.register(config), SqsModule.register(config.sqs)] };
  }
}
