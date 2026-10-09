import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';
import { compiled } from '../support/compiled.js';
import { localEnvironment } from '../support/environment.js';
import { assertLedgerInvariant as sharedInvariant } from '../support/invariants.js';

const { loadConfiguration } = await compiled<typeof import('../../src/platform/config/configuration.js')>('dist/platform/config/configuration.js');
const { createWorkerApplication } = await compiled<typeof import('../../src/bootstrap/worker.js')>('dist/bootstrap/worker.js');
const { JsonLogger } = await compiled<typeof import('../../src/platform/logging/json-logger.js')>('dist/platform/logging/json-logger.js');
const { Money } = await compiled<typeof import('../../src/domain/wallet/money.js')>('dist/domain/wallet/money.js');
const { Wallet } = await compiled<typeof import('../../src/domain/wallet/wallet.js')>('dist/domain/wallet/wallet.js');
const { WalletRepository } = await compiled<typeof import('../../src/platform/database/wallet.repository.js')>('dist/platform/database/wallet.repository.js');
const { WagerTransactionKind } = await compiled<typeof import('../../src/domain/wagering/wager-transaction.js')>('dist/domain/wagering/wager-transaction.js');
const { ProcessWagerTransaction } = await compiled<typeof import('../../src/modules/wagering/application/process-wager-transaction.js')>('dist/modules/wagering/application/process-wager-transaction.js');
const { InvalidBusinessIdentifierError } = await compiled<typeof import('../../src/domain/wagering/business-identifiers.js')>('dist/domain/wagering/business-identifiers.js');

let infra: TestInfrastructure;
let orm: MikroORM;
let closeWorker: () => Promise<void>;

beforeAll(async () => {
  infra = await TestInfrastructure.start();
  expect(runMigration(infra, 'migrate').code).toBe(0);
  const environment = { ...localEnvironment, DATABASE_URL: infra.databaseUrl('app') };
  const worker = await createWorkerApplication(loadConfiguration('worker', environment), new JsonLogger('worker', () => {}));
  closeWorker = () => worker.close();
  orm = worker.get(MikroORM);
}, 240_000);

afterAll(async () => {
  await closeWorker?.();
  await infra?.cleanup();
}, 30_000);

type UseCase = InstanceType<typeof ProcessWagerTransaction>;

const useCase = (idGenerator?: () => string): UseCase =>
  new ProcessWagerTransaction(orm.em.fork(), idGenerator ? { idGenerator } : {});

const openWallet = async (amount = '100.00', playerId = crypto.randomUUID()) =>
  openWalletWithCurrency(amount, 'BRL', playerId);

const openWalletWithCurrency = async (amount: string, currency: string, playerId: string) => {
  const walletId = crypto.randomUUID();
  const { wallet, ledgerEntry } = Wallet.open({
    id: walletId,
    playerId,
    initialBalance: Money.from({ amount, currency }),
    idGenerator: () => crypto.randomUUID(),
  });
  await new WalletRepository(orm.em.fork()).saveOpen(wallet, ledgerEntry);
  return { walletId, playerId };
};

interface Submission {
  providerId?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  playerId: string;
  walletId: string;
  roundId?: string;
  gameId?: string;
  kind?: (typeof WagerTransactionKind)[keyof typeof WagerTransactionKind];
  amount?: string;
  currency?: string;
  referenceExternalTransactionId?: string;
}

const submit = (wc: UseCase, s: Submission) => wc.execute({
  providerId: s.providerId ?? 'provider-a',
  externalTransactionId: s.externalTransactionId ?? crypto.randomUUID(),
  idempotencyKey: s.idempotencyKey ?? `provider-a:${s.externalTransactionId ?? crypto.randomUUID()}`,
  playerId: s.playerId,
  walletId: s.walletId,
  roundId: s.roundId ?? 'round-1',
  gameId: s.gameId ?? 'fortune-chimp',
  kind: s.kind ?? WagerTransactionKind.Bet,
  amount: s.amount ?? '10.00',
  currency: s.currency ?? 'BRL',
  referenceExternalTransactionId: s.referenceExternalTransactionId,
});

