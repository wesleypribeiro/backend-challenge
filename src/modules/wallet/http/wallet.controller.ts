import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { NoopAuthGuard } from '../../../platform/auth/noop-auth.guard.js';
import { parseUuidPath } from '../../../platform/http/path-params.js';
import { OpenWallet } from '../application/open-wallet.js';
import { GetWallet } from '../application/get-wallet.js';
import {
  ListLedger,
  decodeLedgerCursor,
  parseLedgerLimit,
} from '../application/list-ledger.js';
import { ReconcileWallet } from '../application/reconcile-wallet.js';
import { parseCreateWalletBody } from './dto.js';
import { JsonLogger } from '../../../platform/logging/json-logger.js';

/**
 * Wallet HTTP surface (README §9). Handlers parse/validate at the boundary
 * and delegate to application services; the global exception filter maps
 * domain/application errors to the status contract. NoopAuthGuard is the
 * documented swap point for a real identity provider.
 */
@Controller('wallets')
@UseGuards(NoopAuthGuard)
export class WalletController {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    private readonly logger: JsonLogger,
  ) {}

  @Post()
  async create(@Body() body: unknown) {
    return new OpenWallet(this.em).execute(parseCreateWalletBody(body));
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string) {
    return new GetWallet(this.em).execute(parseUuidPath('walletId', walletId));
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const id = parseUuidPath('walletId', walletId);
    const parsedLimit = parseLedgerLimit(limit);
    const parsedCursor = cursor === undefined ? undefined : decodeLedgerCursor(cursor);
    return new ListLedger(this.em).execute(id, {
      ...(parsedCursor ? { cursor: parsedCursor } : {}),
      limit: parsedLimit,
    });
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  async reconcile(@Param('walletId') walletId: string) {
    return new ReconcileWallet(this.em, this.logger).execute(parseUuidPath('walletId', walletId));
  }
}
