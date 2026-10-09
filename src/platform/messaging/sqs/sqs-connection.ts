import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { OnModuleDestroy } from '@nestjs/common';
import type { ConfigurationByRole } from '../../config/configuration.js';

export type SqsConfiguration = ConfigurationByRole['provision']['sqs'];
export interface ResolvedQueue {
  readonly url: string;
  readonly arn: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export class SqsConnection implements OnModuleDestroy {
  readonly client: SQSClient;

  constructor(config: SqsConfiguration) {
    this.client = new SQSClient({
      endpoint: config.endpoint,
      region: config.region,
      // O SDK anexa metadata às credenciais; preservar a configuração imutável da aplicação.
      credentials: { ...config.credentials },
      maxAttempts: config.maxAttempts,
      retryMode: 'standard',
      // QueueUrl é identificador retornado pelo serviço; o destino de rede continua explícito.
      useQueueUrlAsEndpoint: false,
      requestHandler: {
        connectionTimeout: 1000,
        requestTimeout: config.requestTimeoutMs,
        throwOnRequestTimeout: true,
      },
    });
  }

  async resolveQueue(name: string, signal?: AbortSignal): Promise<ResolvedQueue> {
    const options = signal ? { abortSignal: signal } : {};
    const { QueueUrl } = await this.client.send(new GetQueueUrlCommand({ QueueName: name }), options);
    if (!QueueUrl) throw new Error('SQS response missing QueueUrl');
    const { Attributes } = await this.client.send(new GetQueueAttributesCommand({
      QueueUrl, AttributeNames: ['All'],
    }), options);
    if (!Attributes?.QueueArn) throw new Error('SQS response missing QueueArn');
    return { url: QueueUrl, arn: Attributes.QueueArn, attributes: Attributes };
  }

  onModuleDestroy(): void { this.client.destroy(); }
}
