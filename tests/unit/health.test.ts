import { expect, test } from 'bun:test';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';

const { Readiness } = await compiled<typeof import('../../src/platform/health/readiness.js')>('dist/platform/health/readiness.js');
const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { checkTopology, queueAttributes } = await compiled<typeof import('../../src/platform/messaging/sqs/queue-topology.js')>('dist/platform/messaging/sqs/queue-topology.js');

function queues() {
  return {
    main: { url: 'technical-main', arn: 'technical-main-arn', attributes: {
      ...queueAttributes.main, RedrivePolicy: JSON.stringify({ deadLetterTargetArn: 'technical-dlq-arn', maxReceiveCount: 5 }),
    } },
    dlq: { url: 'technical-dlq', arn: 'technical-dlq-arn', attributes: {
      ...queueAttributes.dlq, RedriveAllowPolicy: JSON.stringify({ redrivePermission: 'byQueue', sourceQueueArns: ['technical-main-arn'] }),
    } },
  };
}

test('topology contract accepts valid attributes and rejects each incompatible attribute/policy', () => {
  const valid = queues();
  expect(() => checkTopology(valid.main, valid.dlq)).not.toThrow();
  for (const role of ['main', 'dlq'] as const) {
    for (const key of Object.keys(valid[role].attributes)) {
      const changed = queues();
      Object.assign(changed[role].attributes, { [key]: 'incompatible' });
      expect(() => checkTopology(changed.main, changed.dlq)).toThrow();
    }
  }
  const additional = queues();
  Object.assign(additional.dlq.attributes, { RedrivePolicy: '{}' });
  expect(() => checkTopology(additional.main, additional.dlq)).toThrow();
});

test('draining is negative and never opens a dependency connection', async () => {
  const readiness = new Readiness(loadConfiguration('worker', localEnvironment));
  readiness.beginDraining();
  expect(await readiness.check()).toEqual({
    status: 'error', checks: { postgresql: 'down', sqs: 'down' }, reason: 'shutting_down',
  });
});
