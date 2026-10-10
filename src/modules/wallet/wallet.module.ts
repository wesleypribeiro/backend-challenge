import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggingModule } from '../../platform/logging/logging.module.js';
import type { JsonLogger } from '../../platform/logging/json-logger.js';
import { WalletController } from './http/wallet.controller.js';

/**
 * Wallet HTTP module: controllers only. Application services are constructed
 * per request with the request-context EntityManager (the use case owns the
 * SQL transaction — F2 D5); no singleton state lives here.
 */
@Module({})
export class WalletModule {
  static register(logger: JsonLogger): DynamicModule {
    return {
      module: WalletModule,
      imports: [LoggingModule.register(logger)],
      controllers: [WalletController],
    };
  }
}