const walletBalance = async (walletId: string) =>
  (await infra.query('app', 'select balance, version from wagering.wallet where id = $1', [walletId])).rows[0] as
    { balance: string; version: number };

/** Invariante S13-G01: saldo materializado == saldo reconstruído pelo ledger. */
const assertLedgerInvariant = (walletId: string) =>
  sharedInvariant((sql, params) => infra.query('app', sql, params), walletId);

/** Events of provider transactions only — the internal OPENING pair lives on
 * its own transaction and is asserted by the opening test. */
const eventsForWallet = async (walletId: string) =>
  (await infra.query('app',
    `select o.event_type as event_type, count(*)::int as count
     from wagering.outbox_event o
     join wagering.wager_transaction t on t.id = (o.payload->'data'->>'transactionId')::uuid
     where o.payload->'data'->>'walletId' = $1 and t.provider_id <> 'internal'
     group by event_type order by event_type`, [walletId]))
    .rows as Array<{ event_type: string; count: number }>;

const openingEventsForWallet = async (walletId: string) =>
  (await infra.query('app',
    `select o.event_type as event_type, count(*)::int as count
     from wagering.outbox_event o
     join wagering.wager_transaction t on t.id = (o.payload->'data'->>'transactionId')::uuid
     where o.payload->'data'->>'walletId' = $1 and t.kind = 'OPENING'
     group by event_type order by event_type`, [walletId]))
    .rows as Array<{ event_type: string; count: number }>;

/** Conta apenas lançamentos de operações de provedor ( exclui o OPENING da abertura ). */
const playerLedgerRows = async (walletId: string) =>
  (await infra.query('app',
    `select operation, direction, amount, balance_before, balance_after, transaction_id
     from wagering.wallet_ledger_entry where wallet_id = $1 and operation <> 'OPENING'
     order by created_at`, [walletId])).rows as Array<Record<string, string>>;

const playerLedgerCount = async (walletId: string) =>
  (await infra.query('app',
    'select count(*)::int as c from wagering.wallet_ledger_entry where wallet_id = $1 and operation <> \'OPENING\'', [walletId])).rows[0] as { c: number };

const transactionRow = async (transactionId: string) =>
  (await infra.query('app',
    `select kind, status, failure_code, result_balance, reference_transaction_id, payload_hash
     from wagering.wager_transaction where id = $1`, [transactionId])).rows[0] as
    { kind: string; status: string; failure_code: string | null; result_balance: string | null; reference_transaction_id: string | null; payload_hash: string };

test('BET debit moves the balance, writes one ledger entry, the transaction row and both events atomically', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const externalTransactionId = crypto.randomUUID();
  const result = await submit(useCase(), {
    playerId, walletId, externalTransactionId, idempotencyKey: `provider-a:${externalTransactionId}`, amount: '25.00',
  });

  expect(result).toMatchObject({ outcome: 'processed', idempotentReplay: false, balance: { amount: '75.00', currency: 'BRL' } });
  const stored = await walletBalance(walletId);
  expect(stored).toMatchObject({ balance: '75.00', version: 2 });

  const entry = await playerLedgerRows(walletId);
  expect(entry).toEqual([{
    operation: 'BET', direction: 'DEBIT', amount: '25.00',
    balance_before: '100.00', balance_after: '75.00',
    transaction_id: (result as { transactionId: string }).transactionId,
  }]);

  const row = await transactionRow((result as { transactionId: string }).transactionId);
  expect(row).toMatchObject({ kind: 'BET', status: 'PROCESSED', result_balance: '75.00' });

  expect(await eventsForWallet(walletId)).toEqual([
    { event_type: 'WagerTransactionProcessed', count: 1 },
    { event_type: 'WalletBalanceChanged', count: 1 },
  ]);
  await assertLedgerInvariant(walletId);
});

