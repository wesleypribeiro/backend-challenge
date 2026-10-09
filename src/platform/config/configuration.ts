export type ProcessRole = 'api' | 'worker' | 'migrator' | 'provision';
export type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  constructor(public readonly variables: readonly string[]) {
    super(`Invalid configuration: ${variables.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

interface BaseConfiguration {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly shutdownTimeoutMs: number;
}

interface DatabaseConfiguration {
  readonly url: string;
  readonly poolMax: number;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
}

interface SqsConfiguration {
  readonly endpoint: string;
  readonly region: string;
  readonly credentials: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
  readonly queueName: string;
  readonly dlqName: string;
  readonly requestTimeoutMs: number;
  readonly maxAttempts: number;
}

export interface ConfigurationByRole {
  api: BaseConfiguration & { readonly role: 'api'; readonly port: number; readonly database: DatabaseConfiguration; readonly sqs: SqsConfiguration };
  worker: BaseConfiguration & { readonly role: 'worker'; readonly database: DatabaseConfiguration; readonly sqs: SqsConfiguration };
  migrator: BaseConfiguration & { readonly role: 'migrator'; readonly database: DatabaseConfiguration };
  provision: BaseConfiguration & { readonly role: 'provision'; readonly sqs: SqsConfiguration };
}

export function loadConfiguration<R extends ProcessRole>(role: R, env?: Environment): ConfigurationByRole[R];
export function loadConfiguration(role: ProcessRole, env: Environment = process.env): ConfigurationByRole[ProcessRole] {
  const invalid = new Set<string>();
  const required = (name: string): string => {
    const value = env[name];
    if (!value || value.trim() !== value) invalid.add(name);
    return value ?? '';
  };
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const value = env[name] ?? String(fallback);
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalid.add(name);
    return parsed;
  };

  const nodeEnv = required('NODE_ENV');
  if (!['development', 'test', 'production'].includes(nodeEnv)) invalid.add('NODE_ENV');
  const base = {
    role,
    nodeEnv: nodeEnv as BaseConfiguration['nodeEnv'],
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 25_000, 1, 25_000),
  };

  let database: DatabaseConfiguration | undefined;
  if (role !== 'provision') {
    const name = role === 'migrator' ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
    const url = required(name);
    try {
      const parsed = new URL(url);
      const username = role === 'migrator' ? 'wagering_migrator' : 'wagering_app';
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname ||
          decodeURIComponent(parsed.username) !== username || !parsed.password || parsed.pathname.length < 2 || parsed.hash) invalid.add(name);
    } catch { invalid.add(name); }
    database = Object.freeze({
      url,
      poolMax: integer('PG_POOL_MAX', 5, 1, 20),
      connectTimeoutMs: integer('PG_CONNECT_TIMEOUT_MS', 1000, 1, 10_000),
      queryTimeoutMs: integer('PG_QUERY_TIMEOUT_MS', 1000, 1, 30_000),
    });
  }
  if (role !== 'migrator' && env.MIGRATION_DATABASE_URL) invalid.add('MIGRATION_DATABASE_URL');

  let sqs: SqsConfiguration | undefined;
  if (role !== 'migrator') {
    const endpoint = required('AWS_ENDPOINT_URL');
    try {
      const url = new URL(endpoint);
      // Apenas destinos do emulador local. Não inferir endpoint da região ou de AWS_PROFILE.
      if (!['http:', 'https:'].includes(url.protocol) ||
          !['localhost', '127.0.0.1', '[::1]', 'localstack', 'host.docker.internal'].includes(url.hostname) ||
          url.username || url.password || url.search || url.hash || url.pathname !== '/') invalid.add('AWS_ENDPOINT_URL');
    } catch { invalid.add('AWS_ENDPOINT_URL'); }
    const region = required('AWS_REGION');
    if (region !== 'us-east-1') invalid.add('AWS_REGION');
    const accessKeyId = required('AWS_ACCESS_KEY_ID');
    const secretAccessKey = required('AWS_SECRET_ACCESS_KEY');
    if (accessKeyId !== 'test') invalid.add('AWS_ACCESS_KEY_ID');
    if (secretAccessKey !== 'test') invalid.add('AWS_SECRET_ACCESS_KEY');
    if (env.AWS_SESSION_TOKEN) invalid.add('AWS_SESSION_TOKEN');
    const queueName = required('SQS_QUEUE_NAME');
    const dlqName = required('SQS_DLQ_NAME');
    for (const [name, value] of [['SQS_QUEUE_NAME', queueName], ['SQS_DLQ_NAME', dlqName]] as const) {
      if (!/^[A-Za-z0-9_-]{1,75}\.fifo$/.test(value)) invalid.add(name);
    }
    if (queueName === dlqName) invalid.add('SQS_DLQ_NAME');
    sqs = Object.freeze({
      endpoint, region, credentials: Object.freeze({ accessKeyId, secretAccessKey }), queueName, dlqName,
      requestTimeoutMs: integer('SQS_REQUEST_TIMEOUT_MS', 25_000, 21_000, 60_000),
      maxAttempts: integer('SQS_MAX_ATTEMPTS', 3, 1, 5),
    });
  }
  const port = role === 'api' ? integer('API_PORT', 3000, nodeEnv === 'test' ? 0 : 1, 65_535) : undefined;
  if (invalid.size) throw new ConfigurationError([...invalid].sort());

  // A validação acima garante os campos exigidos pelo papel; valores alheios não são expostos.
  return Object.freeze({
    ...base,
    ...(database ? { database } : {}),
    ...(sqs ? { sqs } : {}),
    ...(port !== undefined ? { port } : {}),
  }) as ConfigurationByRole[ProcessRole];
}
