import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ConsumerModule, MissingDependencyModule, RuntimeConsumer } from './consumer.module.js';
import { RuntimeDependency } from './dependency.module.js';

export async function verifyCompiledInjection(missingDependency = false): Promise<string> {
  const parameterTypes: unknown = Reflect.getMetadata('design:paramtypes', RuntimeConsumer);
  assert.deepEqual(parameterTypes, [RuntimeDependency]);

  const app = await NestFactory.createApplicationContext(
    missingDependency ? MissingDependencyModule : ConsumerModule,
    { abortOnError: false, logger: false },
  );

  try {
    const value = app.get(RuntimeConsumer).run('compiled-imports');
    assert.equal(value, `bun:${process.versions.bun}:compiled-imports`);
    return value;
  } finally {
    await app.close();
  }
}

if (import.meta.main) {
  console.info(await verifyCompiledInjection());
}