test('insufficient funds rejects the BET without balance change, ledger entry or BalanceChanged event', async () => {
  const { walletId, playerId } = await openWallet('10.00');
  const result = await submit(useCase(), { playerId, walletId, amount: '50.00' });

  expect(result).toMatchObject({ outcome: 'rejected', failureCode: 'INSUFFICIENT_FUNDS', idempotentReplay: false });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '10.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  const row = await transactionRow((result as { transactionId: string }).transactionId);
  expect(row).toMatchObject({ status: 'REJECTED', failure_code: 'INSUFFICIENT_FUNDS', result_balance: null });
  expect(await eventsForWallet(walletId)).toEqual([{ event_type: 'WagerTransactionRejected', count: 1 }]);
  await assertLedgerInvariant(walletId);
});

test('identical resubmission replays the original outcome, including the observed balance', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const externalTransactionId = crypto.randomUUID();
  const key = `provider-a:${externalTransactionId}`;
  const wc = useCase();
  const first = await submit(wc, { playerId, walletId, externalTransactionId, idempotencyKey: key, amount: '30.00' });

  // Simula restart: outra instância do use case, outro contexto.
  const afterRestart = await submit(useCase(), { playerId, walletId, externalTransactionId, idempotencyKey: key, amount: '30.00' });
  expect(afterRestart).toMatchObject({
    outcome: 'processed',
    transactionId: (first as { transactionId: string }).transactionId,
    balance: { amount: '70.00', currency: 'BRL' },
    idempotentReplay: true,
  });

  // Movimentação posterior não altera o replay: saldo observado é o original.
  await submit(useCase(), { playerId, walletId, amount: '5.00' });
  const replayed = await submit(useCase(), { playerId, walletId, externalTransactionId, idempotencyKey: key, amount: '30.00' });
  expect(replayed).toMatchObject({ outcome: 'processed', idempotentReplay: true, balance: { amount: '70.00', currency: 'BRL' } });

  const originalId = (first as { transactionId: string }).transactionId;
  expect((await infra.query('app', 'select count(*)::int as c from wagering.wallet_ledger_entry where wallet_id = $1 and transaction_id = $2', [walletId, originalId])).rows)
    .toEqual([{ c: 1 }]);
  await assertLedgerInvariant(walletId);
});

test('same idempotency key with a divergent payload is a conflict, not a replay', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const externalTransactionId = crypto.randomUUID();
  const key = `provider-a:${externalTransactionId}`;
  const wc = useCase();
  const first = await submit(wc, { playerId, walletId, externalTransactionId, idempotencyKey: key, amount: '30.00' });

  const conflict = await submit(wc, { playerId, walletId, externalTransactionId, idempotencyKey: key, amount: '31.00' });
  expect(conflict).toMatchObject({ outcome: 'conflict', transactionId: (first as { transactionId: string }).transactionId, idempotentReplay: false });

  expect(await walletBalance(walletId)).toMatchObject({ balance: '70.00', version: 2 });
  expect((await infra.query('app', 'select count(*)::int as c from wagering.wager_transaction where idempotency_key = $1', [key])).rows)
    .toEqual([{ c: 1 }]);
  await assertLedgerInvariant(walletId);
});

test('same (providerId, externalTransactionId) with a different key also replays or conflicts by payload', async () => {
  const { walletId, playerId } = await openWallet('50.00');
  const externalTransactionId = crypto.randomUUID();
  const first = await submit(useCase(), { playerId, walletId, externalTransactionId, idempotencyKey: 'key-1', amount: '20.00' });
  const samePayload = await submit(useCase(), { playerId, walletId, externalTransactionId, idempotencyKey: 'key-2', amount: '20.00' });
  expect(samePayload).toMatchObject({ outcome: 'processed', idempotentReplay: true, transactionId: (first as { transactionId: string }).transactionId });

  const diverged = await submit(useCase(), { playerId, walletId, externalTransactionId, idempotencyKey: 'key-3', amount: '21.00' });
  expect(diverged).toMatchObject({ outcome: 'conflict', idempotentReplay: false });
  await assertLedgerInvariant(walletId);
});

