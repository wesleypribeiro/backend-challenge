import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { WageringController } from './http/wagering.controller.js';

/**
 * Wagering HTTP module: controllers only. POST /wagering/transactions
 * delegates to ProcessWagerTransaction — the same use case the future SQS
 * consumer will reuse (README §10).
 */
@Module({})
export class WageringHttpModule {
  static register(): DynamicModule {
    return { module: WageringHttpModule, controllers: [WageringController] };
  }
}
