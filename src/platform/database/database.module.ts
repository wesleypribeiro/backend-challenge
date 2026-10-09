import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import type { ConfigurationByRole } from '../config/configuration.js';
import { ormOptions } from './orm-options.js';
import { WorkerDatabaseContext } from './worker-database-context.js';

@Module({})
export class DatabaseModule {
  static register(config: ConfigurationByRole['api'] | ConfigurationByRole['worker']): DynamicModule {
    return {
      module: DatabaseModule,
      // Em MikroORM 7, init é lazy: não exige conexão nem executa DDL/migrations.
      imports: [MikroOrmModule.forRoot({
        ...ormOptions(config.database),
        registerRequestContext: config.role === 'api',
      })],
      providers: config.role === 'worker' ? [WorkerDatabaseContext] : [],
      exports: config.role === 'worker' ? [WorkerDatabaseContext] : [],
    };
  }
}
