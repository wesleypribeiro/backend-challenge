import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { loadConfiguration } from '../platform/config/configuration.js';
import { migrationOptions } from '../platform/database/migration-options.js';
import { JsonLogger } from '../platform/logging/json-logger.js';

const logger = new JsonLogger('migrator');
let orm: MikroORM | undefined;
try {
  const command = process.argv[2];
  if (!['up', 'down', 'status'].includes(command ?? '')) throw new Error('Invalid migration command');
  const config = loadConfiguration('migrator');
  orm = await MikroORM.init(migrationOptions(config));
  // Verifica acesso antes de o Migrator tentar preparar o histórico. Não cria database.
  await orm.em.getConnection().execute('select 1');
  const migrator = orm.migrator;
  if (!(migrator instanceof Migrator)) throw new Error('SQL migrator unavailable');
  if (command === 'up') await migrator.up();
  if (command === 'down') await migrator.down();
  const executed = (await migrator.getExecuted()).map(({ name }) => name);
  const pending = (await migrator.getPending()).map(({ name }) => name);
  process.stdout.write(`${JSON.stringify({ event: 'migration.status', command, executed, pending })}\n`);
} catch (error) {
  logger.event('migration.failed', { error }, 'error');
  process.exitCode = 1;
} finally {
  try { await orm?.close(true); }
  catch (error) {
    logger.event('migration.failed', { error }, 'error');
    process.exitCode = 1;
  }
}
