import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';
import { TestInfrastructure } from '../support/infrastructure.js';
import { compiled } from '../support/compiled.js';
import { runMigration } from '../support/migrations.js';
import { localEnvironment } from '../support/environment.js';
import { PersistenceRecordSchema, persistenceFixtureSql } from '../fixtures/persistence-record.js';

const { loadConfiguration, ConfigurationError } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { createWorkerApplication } = await compiled<typeof import('../../src/bootstrap/worker.js')>('dist/bootstrap/worker.js');
const { createApiApplication } = await compiled<typeof import('../../src/bootstrap/api.js')>('dist/bootstrap/api.js');
const { ApiModule } = await compiled<typeof import('../../src/composition/api.module.js')>('dist/composition/api.module.js');
const { WorkerDatabaseContext } = await compiled<typeof import('../../src/platform/database/worker-database-context.js')>('dist/platform/database/worker-database-context.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');
const { DatabaseController } = await compiled<typeof import('../fixtures/database-controller.js')>('.test-dist/database-controller.js');
const quiet = (role: 'api' | 'worker') => new JsonLogger(role, () => {});
const migrationNames = ['Migration20261009000100', 'Migration20261009000200', 'Migration20261009000300'] as const;
async function barrier(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Persistence barrier timeout')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
let infra: TestInfrastructure;
beforeAll(async () => { infra = await TestInfrastructure.start(); }, 240_000);
afterAll(async () => { await infra?.cleanup(); }, 30_000);
const environment = () => ({ ...localEnvironment, DATABASE_URL: infra.databaseUrl('app'), PG_QUERY_TIMEOUT_MS: '1000' });

test('compiled Nest API/worker connect as app without applying pending migrations or sharing global context', async () => {
  const api = await createApiApplication(loadConfiguration('api', environment()), quiet('api'));
  const worker = await createWorkerApplication(loadConfiguration('worker', environment()), quiet('worker'));
  try {
    await api.listen(0, '127.0.0.1');
    for (const app of [api, worker]) {
      const orm = app.get(MikroORM);
      expect(orm.config.get('allowGlobalContext')).toBe(false);
      expect(orm.config.get('pool').max).toBe(5);
      expect(() => orm.em.getContext()).toThrow();
      const result = await orm.em.fork().execute('select current_user as role, current_database() as db');
      expect(result).toEqual([{ role: 'wagering_app', db: infra.databaseName }]);
      expect(orm.config.get('clientUrl')).not.toContain('wagering_migrator');
    }
    expect((await infra.query('app', "select to_regnamespace('wagering') as schema, to_regclass('public.mikro_orm_migrations') as history")).rows)
      .toEqual([{ schema: null, history: null }]);
  } finally { await Promise.all([api.close(), worker.close()]); }
});

test('compiled migration cycle up/up/down/up preserves history, refuses nonempty schema and enforces roles', async () => {
  const status = () => {
    const result = runMigration(infra, 'status', {
      MIKRO_ORM_USER: 'wagering_app', MIKRO_ORM_PASSWORD: 'must-not-override-validated-url',
      MIKRO_ORM_HOST: 'invalid.invalid', MIKRO_ORM_DB_NAME: 'wrong_database',
    });
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout) as { executed: string[]; pending: string[] };
  };
  expect(status()).toMatchObject({ executed: [], pending: [...migrationNames] });
  expect(runMigration(infra, 'migrate').code).toBe(0);
  const first = (await infra.query('app', 'select * from public.mikro_orm_migrations')).rows;
  expect(first.map((row) => row.name)).toEqual([...migrationNames]);
  expect(runMigration(infra, 'migrate').code).toBe(0);
  expect((await infra.query('app', 'select * from public.mikro_orm_migrations')).rows).toEqual(first);
  expect(status()).toMatchObject({ executed: [...migrationNames], pending: [] });
  expect((await infra.query('app', "select table_name from information_schema.tables where table_schema = 'wagering' order by table_name collate \"C\"")).rows)
    .toEqual([{ table_name: 'outbox_event' }, { table_name: 'wager_transaction' }, { table_name: 'wallet' }, { table_name: 'wallet_ledger_entry' }]);
  expect((await infra.query('app', "select pg_get_userbyid(nspowner) as owner, has_schema_privilege(current_user, 'wagering', 'USAGE') as usage, has_schema_privilege(current_user, 'wagering', 'CREATE') as create from pg_namespace where nspname = 'wagering'")).rows)
    .toEqual([{ owner: 'wagering_migrator', usage: true, create: false }]);
  for (const sql of [
    'create table wagering.forbidden (id integer)', 'create table public.forbidden (id integer)',
    'drop schema wagering', 'delete from public.mikro_orm_migrations',
    "insert into public.mikro_orm_migrations (name) values ('fake')",
    "update public.mikro_orm_migrations set name = 'fake'", 'truncate public.mikro_orm_migrations',
    'drop table public.mikro_orm_migrations', 'set role wagering_migrator',
  ]) await expect(infra.query('app', sql)).rejects.toMatchObject({ code: '42501' });

  expect(runMigration(infra, 'rollback').code).toBe(0);
  expect(status()).toMatchObject({ executed: [migrationNames[0], migrationNames[1]], pending: [migrationNames[2]] });
  expect((await infra.query('app', "select to_regclass('wagering.wager_transaction')::text as tx, to_regclass('wagering.wallet')::text as wallet")).rows)
    .toEqual([{ tx: null, wallet: 'wagering.wallet' }]);
  expect(runMigration(infra, 'rollback').code).toBe(0);
  expect(status()).toMatchObject({ executed: [migrationNames[0]], pending: [migrationNames[1], migrationNames[2]] });
  expect((await infra.query('app', "select to_regclass('wagering.wallet')::text as wallet")).rows)
    .toEqual([{ wallet: null }]);
  expect(runMigration(infra, 'rollback').code).toBe(0);
  expect(status()).toMatchObject({ executed: [], pending: [...migrationNames] });
  expect((await infra.query('app', "select to_regnamespace('wagering') as schema")).rows).toEqual([{ schema: null }]);
  expect((await infra.query('app', 'select * from public.mikro_orm_migrations')).rows).toEqual([]);
  expect(runMigration(infra, 'migrate').code).toBe(0);
  const reapplied = (await infra.query('app', 'select * from public.mikro_orm_migrations')).rows;

  await infra.query('migrator', 'create table wagering.extra_object (id integer); insert into wagering.extra_object values (42)');
  await expect(infra.query('app', 'drop table wagering.extra_object')).rejects.toMatchObject({ code: '42501' });
  expect(runMigration(infra, 'rollback').code).toBe(0);
  expect(runMigration(infra, 'rollback').code).toBe(0);
  const refused = runMigration(infra, 'rollback');
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('migration.failed');
  expect((await infra.query('migrator', 'select * from wagering.extra_object')).rows).toEqual([{ id: 42 }]);
  expect((await infra.query('app', 'select * from public.mikro_orm_migrations')).rows)
    .toEqual(reapplied.filter((row) => row.name === migrationNames[0]));
  await infra.query('migrator', 'drop table wagering.extra_object');
  expect(runMigration(infra, 'migrate').code).toBe(0);
  expect(status()).toMatchObject({ executed: [...migrationNames], pending: [] });
  const unauthorized = runMigration(infra, 'migrate', { MIGRATION_DATABASE_URL: infra.databaseUrl('app') });
  expect(unauthorized.code).toBe(1);
  expect(unauthorized.stderr).toContain('ConfigurationError');
  expect(unauthorized.stderr).not.toContain(infra.databaseUrl('app'));
}, 60_000);