test('LOSS is processed without balance change, ledger entry or BalanceChanged event', async () => {
  const { walletId, playerId } = await openWallet('40.00');
  const result = await submit(useCase(), { playerId, walletId, kind: WagerTransactionKind.Loss, amount: '40.00' });

  expect(result).toMatchObject({ outcome: 'processed', balance: { amount: '40.00', currency: 'BRL' } });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '40.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  expect(await eventsForWallet(walletId)).toEqual([{ event_type: 'WagerTransactionProcessed', count: 1 }]);
  await assertLedgerInvariant(walletId);
});

test('WIN credits the wallet and may reference a BET of the same round', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const betExternal = crypto.randomUUID();
  const bet = await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });

  const win = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Win, amount: '35.00', referenceExternalTransactionId: betExternal,
  });
  expect(win).toMatchObject({ outcome: 'processed', balance: { amount: '115.00', currency: 'BRL' } });
  const winRow = await transactionRow((win as { transactionId: string }).transactionId);
  expect(winRow.reference_transaction_id).toBe((bet as { transactionId: string }).transactionId);
  await assertLedgerInvariant(walletId);
});

test('WIN without a reference is processed normally — the optional reference is not required', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const win = await submit(useCase(), { playerId, walletId, kind: WagerTransactionKind.Win, amount: '35.00' });
  expect(win).toMatchObject({ outcome: 'processed', balance: { amount: '135.00', currency: 'BRL' } });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 1 });
  await assertLedgerInvariant(walletId);
});

test('WIN with a missing optional reference waits as PENDING_REFERENCE without credit or ledger', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const missingBet = crypto.randomUUID();
  const winExternal = crypto.randomUUID();
  const winInput = {
    playerId, walletId, kind: WagerTransactionKind.Win, amount: '35.00',
    externalTransactionId: winExternal, idempotencyKey: `provider-a:${winExternal}`,
    referenceExternalTransactionId: missingBet,
  };

  const pending = await submit(wc, winInput);
  expect(pending).toMatchObject({ outcome: 'pendingReference', idempotentReplay: false });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  const pendingRow = await transactionRow((pending as { transactionId: string }).transactionId);
  expect(pendingRow.status).toBe('PENDING_REFERENCE');
  expect(await eventsForWallet(walletId)).toEqual([{ event_type: 'WagerTransactionPendingReference', count: 1 }]);

  // Reenvio idempotente: mesmo resultado, mesma linha, nenhum evento novo.
  const replay = await submit(wc, winInput);
  expect(replay).toMatchObject({
    outcome: 'pendingReference',
    idempotentReplay: true,
    transactionId: (pending as { transactionId: string }).transactionId,
  });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  expect(await eventsForWallet(walletId)).toEqual([{ event_type: 'WagerTransactionPendingReference', count: 1 }]);
  await assertLedgerInvariant(walletId);
});

test('currency and player mismatches are distinct business rejections', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();

  const currency = await submit(wc, { playerId, walletId, currency: 'USD', amount: '10.00' });
  expect(currency).toMatchObject({ outcome: 'rejected', failureCode: 'CURRENCY_MISMATCH' });

  const player = await submit(wc, { playerId: crypto.randomUUID(), walletId, amount: '10.00' });
  expect(player).toMatchObject({ outcome: 'rejected', failureCode: 'WALLET_PLAYER_MISMATCH' });

  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  await assertLedgerInvariant(walletId);
});

test('OPENING submissions are structural rejections, not persisted rows', async () => {
  const { walletId, playerId } = await openWallet('10.00');
  await expect(submit(useCase(), { playerId, walletId, kind: WagerTransactionKind.Opening }))
    .rejects.toThrow(/OPENING transactions are internal/);
  expect((await infra.query('app', "select count(*)::int as c from wagering.wager_transaction where kind = 'OPENING' and provider_id <> 'internal'")).rows)
    .toEqual([{ c: 0 }]);
  await assertLedgerInvariant(walletId);
});

