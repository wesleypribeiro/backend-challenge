import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { SqsConnection } from './sqs-connection.js';
import type { SqsConfiguration } from './sqs-connection.js';

@Module({})
export class SqsModule {
  static register(config: SqsConfiguration): DynamicModule {
    return {
      module: SqsModule,
      providers: [{ provide: SqsConnection, useFactory: () => new SqsConnection(config) }],
      exports: [SqsConnection],
    };
  }
}
