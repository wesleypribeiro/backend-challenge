import { Migration } from '@mikro-orm/migrations';

/**
 * Wagering transaction migration (F2): creates wagering.wager_transaction and
 * wagering.outbox_event, and ties every ledger row to a real transaction.
 *
 * Invariants enforced at the DB level:
 *   - UNIQUE (provider_id, external_transaction_id): provider-side identity
 *   - UNIQUE (idempotency_key): persistent idempotency across restarts
 *   - kind/status CHECK constraints mirror the domain enums
 *   - amount > 0; money columns NUMERIC(20,2)
 *   - self-FK reference_transaction_id DEFERRABLE (target always pre-exists)
 *   - wallet FK DEFERRABLE so a Unit of Work flush may insert in any order
 *     inside one transaction; still enforced at commit
 *   - partial unique (reference_transaction_id, kind) WHERE status='PROCESSED'
 *     AND kind IN ('REFUND','ROLLBACK'): a given transaction can be reversed
 *     by each reversal kind at most once; WIN may reference a BET freely
 *   - outbox status PENDING/PUBLISHED; attempts >= 0
 *   - wallet_ledger_entry.transaction_id gains a DEFERRABLE FK to
 *     wager_transaction(id): orphan ledger references become impossible
 *     (F1 D10 handoff; the F1 opening flow now inserts the OPENING row)
 *
 * Reversible: down() drops the ledger FK first, then the new tables in
 * dependency order. wallet/wallet_ledger_entry from F1 are untouched.
 */
export class Migration20261009000300 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wagering.wager_transaction (
        id                              UUID          NOT NULL,
        provider_id                     VARCHAR(100)  NOT NULL,
        external_transaction_id         VARCHAR(200)  NOT NULL,
        idempotency_key                 VARCHAR(300)  NOT NULL,
        payload_hash                    CHAR(64)      NOT NULL,
        wallet_id                       UUID          NOT NULL,
        player_id                       UUID          NOT NULL,
        round_id                        VARCHAR(100)  NOT NULL,
        game_id                         VARCHAR(100)  NOT NULL,
        kind                            VARCHAR(20)   NOT NULL,
        status                          VARCHAR(20)   NOT NULL,
        money_amount                    NUMERIC(20,2) NOT NULL,
        money_currency                  CHAR(3)       NOT NULL,
        reference_external_transaction_id VARCHAR(200),
        reference_transaction_id        UUID,
        failure_code                    VARCHAR(50),
        result_balance                  NUMERIC(20,2),
        created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        processed_at                    TIMESTAMPTZ,
        CONSTRAINT wager_transaction_pkey PRIMARY KEY (id),
        CONSTRAINT wager_transaction_wallet_fk
          FOREIGN KEY (wallet_id) REFERENCES wagering.wallet(id)
          DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT wager_transaction_reference_fk
          FOREIGN KEY (reference_transaction_id) REFERENCES wagering.wager_transaction(id)
          DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT wager_transaction_provider_external_unique
          UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_transaction_idempotency_key_unique
          UNIQUE (idempotency_key),
        CONSTRAINT wager_transaction_kind_valid
          CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT wager_transaction_status_valid
          CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT wager_transaction_amount_positive
          CHECK (money_amount > 0)
      )
    `);

    this.addSql(`
      CREATE UNIQUE INDEX wager_transaction_reversal_unique
        ON wagering.wager_transaction (reference_transaction_id, kind)
        WHERE status = 'PROCESSED' AND kind IN ('REFUND', 'ROLLBACK')
          AND reference_transaction_id IS NOT NULL
    `);

    this.addSql(`
      CREATE TABLE wagering.outbox_event (
        id             UUID         NOT NULL,
        aggregate_id   UUID         NOT NULL,
        event_type     VARCHAR(100) NOT NULL,
        payload        JSONB        NOT NULL,
        status         VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
        attempts       INTEGER      NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        published_at   TIMESTAMPTZ,
        CONSTRAINT outbox_event_pkey PRIMARY KEY (id),
        CONSTRAINT outbox_event_status_valid
          CHECK (status IN ('PENDING', 'PUBLISHED')),
        CONSTRAINT outbox_event_attempts_non_negative
          CHECK (attempts >= 0)
      )
    `);

    this.addSql(`
      ALTER TABLE wagering.wallet_ledger_entry
        ADD CONSTRAINT wallet_ledger_entry_transaction_fk
        FOREIGN KEY (transaction_id) REFERENCES wagering.wager_transaction(id)
        DEFERRABLE INITIALLY DEFERRED
    `);

    this.addSql('GRANT SELECT, INSERT ON TABLE wagering.wager_transaction TO wagering_app');
    this.addSql('GRANT SELECT, INSERT ON TABLE wagering.outbox_event TO wagering_app');
    // outbox UPDATE is granted to the F4 publisher, not to the processing path:
    // transactions are inserted already in their final status.
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE wagering.wallet_ledger_entry
        DROP CONSTRAINT IF EXISTS wallet_ledger_entry_transaction_fk
    `);
    this.addSql('DROP TABLE IF EXISTS wagering.outbox_event');
    this.addSql('DROP TABLE IF EXISTS wagering.wager_transaction');
  }
}