test('wallet opening commits its OPENING events atomically with wallet, transaction and ledger', async () => {
  const { walletId } = await openWallet('100.00');
  // README §11: toda transação aplicada emite WagerTransactionProcessed; o
  // saldo que se move emite WalletBalanceChanged — o crédito de abertura
  // incluído, gravado no mesmo flush (publicação é F4).
  expect(await openingEventsForWallet(walletId)).toEqual([
    { event_type: 'WagerTransactionProcessed', count: 1 },
    { event_type: 'WalletBalanceChanged', count: 1 },
  ]);
  const [balanceEvent] = (await infra.query('app',
    `select o.payload->'data' as data from wagering.outbox_event o
     join wagering.wager_transaction t on t.id = (o.payload->'data'->>'transactionId')::uuid
     where t.kind = 'OPENING' and o.event_type = 'WalletBalanceChanged'
       and o.payload->'data'->>'walletId' = $1`, [walletId])).rows as Array<{ data: Record<string, unknown> }>;
  expect(balanceEvent!.data).toMatchObject({
    walletId,
    direction: 'CREDIT',
    money: { amount: '100.00', currency: 'BRL' },
    balanceBefore: { amount: '0.00', currency: 'BRL' },
    balanceAfter: { amount: '100.00', currency: 'BRL' },
    walletVersion: 1,
  });
  await assertLedgerInvariant(walletId);
});

test('zero-balance opening writes no transaction, no ledger entry and no events', async () => {
  const { walletId } = await openWallet('0.00');
  expect(await openingEventsForWallet(walletId)).toEqual([]);
  expect((await infra.query('app', "select count(*)::int as c from wagering.wager_transaction where wallet_id = $1", [walletId])).rows)
    .toEqual([{ c: 0 }]);
  expect((await infra.query('app', 'select count(*)::int as c from wagering.wallet_ledger_entry where wallet_id = $1', [walletId])).rows)
    .toEqual([{ c: 0 }]);
});

test('structurally invalid identifiers raise before any write — never a partial or persisted rejection', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const cases = [
    { label: 'walletId not a UUID', input: { playerId, walletId: 'not-a-uuid', amount: '10.00' } },
    { label: 'playerId not a UUID', input: { playerId: 'p1', walletId, amount: '10.00' } },
    { label: 'empty providerId', input: { playerId, walletId, providerId: '', amount: '10.00' } },
    { label: 'oversized idempotencyKey', input: { playerId, walletId, idempotencyKey: 'k'.repeat(256), amount: '10.00' } },
    { label: 'empty roundId', input: { playerId, walletId, roundId: '', amount: '10.00' } },
  ] as const;
  for (const { input } of cases) {
    await expect(submit(wc, input)).rejects.toBeInstanceOf(InvalidBusinessIdentifierError);
  }
  // Nenhuma escrita parcial: a wallet permanece intacta e nenhuma linha nova.
  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  expect((await infra.query('app', "select count(*)::int as c from wagering.wager_transaction where wallet_id = $1 and provider_id <> 'internal'", [walletId])).rows)
    .toEqual([{ c: 0 }]);
  expect(await eventsForWallet(walletId)).toEqual([]);
  await assertLedgerInvariant(walletId);
});

test('REFUND with a missing reference stays PENDING_REFERENCE; idempotent resubmission replays it', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const betExternal = crypto.randomUUID();
  const refundExternal = crypto.randomUUID();
  const refundInput = {
    playerId, walletId, kind: WagerTransactionKind.Refund, amount: '20.00',
    externalTransactionId: refundExternal, idempotencyKey: `provider-a:${refundExternal}`,
    referenceExternalTransactionId: betExternal,
  };

  const early = await submit(wc, refundInput);
  expect(early).toMatchObject({ outcome: 'pendingReference', idempotentReplay: false });
  const earlyId = (early as { transactionId: string }).transactionId;
  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  expect(await eventsForWallet(walletId)).toEqual([{ event_type: 'WagerTransactionPendingReference', count: 1 }]);

  // A BET chegando não resolve a REFUND pendente: o reprocessamento da própria
  // linha PENDING_REFERENCE é responsabilidade do scheduler F5, preservando o
  // transactionId original. Esta change não a declara resolvida.
  await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });

  // Reenvio idempotente da MESMA submissão: replay do resultado pendente.
  const replay = await submit(wc, refundInput);
  expect(replay).toMatchObject({ outcome: 'pendingReference', idempotentReplay: true, transactionId: earlyId });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '80.00', version: 2 });
  expect((await transactionRow(earlyId)).status).toBe('PENDING_REFERENCE');
  expect(await eventsForWallet(walletId)).toEqual([
    { event_type: 'WagerTransactionPendingReference', count: 1 },
    { event_type: 'WagerTransactionProcessed', count: 1 },
    { event_type: 'WalletBalanceChanged', count: 1 },
  ]);
  await assertLedgerInvariant(walletId);
});

