import { migrationNames } from './migration-catalog.js';
import { Migrator } from '@mikro-orm/migrations';
import type { ConfigurationByRole } from '../config/configuration.js';
import { ormOptions } from './orm-options.js';
import { Migration20261009000100 } from './migrations/Migration20261009000100.js';
import { Migration20261009000200 } from './migrations/Migration20261009000200.js';
import { Migration20261009000300 } from './migrations/Migration20261009000300.js';

export function migrationOptions(config: ConfigurationByRole['migrator']) {
  return {
    ...ormOptions(config.database),
    extensions: [Migrator],
    migrations: {
      tableName: 'mikro_orm_migrations',
      schema: 'public',
      migrationsList: [
        { name: migrationNames[0], class: Migration20261009000100 },
        { name: migrationNames[1], class: Migration20261009000200 },
        { name: migrationNames[2], class: Migration20261009000300 },
      ],
      transactional: true,
      allOrNothing: true,
      snapshot: false,
      snapshotOnMigrate: false,
      silent: true,
    },
  };
}