test('worker executions isolate entities and transactions, rollback every write, then discard the failed context', async () => {
  await infra.query('migrator', persistenceFixtureSql);
  const worker = await createWorkerApplication(loadConfiguration('worker', environment()), quiet('worker'));
  const orm = worker.get(MikroORM);
  orm.discoverEntity(PersistenceRecordSchema);
  const contexts = worker.get(WorkerDatabaseContext);
  let failedContext: EntityManager | undefined;
  let firstRecord: object | undefined;
  let firstPid: number | undefined;
  const written = Promise.withResolvers<void>();
  const observed = Promise.withResolvers<void>();
  try {
    const failing = contexts.run(async (em) => {
      failedContext = em;
      await em.findOneOrFail(PersistenceRecordSchema, 1);
      return em.transactional(async (tx) => {
        const record = await tx.findOneOrFail(PersistenceRecordSchema, 1);
        firstRecord = record;
        record.label = 'must-rollback';
        tx.create(PersistenceRecordSchema, { id: 2, label: 'partial', decimal: '1.23' });
        await tx.flush();
        firstPid = (await tx.execute<{ pid: number }[]>('select pg_backend_pid() as pid'))[0]!.pid;
        written.resolve();
        await barrier(observed.promise);
        throw new Error('controlled transaction failure');
      });
    });
    const successful = contexts.run(async (em) => {
      await barrier(written.promise);
      try {
        expect(em).not.toBe(failedContext);
        return await em.transactional(async (tx) => {
          const record = await tx.findOneOrFail(PersistenceRecordSchema, 1);
          expect(record).not.toBe(firstRecord);
          expect(record.label).toBe('original');
          expect(await tx.findOne(PersistenceRecordSchema, 2)).toBeNull();
          const pid = (await tx.execute<{ pid: number }[]>('select pg_backend_pid() as pid'))[0]!.pid;
          expect(pid).not.toBe(firstPid);
          expect(orm.em.getContext() === tx).toBe(true);
          tx.create(PersistenceRecordSchema, { id: 3, label: 'committed', decimal: '2.34' });
        });
      } finally { observed.resolve(); }
    });
    const outcomes = await Promise.allSettled([failing, successful]);
    expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { message: 'controlled transaction failure' } });
    expect(outcomes[1]!.status).toBe('fulfilled');
    expect(failedContext!.getUnitOfWork(false).getIdentityMap().keys()).toEqual([]);
    expect(RequestContext.getEntityManager()).toBeUndefined();
    expect((await infra.query('app', 'select id, label from technical_probe.record order by id')).rows)
      .toEqual([{ id: 1, label: 'original' }, { id: 3, label: 'committed' }]);
    await contexts.run(async (em) => {
      expect(em).not.toBe(failedContext);
      expect(em.getUnitOfWork().getIdentityMap().keys()).toEqual([]);
      expect((await em.findOneOrFail(PersistenceRecordSchema, 1)).label).toBe('original');
      await em.transactional(async (tx) => { tx.create(PersistenceRecordSchema, { id: 4, label: 'recovered', decimal: '3.45' }); });
    });
    expect((await infra.query('app', 'select label from technical_probe.record where id = 4')).rows).toEqual([{ label: 'recovered' }]);
  } finally { written.resolve(); observed.resolve(); await worker.close(); }
}, 15_000);

