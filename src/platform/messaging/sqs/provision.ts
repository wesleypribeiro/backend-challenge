import { CreateQueueCommand, QueueDoesNotExist, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { SqsConnection } from './sqs-connection.js';
import type { ResolvedQueue, SqsConfiguration } from './sqs-connection.js';
import { queueAttributes as attributes, checkBase, checkRedrive, checkAllow, checkTopology } from './queue-topology.js';

export async function provisionQueues(
  connection: SqsConnection,
  names: Pick<SqsConfiguration, 'queueName' | 'dlqName'>,
  signal = AbortSignal.timeout(120_000),
): Promise<{ main: ResolvedQueue; dlq: ResolvedQueue }> {
  async function find(name: string): Promise<ResolvedQueue | undefined> {
    try { return await connection.resolveQueue(name, signal); }
    catch (error) {
      if (error instanceof QueueDoesNotExist) return undefined;
      throw error;
    }
  }

  // Preflight de ambas antes de criar/alterar qualquer recurso existente.
  let dlq = await find(names.dlqName);
  let main = await find(names.queueName);
  if (dlq) checkBase(dlq, 'dlq');
  if (main) { checkBase(main, 'main'); checkRedrive(main, dlq); }
  if (dlq?.attributes.RedriveAllowPolicy) checkAllow(dlq, main);

  if (!dlq) {
    await connection.client.send(new CreateQueueCommand({
      QueueName: names.dlqName, Attributes: attributes.dlq,
    }), { abortSignal: signal });
    dlq = await connection.resolveQueue(names.dlqName, signal);
  }
  if (!main) {
    await connection.client.send(new CreateQueueCommand({
      QueueName: names.queueName,
      Attributes: {
        ...attributes.main,
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 5 }),
      },
    }), { abortSignal: signal });
    main = await connection.resolveQueue(names.queueName, signal);
  }
  // Completar a ligação inicial após conhecer o ARN real da principal. Não reconciliar drift.
  if (!dlq.attributes.RedriveAllowPolicy) {
    await connection.client.send(new SetQueueAttributesCommand({
      QueueUrl: dlq.url,
      Attributes: { RedriveAllowPolicy: JSON.stringify({ redrivePermission: 'byQueue', sourceQueueArns: [main.arn] }) },
    }), { abortSignal: signal });
  }
  // Sucesso exige leitura dos atributos efetivos do emulador, não apenas resposta de Create/Set.
  dlq = await connection.resolveQueue(names.dlqName, signal);
  main = await connection.resolveQueue(names.queueName, signal);
  checkTopology(main, dlq);
  return { main, dlq };
}