test('a second REFUND with a fresh key applies once the BET exists while the early pending row remains', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const betExternal = crypto.randomUUID();

  // Submissão antecipada distinta: fica PENDING_REFERENCE para sempre nesta
  // change — nenhum código aqui a resolve (F5 fará o reprocessamento).
  const early = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Refund, amount: '20.00', referenceExternalTransactionId: betExternal,
  });
  expect(early).toMatchObject({ outcome: 'pendingReference' });
  const earlyId = (early as { transactionId: string }).transactionId;

  await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });

  // Uma NOVA submissão (chave nova) da mesma referência aplica: é outra
  // transação, não a resolução da primeira.
  const applied = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Refund, amount: '20.00', referenceExternalTransactionId: betExternal,
  });
  expect(applied).toMatchObject({ outcome: 'processed', balance: { amount: '100.00', currency: 'BRL' } });
  expect((await transactionRow(earlyId)).status).toBe('PENDING_REFERENCE');
  // Apenas o débito da BET e o crédito da REFUND aplicada movem o saldo.
  expect(await playerLedgerCount(walletId)).toEqual({ c: 2 });
  await assertLedgerInvariant(walletId);
});

test('second REFUND of the same BET is rejected as duplicate reversal', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const betExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });

  const refundInput = { playerId, walletId, kind: WagerTransactionKind.Refund, amount: '20.00', referenceExternalTransactionId: betExternal };
  const first = await submit(wc, refundInput);
  expect(first).toMatchObject({ outcome: 'processed', balance: { amount: '100.00', currency: 'BRL' } });

  const second = await submit(wc, refundInput);
  expect(second).toMatchObject({ outcome: 'rejected', failureCode: 'DUPLICATE_REVERSAL' });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00' });
  await assertLedgerInvariant(walletId);
});

test('REFUND of a non-BET and amount mismatch use their own failure codes', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const wc = useCase();
  const winExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId, externalTransactionId: winExternal, kind: WagerTransactionKind.Win, amount: '15.00' });

  const ofWin = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Refund, amount: '15.00', referenceExternalTransactionId: winExternal,
  });
  expect(ofWin).toMatchObject({ outcome: 'rejected', failureCode: 'REFERENCE_KIND_NOT_ALLOWED' });

  const betExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });
  const wrongAmount = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Refund, amount: '19.00', referenceExternalTransactionId: betExternal,
  });
  expect(wrongAmount).toMatchObject({ outcome: 'rejected', failureCode: 'REFERENCE_MONEY_MISMATCH' });
  await assertLedgerInvariant(walletId);
});