test('NUMERIC(20,2) round-trip through MikroORM stays an exact string above the JS safe integer limit', async () => {
  const worker = await createWorkerApplication(loadConfiguration('worker', environment()), quiet('worker'));
  const orm = worker.get(MikroORM);
  orm.discoverEntity(PersistenceRecordSchema);
  try {
    const contexts = worker.get(WorkerDatabaseContext);
    const exact = '900719925474099.91';
    await contexts.run((em) => em.transactional(async (tx) => {
      tx.create(PersistenceRecordSchema, { id: 10, label: 'decimal-probe', decimal: exact });
    }));
    await contexts.run(async (em) => {
      const record = await em.findOneOrFail(PersistenceRecordSchema, 10);
      expect(typeof record.decimal).toBe('string');
      expect(record.decimal).toBe(exact);
      expect(await em.execute('select decimal from technical_probe.record where id = 10')).toEqual([{ decimal: exact }]);
    });
    expect((await infra.query('app', "select numeric_precision, numeric_scale from information_schema.columns where table_schema = 'technical_probe' and table_name = 'record' and column_name = 'decimal'")).rows)
      .toEqual([{ numeric_precision: 20, numeric_scale: 2 }]);
  } finally { await worker.close(); }
});

test('compiled Nest HTTP middleware supplies distinct contexts and simultaneous PostgreSQL transactions', async () => {
  const app = await NestFactory.create({
    module: class HttpFixtureModule {},
    imports: [ApiModule.register(quiet('api'), loadConfiguration('api', environment()))],
    controllers: [DatabaseController],
  }, { logger: false, abortOnError: false });
  try {
    await app.listen(0, '127.0.0.1');
    const responses = await Promise.all([1, 2].map(async () => {
      const response = await fetch(`${await app.getUrl()}/technical-context`, { signal: AbortSignal.timeout(5000) });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ id: number; pid: number; sameContext: boolean; role: string }>;
    }));
    expect(new Set(responses.map((response) => response.id)).size).toBe(2);
    expect(new Set(responses.map((response) => response.pid)).size).toBe(2);
    expect(responses.every((response) => response.sameContext && response.role === 'wagering_app')).toBe(true);
    expect(RequestContext.getEntityManager()).toBeUndefined();
  } finally { await app.close(); }
});

test('valid configuration remains bootable on connection failure; errors differ from invalid config and timeouts are enforced', async () => {
  expect(() => loadConfiguration('worker', { ...environment(), DATABASE_URL: 'invalid' })).toThrow(ConfigurationError);
  const config = loadConfiguration('worker', {
    ...environment(), DATABASE_URL: infra.databaseUrl('app').replace('local_test_app_password', 'invalid-secret'),
  });
  const worker = await createWorkerApplication(config, quiet('worker'));
  try {
    await expect(worker.get(MikroORM).em.fork().execute('select 1')).rejects.toMatchObject({ code: '28P01' });
  } finally { await worker.close(); }
  const inaccessible = runMigration(infra, 'status', {
    MIGRATION_DATABASE_URL: infra.databaseUrl('migrator').replace('local_test_migrator_password', 'invalid-secret'),
  });
  expect(inaccessible.code).toBe(1);
  expect(inaccessible.stderr).not.toContain('ConfigurationError');
  expect(inaccessible.stderr).not.toContain('invalid-secret');
  expect(inaccessible.stderr).toContain('28P01');

  const bounded = await createWorkerApplication(loadConfiguration('worker', { ...environment(), PG_POOL_MAX: '2', PG_QUERY_TIMEOUT_MS: '150', PG_CONNECT_TIMEOUT_MS: '300' }), quiet('worker'));
  try {
    const orm = bounded.get(MikroORM);
    const pool = await orm.em.getConnection().getNativeClient();
    expect(pool.options.max).toBe(2);
    expect(pool.options.connectionTimeoutMillis).toBe(300);
    expect(await orm.em.fork().execute('show statement_timeout')).toEqual([{ statement_timeout: '150ms' }]);
    const started = Date.now();
    await expect(orm.em.fork().execute('select pg_sleep(3)')).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await orm.em.fork().execute('select 1 as recovered')).toEqual([{ recovered: 1 }]);
  } finally { await bounded.close(); }
});
