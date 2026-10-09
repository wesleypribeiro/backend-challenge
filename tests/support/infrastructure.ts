import { Client } from 'pg';
import { ListQueuesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { projectRoot } from './process.js';

type Role = 'app' | 'migrator';
type ResourceKind = 'container' | 'network' | 'volume';
type Variant = 'test' | 'reference';
const passwords = { app: 'local_test_app_password', migrator: 'local_test_migrator_password' } as const;

// Não herdar COMPOSE_FILE, nomes de projeto, portas, .env ou credenciais de desenvolvimento.
const dockerEnvironment = () => Object.fromEntries(
  ['PATH', 'HOME', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']
    .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
);

export async function dockerCommand(args: string[], env: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  const child = Bun.spawn(['docker', ...args], {
    cwd: projectRoot, env: { ...dockerEnvironment(), ...env },
    stdout: 'pipe', stderr: 'pipe', timeout,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    // Não incluir config/inspect/logs completos, que podem conter variáveis sensíveis.
    const missing = ['TEST_PROJECT', 'TEST_DATABASE', 'INFRA_OWNER'].filter((name) => stderr.includes(name));
    const hint = missing.length ? `Required test configuration: ${missing.join(', ')}.` :
      /auth.?token/i.test(stderr) ? 'LocalStack activation is required by this image.' :
      'Check Docker/Compose availability and the isolated project.';
    throw new Error(`Docker ${args[0]} failed (exit ${code}). ${hint}`);
  }
  return stdout.trim();
}

export class TestInfrastructure {
  readonly #id = crypto.randomUUID().replaceAll('-', '');
  readonly #project = `jungle-test-${this.#id}`;
  readonly #owner = crypto.randomUUID();
  readonly databaseName = `wagering_test_${this.#id}`;
  readonly queueName = `infra-${this.#id}.fifo`;
  readonly #env: Record<string, string>;
  #postgresPort = 0;
  #sqs: SQSClient | undefined;
  #endpoint = '';

  private constructor(private readonly variant: Variant) {
    this.#env = {
      TEST_PROJECT: this.#project, TEST_DATABASE: this.databaseName,
      INFRA_OWNER: this.#owner, APP_DATABASE: this.databaseName,
      POSTGRES_PORT: '0', LOCALSTACK_PORT: '0',
      POSTGRES_ADMIN_PASSWORD: 'local_test_admin_password',
      WAGERING_APP_PASSWORD: passwords.app, WAGERING_MIGRATOR_PASSWORD: passwords.migrator,
    };
  }

  get project(): string { return this.#project; }
  get postgresPort(): number { return this.#postgresPort; }
  get sqsEndpoint(): string { return this.#endpoint; }
  get sqs(): SQSClient {
    if (!this.#sqs) throw new Error('Infrastructure is not started');
    return this.#sqs;
  }

  async compose(args: string[], timeout?: number): Promise<string> {
    return dockerCommand([
      'compose', '--env-file', '/dev/null', '--project-name', this.#project,
      '--file', this.variant === 'test' ? 'compose.test.yaml' : 'compose.yaml', ...args,
    ], this.#env, timeout);
  }

  static async start(variant: Variant = 'test'): Promise<TestInfrastructure> {
    await dockerCommand(['info']);
    const instance = new TestInfrastructure(variant);
    console.info(`[infra] Starting isolated project ${instance.project} (${variant})`);
    try {
      await instance.compose(['config', '--quiet']);
      await instance.compose(['up', '--detach', '--wait', '--wait-timeout', '120'], 240_000);
      instance.#postgresPort = await instance.port('postgres', 5432);
      instance.#endpoint = `http://127.0.0.1:${await instance.port('localstack', 4566)}`;
      instance.#sqs = new SQSClient({
        endpoint: instance.#endpoint, region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, maxAttempts: 1,
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
      });
      // Healthchecks do container não substituem acesso real pelo harness no host.
      await instance.query('app', 'SELECT 1');
      await instance.sqs.send(new ListQueuesCommand({}), { abortSignal: AbortSignal.timeout(3000) });
      return instance;
    } catch (error) {
      try { await instance.cleanup(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], `Setup/cleanup failed for ${instance.project}`); }
      throw error;
    }
  }

  private async port(service: string, target: number): Promise<number> {
    const mapping = await this.compose(['port', service, String(target)]);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
    if (!match) throw new Error(`Unexpected port mapping for ${this.#project}/${service}`);
    return Number(match[1]);
  }

  async query(role: Role, sql: string, values: unknown[] = []) {
    const client = new Client({
      host: '127.0.0.1', port: this.#postgresPort, database: this.databaseName,
      user: `wagering_${role}`, password: passwords[role],
      connectionTimeoutMillis: 2000, query_timeout: 3000, statement_timeout: 2500,
    });
    try {
      await client.connect();
      return await client.query(sql, values);
    } finally { await client.end(); }
  }

  async resources(kind: ResourceKind): Promise<string[]> {
    const args = kind === 'container' ? ['ps', '--all', '--quiet'] : [kind, 'ls', '--quiet'];
    const output = await dockerCommand([...args, '--filter', `label=com.docker.compose.project=${this.#project}`]);
    return output ? output.split('\n') : [];
  }

  async cleanup(): Promise<void> {
    this.#sqs?.destroy();
    // Nome e ownership vêm somente desta instância; nunca aceitar alvo externo nem usar prune.
    if (!/^jungle-test-[a-f0-9]{32}$/.test(this.#project)) throw new Error('Refusing cleanup outside test namespace');
    for (const kind of ['container', 'network', 'volume'] as const) {
      for (const id of await this.resources(kind)) {
        const [resource] = JSON.parse(await dockerCommand([kind, 'inspect', id]));
        const labels = kind === 'container' ? resource.Config.Labels : resource.Labels;
        if (labels?.['io.jungle.owner'] !== this.#owner || labels?.['com.docker.compose.project'] !== this.#project) {
          throw new Error(`Refusing cleanup: ownership mismatch in ${this.#project}/${kind}`);
        }
      }
    }
    await this.compose(['down', '--volumes', '--timeout', '5']);
    for (const kind of ['container', 'network', 'volume'] as const) {
      if ((await this.resources(kind)).length) throw new Error(`Cleanup incomplete for ${this.#project}/${kind}`);
    }
  }
}

export async function withTestInfrastructure<T>(run: (infra: TestInfrastructure) => Promise<T>, variant: Variant = 'test'): Promise<T> {
  const infra = await TestInfrastructure.start(variant);
  try { return await run(infra); }
  finally { await infra.cleanup(); }
}
