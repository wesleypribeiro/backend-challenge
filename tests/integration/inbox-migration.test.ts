import { afterAll, beforeAll, expect, test } from 'bun:test';
import { TestInfrastructure } from '../support/infrastructure.js';
import { runMigration } from '../support/migrations.js';

const migrationNames = [
  'Migration20261009000100',
  'Migration20261009000200',
  'Migration20261009000300',
  'Migration20261009000400',
] as const;

const sha256 = (char: string) => char.repeat(64);
const insertInbox = (consumer: string, messageId: string, hash: string) => `
  insert into wagering.inbox_message (id, message_id, consumer_name, payload_hash, received_at)
  values (gen_random_uuid(), '${messageId}', '${consumer}', '${hash}', now())
`;

let infra: TestInfrastructure;
beforeAll(async () => {
  infra = await TestInfrastructure.start();
  expect(runMigration(infra, 'migrate').code).toBe(0);
}, 240_000);
afterAll(async () => { await infra?.cleanup(); }, 30_000);

test('real migration runner executes and records Migration20261009000400', async () => {
  const status = runMigration(infra, 'status');
  expect(status.code).toBe(0);
  expect(JSON.parse(status.stdout)).toMatchObject({
    event: 'migration.status',
    executed: [...migrationNames],
    pending: [],
  });
  expect((await infra.query('app', "select to_regclass('wagering.inbox_message')::text as inbox")).rows)
    .toEqual([{ inbox: 'wagering.inbox_message' }]);
});

test('inbox columns match the expected types and processed_at is nullable', async () => {
  const columns = (await infra.query('app', `
    select column_name, data_type, character_maximum_length, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'wagering' and table_name = 'inbox_message'
    order by ordinal_position
  `)).rows;
  expect(columns).toEqual([
    { column_name: 'id', data_type: 'uuid', character_maximum_length: null, is_nullable: 'NO', column_default: null },
    { column_name: 'message_id', data_type: 'character varying', character_maximum_length: 200, is_nullable: 'NO', column_default: null },
    { column_name: 'consumer_name', data_type: 'character varying', character_maximum_length: 100, is_nullable: 'NO', column_default: null },
    { column_name: 'payload_hash', data_type: 'character', character_maximum_length: 64, is_nullable: 'NO', column_default: null },
    { column_name: 'received_at', data_type: 'timestamp with time zone', character_maximum_length: null, is_nullable: 'NO', column_default: null },
    { column_name: 'processed_at', data_type: 'timestamp with time zone', character_maximum_length: null, is_nullable: 'YES', column_default: null },
  ]);
});

test('NOT NULL and CHECK constraints mirror the domain boundary validation', async () => {
  await expect(infra.query('app', `
    insert into wagering.inbox_message (id, message_id, consumer_name, payload_hash)
    values (gen_random_uuid(), 'msg-not-null', 'consumer-a', '${sha256('a')}')
  `)).rejects.toMatchObject({ code: '23502', column: 'received_at' });
  await expect(infra.query('app', insertInbox('consumer-a', '   ', sha256('a'))))
    .rejects.toMatchObject({ code: '23514', constraint: 'inbox_message_message_id_well_formed' });
  await expect(infra.query('app', insertInbox('consumer-a', ' msg-padded ', sha256('a'))))
    .rejects.toMatchObject({ code: '23514', constraint: 'inbox_message_message_id_well_formed' });
  await expect(infra.query('app', insertInbox('  ', 'msg-blank-consumer', sha256('a'))))
    .rejects.toMatchObject({ code: '23514', constraint: 'inbox_message_consumer_name_not_blank' });
  await expect(infra.query('app', insertInbox('consumer-a', 'msg-bad-hash', 'Z'.repeat(64))))
    .rejects.toMatchObject({ code: '23514', constraint: 'inbox_message_payload_hash_sha256' });
});

test('wagering_app inserts a pending inbox row and flips processed_at', async () => {
  await infra.query('app', insertInbox('consumer-flip', 'msg-flip-1', sha256('a')));
  expect((await infra.query('app', "select processed_at from wagering.inbox_message where message_id = 'msg-flip-1'")).rows)
    .toEqual([{ processed_at: null }]);
  await infra.query('app', "update wagering.inbox_message set processed_at = now() where message_id = 'msg-flip-1'");
  expect((await infra.query('app', "select processed_at is not null as flipped from wagering.inbox_message where message_id = 'msg-flip-1'")).rows)
    .toEqual([{ flipped: true }]);
});

test('duplicate (consumer_name, message_id) fails with 23505 on the named unique constraint', async () => {
  await infra.query('app', insertInbox('consumer-unique', 'msg-unique-1', sha256('a')));
  await expect(infra.query('app', insertInbox('consumer-unique', 'msg-unique-1', sha256('a'))))
    .rejects.toMatchObject({
      code: '23505',
      table: 'inbox_message',
      constraint: 'inbox_message_consumer_message_unique',
    });
});

test('message_id is unique per consumer, not globally', async () => {
  await infra.query('app', insertInbox('consumer-scope-a', 'msg-scope-1', sha256('a')));
  await infra.query('app', insertInbox('consumer-scope-b', 'msg-scope-1', sha256('b')));
  await infra.query('app', insertInbox('consumer-scope-a', 'msg-scope-2', sha256('a')));
  expect((await infra.query('app', "select consumer_name from wagering.inbox_message where message_id = 'msg-scope-1' order by consumer_name")).rows)
    .toEqual([{ consumer_name: 'consumer-scope-a' }, { consumer_name: 'consumer-scope-b' }]);
  expect((await infra.query('app', "select count(*)::int as count from wagering.inbox_message where consumer_name = 'consumer-scope-a'")).rows)
    .toEqual([{ count: 2 }]);
});

