import { Migration } from '@mikro-orm/migrations';

/**
 * Inbox migration (F3): creates wagering.inbox_message — the persistent
 * per-consumer dedup record that participates in the same SQL transaction
 * as the financial processing (README §6.5/§11).
 *
 * Invariants enforced at the DB level:
 *   - UNIQUE (consumer_name, message_id) named
 *     inbox_message_consumer_message_unique: the 23505 handler classifies
 *     duplicates by this stable constraint name (F3 decision 4)
 *   - processed_at nullable: the row is INSERTed (processed_at NULL) before
 *     the wallet lock and flipped by UPDATE in the same transaction before
 *     commit; NULL never becomes a committed state (F3 decision 1)
 *   - received_at NOT NULL with no DEFAULT: the consumer must supply the
 *     receive timestamp (InboxMessage.receive stamps it); a silent DB
 *     default would mask a missing value from the application
 *   - message_id well-formed (trimmed, non-empty) and payload_hash a
 *     sha-256 hex digest: CHECKs mirror the domain boundary validation of
 *     InboxMessage.receive (README §5.9 — schema-level guarantees)
 *   - least privilege: wagering_app holds SELECT, INSERT and column-level
 *     UPDATE on processed_at only — identity/content columns are immutable
 *     after insert; DELETE/TRUNCATE/DDL stay with the migrator
 *
 * Reversible: down() drops only this table (no FKs reference it; grants and
 * indexes go with the table). wallet/wallet_ledger_entry/wager_transaction/
 * outbox_event from F1/F2 are untouched.
 */
export class Migration20261009000400 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wagering.inbox_message (
        id            UUID         NOT NULL,
        message_id    VARCHAR(200) NOT NULL,
        consumer_name VARCHAR(100) NOT NULL,
        payload_hash  CHAR(64)     NOT NULL,
        received_at   TIMESTAMPTZ  NOT NULL,
        processed_at  TIMESTAMPTZ,
        CONSTRAINT inbox_message_pkey PRIMARY KEY (id),
        CONSTRAINT inbox_message_consumer_message_unique
          UNIQUE (consumer_name, message_id),
        CONSTRAINT inbox_message_message_id_well_formed
          CHECK (message_id = btrim(message_id) AND length(message_id) > 0),
        CONSTRAINT inbox_message_consumer_name_not_blank
          CHECK (length(btrim(consumer_name)) > 0),
        CONSTRAINT inbox_message_payload_hash_sha256
          CHECK (payload_hash ~ '^[0-9a-f]{64}$')
      )
    `);

    this.addSql('GRANT SELECT, INSERT ON TABLE wagering.inbox_message TO wagering_app');
    // Column-level UPDATE: the app role exists exclusively to flip
    // processed_at (F3 decision 1); identity/content columns must never be
    // mutable through the application connection.
    this.addSql('GRANT UPDATE (processed_at) ON wagering.inbox_message TO wagering_app');
  }

  override async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS wagering.inbox_message');
  }
}
