import { Injectable, Module } from '@nestjs/common';
import { DependencyModule, RuntimeDependency } from './dependency.module.js';

@Injectable()
export class RuntimeConsumer {
  constructor(private readonly dependency: RuntimeDependency) {}

  run(value: string): string {
    return this.dependency.describe(value);
  }
}

@Module({ imports: [DependencyModule], providers: [RuntimeConsumer] })
export class ConsumerModule {}

@Module({ providers: [RuntimeConsumer] })
export class MissingDependencyModule {}