test('wagering_app may SELECT, INSERT and UPDATE processed_at only; DELETE, TRUNCATE and identity updates are denied', async () => {
  expect((await infra.query('app', `
    select has_table_privilege('wagering_app', 'wagering.inbox_message', 'SELECT') as "select",
           has_table_privilege('wagering_app', 'wagering.inbox_message', 'INSERT') as "insert",
           has_table_privilege('wagering_app', 'wagering.inbox_message', 'DELETE') as "delete",
           has_table_privilege('wagering_app', 'wagering.inbox_message', 'TRUNCATE') as "truncate",
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'processed_at', 'UPDATE') as update_processed_at,
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'id', 'UPDATE') as update_id,
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'message_id', 'UPDATE') as update_message_id,
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'consumer_name', 'UPDATE') as update_consumer_name,
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'payload_hash', 'UPDATE') as update_payload_hash,
           has_column_privilege('wagering_app', 'wagering.inbox_message', 'received_at', 'UPDATE') as update_received_at
  `)).rows).toEqual([{
    select: true, insert: true, delete: false, truncate: false,
    update_processed_at: true, update_id: false, update_message_id: false,
    update_consumer_name: false, update_payload_hash: false, update_received_at: false,
  }]);
  await expect(infra.query('app', "delete from wagering.inbox_message where message_id = 'msg-flip-1'"))
    .rejects.toMatchObject({ code: '42501' });
  await expect(infra.query('app', 'truncate wagering.inbox_message'))
    .rejects.toMatchObject({ code: '42501' });
  await expect(infra.query('app', "update wagering.inbox_message set message_id = 'tampered' where message_id = 'msg-flip-1'"))
    .rejects.toMatchObject({ code: '42501' });
  await expect(infra.query('app', `update wagering.inbox_message set payload_hash = '${sha256('b')}' where message_id = 'msg-flip-1'`))
    .rejects.toMatchObject({ code: '42501' });
  await expect(infra.query('app', "update wagering.inbox_message set received_at = now() where message_id = 'msg-flip-1'"))
    .rejects.toMatchObject({ code: '42501' });
  await expect(infra.query('app', "update wagering.inbox_message set processed_at = now(), message_id = 'tampered' where message_id = 'msg-flip-1'"))
    .rejects.toMatchObject({ code: '42501' });
  expect((await infra.query('app', "select message_id, processed_at is not null as flipped from wagering.inbox_message where message_id = 'msg-flip-1'")).rows)
    .toEqual([{ message_id: 'msg-flip-1', flipped: true }]);
});

test('an aborted SQL transaction leaves no inbox row behind', async () => {
  await expect(infra.query('app', `
    begin;
    ${insertInbox('consumer-tx', 'msg-aborted-1', sha256('c'))};
    select 1::int / 0;
    commit;
  `)).rejects.toMatchObject({ code: '22012' });
  expect((await infra.query('app', "select count(*)::int as count from wagering.inbox_message where message_id = 'msg-aborted-1'")).rows)
    .toEqual([{ count: 0 }]);
});

test('rollback removes only inbox_message and the up → down → up cycle restores it', async () => {
  expect(runMigration(infra, 'rollback').code).toBe(0);
  expect(JSON.parse(runMigration(infra, 'status').stdout)).toMatchObject({
    executed: [migrationNames[0], migrationNames[1], migrationNames[2]],
    pending: [migrationNames[3]],
  });
  expect((await infra.query('app', `
    select to_regclass('wagering.inbox_message')::text as inbox,
           to_regclass('wagering.wager_transaction')::text as transaction,
           to_regclass('wagering.outbox_event')::text as outbox,
           to_regclass('wagering.wallet')::text as wallet,
           to_regclass('wagering.wallet_ledger_entry')::text as ledger
  `)).rows).toEqual([{
    inbox: null,
    transaction: 'wagering.wager_transaction',
    outbox: 'wagering.outbox_event',
    wallet: 'wagering.wallet',
    ledger: 'wagering.wallet_ledger_entry',
  }]);

  expect(runMigration(infra, 'migrate').code).toBe(0);
  expect(JSON.parse(runMigration(infra, 'status').stdout)).toMatchObject({
    executed: [...migrationNames],
    pending: [],
  });
  expect((await infra.query('app', `
    select to_regclass('wagering.inbox_message')::text as inbox,
           to_regclass('wagering.wager_transaction')::text as transaction,
           to_regclass('wagering.outbox_event')::text as outbox,
           to_regclass('wagering.wallet')::text as wallet,
           to_regclass('wagering.wallet_ledger_entry')::text as ledger
  `)).rows).toEqual([{
    inbox: 'wagering.inbox_message',
    transaction: 'wagering.wager_transaction',
    outbox: 'wagering.outbox_event',
    wallet: 'wagering.wallet',
    ledger: 'wagering.wallet_ledger_entry',
  }]);
  expect((await infra.query('app', 'select count(*)::int as count from wagering.inbox_message')).rows)
    .toEqual([{ count: 0 }]);
}, 60_000);
