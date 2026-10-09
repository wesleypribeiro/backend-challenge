import { loadConfiguration } from '../platform/config/configuration.js';
import { JsonLogger } from '../platform/logging/json-logger.js';
import { SqsConnection } from '../platform/messaging/sqs/sqs-connection.js';
import { provisionQueues } from '../platform/messaging/sqs/provision.js';

const logger = new JsonLogger('provision');
let connection: SqsConnection | undefined;
try {
  const config = loadConfiguration('provision');
  connection = new SqsConnection(config.sqs);
  await provisionQueues(connection, config.sqs);
  logger.event('provision.completed', { runtime: `bun:${Bun.version}` });
} catch (error) {
  logger.event('provision.failed', { error }, 'error');
  process.exitCode = 1;
} finally {
  connection?.onModuleDestroy();
}
