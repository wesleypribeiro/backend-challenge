import { expect, test } from 'bun:test';
import { Client } from 'pg';
import { CreateQueueCommand, GetQueueAttributesCommand, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { dockerCommand, TestInfrastructure, withTestInfrastructure } from '../support/infrastructure.js';
import { createPermissionFixture, forbiddenApplicationSql } from '../fixtures/postgresql-permissions.js';
import { projectRoot } from '../support/process.js';

test('real services, password authentication, PostgreSQL permissions and idempotent bootstrap', async () => {
  await withTestInfrastructure(async (infra) => {
    expect((await infra.query('app', 'SELECT current_user, current_database()')).rows[0]).toEqual({
      current_user: 'wagering_app', current_database: infra.databaseName,
    });
    expect((await infra.query('migrator', 'SELECT current_user')).rows[0].current_user).toBe('wagering_migrator');
    expect((await infra.query('app', "SELECT schemaname FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")).rowCount).toBe(0);
    expect((await infra.query('app', "SELECT 1 FROM pg_namespace WHERE nspname='wagering'")).rowCount).toBe(0);
    const roles = await infra.query('app', "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('wagering_app','wagering_migrator')");
    for (const role of roles.rows) for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) expect(role[flag]).toBe(false);
    const ownership = await infra.query('app', `
      SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
        has_database_privilege(current_user, current_database(), 'TEMP') AS can_temp,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
        pg_has_role(current_user, 'wagering_migrator', 'MEMBER') AS migrator_member,
        (SELECT count(*)::int FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned_schemas
    `);
    expect(ownership.rows[0]).toEqual({ can_create: false, can_temp: false, can_create_public: false, migrator_member: false, owned_schemas: 0 });

    const wrongPassword = new Client({ host: '127.0.0.1', port: infra.postgresPort, database: infra.databaseName, user: 'wagering_app', password: 'incorrect', connectionTimeoutMillis: 2000 });
    try { await expect(wrongPassword.connect()).rejects.toMatchObject({ code: '28P01' }); }
    finally { await wrongPassword.end(); }

    await infra.query('migrator', createPermissionFixture);
    for (const sql of forbiddenApplicationSql) await expect(infra.query('app', sql)).rejects.toMatchObject({ code: '42501' });
    expect((await infra.query('app', 'SELECT value FROM technical_probe.marker WHERE id=1')).rows[0].value).toBe('preserved');
    await infra.query('app', "INSERT INTO technical_probe.marker VALUES (2, 'application-write')");
    const before = await infra.query('app', "SELECT oid FROM pg_database WHERE datname = current_database()");
    await infra.compose(['exec', '-T', 'postgres', 'bash', '/docker-entrypoint-initdb.d/10-bootstrap.sh']);
    await infra.compose(['exec', '-T', 'postgres', 'bash', '/docker-entrypoint-initdb.d/10-bootstrap.sh']);
    expect((await infra.query('app', "SELECT oid FROM pg_database WHERE datname = current_database()")).rows).toEqual(before.rows);
    expect((await infra.query('app', 'SELECT count(*)::int AS count FROM technical_probe.marker')).rows[0].count).toBe(2);
    await expect(infra.query('app', 'CREATE TABLE public.still_forbidden (id integer)')).rejects.toMatchObject({ code: '42501' });
    await infra.query('migrator', 'DROP TABLE public.technical_history_probe');

    const result = await infra.sqs.send(new ListQueuesCommand({}));
    expect(result.$metadata.httpStatusCode).toBe(200);
    expect(result.QueueUrls ?? []).toEqual([]);
    const insideSqs = await infra.compose(['exec', '-T', 'localstack', 'awslocal', 'sqs', 'list-queues', '--region', 'us-east-1', '--query', 'length(QueueUrls || `[]`)', '--output', 'json']);
    expect(insideSqs).toBe('0');
    const health = (await infra.compose(['ps', '--format', 'json'])).split('\n').map((line) => JSON.parse(line));
    expect(health).toHaveLength(2);
    expect(health.every((service) => service.Health === 'healthy')).toBe(true);
  });
}, 300_000);

test('isolated stacks coexist and cleanup after success or failure preserves the reference environment', async () => {
  // Usa a composição de desenvolvimento em um projeto privado do teste; não toca no projeto real do usuário.
  await withTestInfrastructure(async (reference) => {
    await reference.query('migrator', createPermissionFixture);
    const queue = await reference.sqs.send(new CreateQueueCommand({ QueueName: reference.queueName, Attributes: { FifoQueue: 'true' } }));
    const volumes = await reference.resources('volume');
    let first: TestInfrastructure | undefined;
    await withTestInfrastructure(async (isolated) => {
      first = isolated;
      expect(isolated.databaseName).not.toBe(reference.databaseName);
      expect(isolated.postgresPort).not.toBe(reference.postgresPort);
      expect(isolated.sqsEndpoint).not.toBe(reference.sqsEndpoint);
      expect(isolated.queueName).not.toBe(reference.queueName);
      expect(await isolated.resources('volume')).not.toEqual(volumes);
      expect((await isolated.query('app', "SELECT to_regclass('technical_probe.marker') AS marker")).rows[0].marker).toBeNull();
      expect((await isolated.sqs.send(new ListQueuesCommand({}))).QueueUrls ?? []).toEqual([]);
    });
    expect(await first!.resources('container')).toEqual([]);
    expect(await first!.resources('volume')).toEqual([]);
    expect(await first!.resources('network')).toEqual([]);

    let failed: TestInfrastructure | undefined;
    await expect(withTestInfrastructure(async (isolated) => {
      failed = isolated;
      await isolated.sqs.send(new CreateQueueCommand({ QueueName: isolated.queueName, Attributes: { FifoQueue: 'true' } }));
      throw new Error('controlled test failure');
    })).rejects.toThrow('controlled test failure');
    expect(await failed!.resources('container')).toEqual([]);
    expect(await failed!.resources('volume')).toEqual([]);
    expect(await failed!.resources('network')).toEqual([]);
    expect(await reference.resources('volume')).toEqual(volumes);
    expect((await reference.query('app', 'SELECT value FROM technical_probe.marker WHERE id=1')).rows[0].value).toBe('preserved');
    const attributes = await reference.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queue.QueueUrl!, AttributeNames: ['QueueArn'] }));
    expect(attributes.Attributes?.QueueArn).toContain(reference.queueName);
  }, 'reference');
}, 600_000);

test('missing Docker and missing test namespace fail explicitly without skip', async () => {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', "import { TestInfrastructure } from './tests/support/infrastructure.ts'; await TestInfrastructure.start();"], {
    cwd: projectRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: 'unix:///tmp/jungle-nonexistent-docker.sock' },
    stdout: 'pipe', stderr: 'pipe', timeout: 5000,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('Check Docker/Compose availability');
  await expect(dockerCommand(['compose', '--env-file', '/dev/null', '-f', 'compose.test.yaml', 'config', '--quiet'])).rejects.toThrow('TEST_PROJECT');
});
