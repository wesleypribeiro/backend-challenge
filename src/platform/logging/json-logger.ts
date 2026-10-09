import type { LoggerService } from '@nestjs/common';
import { ConfigurationError } from '../config/configuration.js';
import type { ProcessRole } from '../config/configuration.js';
import { requestContext } from './request-context.js';

type Level = 'info' | 'warn' | 'error' | 'debug' | 'fatal';
type Event = 'process.starting' | 'process.started' | 'process.stopping' | 'process.stopped' |
  'bootstrap.failed' | 'http.completed' | 'nest.log' | 'nest.error' | 'nest.warn' | 'nest.debug' | 'nest.fatal';
interface Details {
  port?: number;
  runtime?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  signal?: string;
  error?: unknown;
}
type Sink = (line: string, level: Level) => void;

export class JsonLogger implements LoggerService {
  constructor(
    private readonly role: ProcessRole,
    private readonly sink: Sink = (line, level) => {
      (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${line}\n`);
    },
  ) {}

  event(event: Event, details: Details = {}, level: Level = 'info'): void {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(), level, service: `jungle-${this.role}`, event,
    };
    const correlationId = requestContext.getStore()?.correlationId;
    if (correlationId) record.correlationId = correlationId;
    // Allowlist: nunca serializar objetos arbitrários, mensagens/stack de erro, headers, URL ou body.
    for (const key of ['port', 'statusCode', 'durationMs'] as const) {
      const value = details[key];
      if (typeof value === 'number' && Number.isFinite(value)) record[key] = value;
    }
    if (details.runtime && /^bun:\d+\.\d+\.\d+$/.test(details.runtime)) record.runtime = details.runtime;
    if (details.method && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(details.method)) record.method = details.method;
    if (details.signal && ['SIGINT', 'SIGTERM'].includes(details.signal)) record.signal = details.signal;
    if (details.error !== undefined) {
      record.errorType = details.error instanceof ConfigurationError ? 'ConfigurationError' : 'Error';
      if (details.error instanceof ConfigurationError) record.variables = details.error.variables;
      if (typeof details.error === 'object' && details.error !== null && 'code' in details.error) {
        const code = details.error.code;
        if (typeof code === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EADDRINUSE', 'ENOTFOUND', 'EACCES'].includes(code)) record.errorCode = code;
      }
    }
    this.sink(JSON.stringify(record), level);
  }

  log(_message: unknown, ..._params: unknown[]): void { this.event('nest.log'); }
  error(error: unknown, ..._params: unknown[]): void { this.event('nest.error', { error }, 'error'); }
  warn(_message: unknown, ..._params: unknown[]): void { this.event('nest.warn', {}, 'warn'); }
  debug(_message: unknown, ..._params: unknown[]): void { this.event('nest.debug', {}, 'debug'); }
  verbose(_message: unknown, ..._params: unknown[]): void { this.event('nest.debug', {}, 'debug'); }
  fatal(error: unknown, ..._params: unknown[]): void { this.event('nest.fatal', { error }, 'fatal'); }
}
