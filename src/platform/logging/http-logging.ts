import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JsonLogger } from './json-logger.js';
import { correlationIdPattern, requestContext } from './request-context.js';

export function httpLogging(logger: JsonLogger) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const header = request.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && correlationIdPattern.test(header) ? header : crypto.randomUUID();
    const context = { correlationId };
    response.setHeader('x-correlation-id', correlationId);
    const startedAt = performance.now();
    response.once('finish', () => requestContext.run(context, () => {
      logger.event('http.completed', {
        method: request.method ?? '', statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }));
    requestContext.run(context, next);
  };
}
