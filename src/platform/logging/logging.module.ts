import { Injectable, Module } from '@nestjs/common';
import type { BeforeApplicationShutdown, DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from './json-logger.js';

@Injectable()
class LifecycleLogging implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(private readonly logger: JsonLogger) {}

  beforeApplicationShutdown(signal?: string): void {
    this.logger.event('process.stopping', signal ? { signal } : {});
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.event('process.stopped', signal ? { signal } : {});
  }
}

@Module({})
export class LoggingModule {
  static register(logger: JsonLogger): DynamicModule {
    return {
      module: LoggingModule,
      providers: [{ provide: JsonLogger, useValue: logger }, LifecycleLogging],
      exports: [JsonLogger],
    };
  }
}
