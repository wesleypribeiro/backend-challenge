import { Migrator } from '@mikro-orm/migrations';
import type { ConfigurationByRole } from '../config/configuration.js';
import { ormOptions } from './orm-options.js';
import { Migration20261009000100 } from './migrations/Migration20261009000100.js';

export function migrationOptions(config: ConfigurationByRole['migrator']) {
  return {
    ...ormOptions(config.database),
    extensions: [Migrator],
    migrations: {
      tableName: 'mikro_orm_migrations',
      schema: 'public',
      migrationsList: [Migration20261009000100],
      transactional: true,
      allOrNothing: true,
      snapshot: false,
      snapshotOnMigrate: false,
      silent: true,
    },
  };
}
