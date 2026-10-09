// EntitySchema class-less: a linha MikroORM 7 não possui API de decorators.
// Registration in ormOptions keeps the ORM layer apart from the domain classes.
export { WalletSchema } from './entities/wallet.entity.js';
export { WalletLedgerEntrySchema } from './entities/wallet-ledger-entry.entity.js';
export { WagerTransactionSchema } from './entities/wager-transaction.entity.js';
export { OutboxEventSchema } from './entities/outbox-event.entity.js';
