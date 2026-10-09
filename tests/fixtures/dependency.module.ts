import { Injectable, Module } from '@nestjs/common';

@Injectable()
export class RuntimeDependency {
  describe(value: string): string {
    return `bun:${process.versions.bun}:${value}`;
  }
}

@Module({ providers: [RuntimeDependency], exports: [RuntimeDependency] })
export class DependencyModule {}
