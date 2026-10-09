import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Readiness } from './readiness.js';
import { JsonLogger } from '../logging/json-logger.js';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: Readiness, private readonly logger: JsonLogger) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    const result = await this.readiness.check();
    if (result.status === 'error') {
      this.logger.event('health.degraded', { checks: result.checks }, 'warn');
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
