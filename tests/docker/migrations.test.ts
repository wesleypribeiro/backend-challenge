import { expect, test } from 'bun:test';
import { dockerCommand, withTestInfrastructure } from '../support/infrastructure.js';

test('final Docker image runs versioned migrations as migrator using only compiled JavaScript and a disposable database', async () => {
  const image = `jungle-migrations-test:${crypto.randomUUID()}`;
  let built = false;
  try {
    await dockerCommand(['build', '--target', 'runtime', '--tag', image, '.'], {}, 300_000);
    built = true;
    const files = JSON.parse(await dockerCommand(['run', '--rm', '--network', 'none', image, '--eval', `
      import { existsSync, readdirSync } from 'node:fs';
      console.log(JSON.stringify({ bun: Bun.version, sources: existsSync('src'), tests: existsSync('tests'), migrations: readdirSync('dist/platform/database/migrations') }));
    `]));
    expect(files).toEqual({
      bun: '1.4.2', sources: false, tests: false,
      migrations: ['Migration20261009000100.js', 'Migration20261009000200.js'],
    });
    await withTestInfrastructure(async (infra) => {
      const [network] = await infra.resources('network');
      if (!network) throw new Error('Test network missing');
      const run = (command: 'migrate' | 'rollback' | 'status', role: 'app' | 'migrator' = 'migrator') => dockerCommand([
        'run', '--rm', '--network', network,
        '--env', 'NODE_ENV=test', '--env', `MIGRATION_DATABASE_URL=${infra.databaseUrl(role, true)}`,
        image, 'run', `db:${command}`,
      ]);
      const names = ['Migration20261009000100', 'Migration20261009000200'];
      expect(JSON.parse(await run('status'))).toMatchObject({ executed: [], pending: names });
      expect(JSON.parse(await run('migrate'))).toMatchObject({ executed: names, pending: [] });
      const history = (await infra.query('app', 'select * from public.mikro_orm_migrations')).rows;
      await run('migrate');
      expect((await infra.query('app', 'select * from public.mikro_orm_migrations')).rows).toEqual(history);
      expect(JSON.parse(await run('rollback'))).toMatchObject({ executed: [names[0]], pending: [names[1]] });
      expect((await infra.query('app', "select to_regclass('wagering.wallet')::text as wallet")).rows)
        .toEqual([{ wallet: null }]);
      expect(JSON.parse(await run('rollback'))).toMatchObject({ executed: [], pending: names });
      expect((await infra.query('app', "select to_regnamespace('wagering') as schema")).rows).toEqual([{ schema: null }]);
      expect((await infra.query('app', 'select * from public.mikro_orm_migrations')).rows).toEqual([]);
      await run('migrate');
      await infra.query('migrator', 'create table wagering.extra_object (id integer)');
      expect(JSON.parse(await run('rollback'))).toMatchObject({ executed: [names[0]], pending: [names[1]] });
      await expect(run('rollback')).rejects.toThrow('Docker run failed');
      expect((await infra.query('migrator', "select to_regclass('wagering.extra_object')::text as object")).rows)
        .toEqual([{ object: 'wagering.extra_object' }]);
      expect(JSON.parse(await run('status'))).toMatchObject({ executed: [names[0]], pending: [names[1]] });
      await expect(run('migrate', 'app')).rejects.toThrow('Docker run failed');
      await infra.query('migrator', 'drop table wagering.extra_object');
      expect((await infra.query('app', "select table_name from information_schema.tables where table_schema = 'wagering'")).rows).toEqual([]);
    });
  } finally {
    if (built) await dockerCommand(['image', 'rm', image]);
  }
}, 600_000);
