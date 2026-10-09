import { defineConfig } from '@mikro-orm/postgresql';
import type { ConfigurationByRole } from '../config/configuration.js';

export function ormOptions(database: ConfigurationByRole['api']['database']) {
  const url = new URL(database.url);
  return defineConfig({
    clientUrl: database.url,
    // Fixar também os campos: variáveis MIKRO_ORM_* não devem sobrepor a URL validada por papel.
    host: decodeURIComponent(url.hostname),
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    dbName: decodeURIComponent(url.pathname.slice(1)),
    schema: 'wagering',
    entities: [],
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: false,
    preferEnvVars: false,
    preferTs: false,
    pool: { min: 0, max: database.poolMax },
    // MikroORM 7 repassa driverOptions diretamente ao pg.Pool (sem o antigo connection).
    driverOptions: {
      connectionTimeoutMillis: database.connectTimeoutMs,
      query_timeout: database.queryTimeoutMs,
      statement_timeout: database.queryTimeoutMs,
    },
    // SQL, parâmetros e mensagens do driver podem conter dados sensíveis.
    debug: false,
    logger: () => {},
    migrations: { migrationsList: [] },
  });
}