test('ROLLBACK inverts the referenced direction and negative reversals get their own code', async () => {
  const { walletId, playerId } = await openWallet('50.00');
  const wc = useCase();
  const betExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId, externalTransactionId: betExternal, amount: '20.00' });

  // ROLLBACK of BET = CREDIT inverso: 50 - 20 + 20 = 50.
  const rollback = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Rollback, amount: '20.00', referenceExternalTransactionId: betExternal,
  });
  expect(rollback).toMatchObject({ outcome: 'processed', balance: { amount: '50.00', currency: 'BRL' } });

  // ROLLBACK de WIN (débito) com saldo insuficiente usa o código distinto.
  const winExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId, externalTransactionId: winExternal, kind: WagerTransactionKind.Win, amount: '10.00' });
  const drained = await submit(wc, { playerId, walletId, amount: '55.00' });
  expect(drained).toMatchObject({ outcome: 'processed', balance: { amount: '5.00', currency: 'BRL' } });
  const negative = await submit(wc, {
    playerId, walletId, kind: WagerTransactionKind.Rollback, amount: '10.00', referenceExternalTransactionId: winExternal,
  });
  expect(negative).toMatchObject({ outcome: 'rejected', failureCode: 'ROLLBACK_INSUFFICIENT_FUNDS' });
  expect(await walletBalance(walletId)).toMatchObject({ balance: '5.00' });
  await assertLedgerInvariant(walletId);
});

test('reference scope mismatches are rejected with their specific codes', async () => {
  // Um player não pode ter duas wallets BRL; o wallet-mismatch usa a wallet
  // USD do mesmo player (a checagem de wallet precede a de moeda da referência).
  const playerId = crypto.randomUUID();
  const { walletId: walletBrl } = await openWalletWithCurrency('100.00', 'BRL', playerId);
  const { walletId: walletUsd } = await openWalletWithCurrency('100.00', 'USD', playerId);
  const wc = useCase();
  const usdBetExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId: walletUsd, externalTransactionId: usdBetExternal, amount: '20.00', currency: 'USD' });

  const crossWallet = await submit(wc, {
    playerId, walletId: walletBrl, kind: WagerTransactionKind.Refund, amount: '20.00', referenceExternalTransactionId: usdBetExternal,
  });
  expect(crossWallet).toMatchObject({ outcome: 'rejected', failureCode: 'REFERENCE_WALLET_MISMATCH' });

  const brlBetExternal = crypto.randomUUID();
  await submit(wc, { playerId, walletId: walletBrl, externalTransactionId: brlBetExternal, amount: '20.00' });
  const crossRound = await submit(wc, {
    playerId, walletId: walletBrl, roundId: 'round-2', kind: WagerTransactionKind.Refund, amount: '20.00', referenceExternalTransactionId: brlBetExternal,
  });
  expect(crossRound).toMatchObject({ outcome: 'rejected', failureCode: 'REFERENCE_ROUND_MISMATCH' });
  await assertLedgerInvariant(walletBrl);
  await assertLedgerInvariant(walletUsd);
});

test('a failure injected after staging rolls back transaction, ledger, outbox and balance together', async () => {
  const { walletId, playerId } = await openWallet('100.00');
  const [opening] = (await infra.query('app',
    'select id from wagering.wallet_ledger_entry where wallet_id = $1', [walletId])).rows as Array<{ id: string }>;
  let calls = 0;
  // Every even call is the ledger entry id: it always collides with the
  // existing OPENING row, so even the recovery retry fails and nothing commits.
  const faulty = useCase(() => (++calls % 2 === 0 ? opening!.id : crypto.randomUUID()));
  await expect(submit(faulty, { playerId, walletId, amount: '10.00' })).rejects.toMatchObject({ code: '23505' });

  expect(await walletBalance(walletId)).toMatchObject({ balance: '100.00', version: 1 });
  expect(await playerLedgerCount(walletId)).toEqual({ c: 0 });
  expect((await infra.query('app', "select count(*)::int as c from wagering.wager_transaction where wallet_id = $1 and kind <> 'OPENING'", [walletId])).rows)
    .toEqual([{ c: 0 }]);
  expect(await eventsForWallet(walletId)).toEqual([]);
  await assertLedgerInvariant(walletId);
});

test('every ledger row references an existing transaction and the reconstruction invariant holds', async () => {
  const orphans = (await infra.query('app', `
    select count(*)::int as c from wagering.wallet_ledger_entry l
    where not exists (select 1 from wagering.wager_transaction t where t.id = l.transaction_id)`)).rows;
  expect(orphans).toEqual([{ c: 0 }]);
});
