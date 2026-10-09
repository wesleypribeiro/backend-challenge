import { Migration } from '@mikro-orm/migrations';

/**
 * Financial migration: creates wagering.wallet and wagering.wallet_ledger_entry.
 *
 * Invariants enforced at the DB level:
 *   - wallet.balance >= 0 (CHECK constraint)
 *   - UNIQUE(player_id, currency) on wallet
 *   - wallet_ledger_entry is append-only: BEFORE UPDATE/DELETE/TRUNCATE
 *     statement triggers raise an exception for every role (the spec requires
 *     the database to reject the operation, not to silently affect zero rows;
 *     INSTEAD NOTHING rules would report success)
 *   - triggers (not event triggers) keep the migration runnable inside the
 *     transactional migrator; CREATE EVENT TRIGGER cannot run in a transaction
 *   - FK wallet_ledger_entry (wallet_id, currency) -> wallet (id, currency),
 *     DEFERRABLE INITIALLY DEFERRED: the composite key rejects ledger rows
 *     whose currency diverges from the wallet currency (README invariant),
 *     and the deferral lets a single Unit of Work flush insert wallet and
 *     ledger in any order inside one transaction; the constraint is still
 *     enforced at commit and violations remain atomic (whole flush rolls
 *     back). wallet gains UNIQUE (id, currency) as the FK target.
 *   - at most one ledger entry per wallet per transaction (UNIQUE)
 *   - direction IN ('DEBIT','CREDIT'); amount > 0; balance_before >= 0;
 *     balance_after = balance_before ± amount; balance_after >= 0
 *   - NUMERIC(20,2) for all monetary columns
 *
 * Reversible: down() drops triggers/function first, then tables in dependency order.
 */
export class Migration20261009000200 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wagering.wallet (
        id         UUID          NOT NULL,
        player_id  UUID          NOT NULL,
        currency   CHAR(3)       NOT NULL,
        balance    NUMERIC(20,2) NOT NULL,
        version    INTEGER       NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT wallet_pkey PRIMARY KEY (id),
        CONSTRAINT wallet_balance_non_negative CHECK (balance >= 0),
        CONSTRAINT wallet_player_currency_unique UNIQUE (player_id, currency),
        CONSTRAINT wallet_id_currency_unique UNIQUE (id, currency)
      )
    `);

    this.addSql(`
      CREATE TABLE wagering.wallet_ledger_entry (
        id             UUID          NOT NULL,
        wallet_id      UUID          NOT NULL,
        transaction_id UUID          NOT NULL,
        operation      VARCHAR(20)   NOT NULL,
        direction      VARCHAR(8)    NOT NULL,
        amount         NUMERIC(20,2) NOT NULL,
        currency       CHAR(3)       NOT NULL,
        balance_before NUMERIC(20,2) NOT NULL,
        balance_after  NUMERIC(20,2) NOT NULL,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT wallet_ledger_entry_pkey PRIMARY KEY (id),
        CONSTRAINT wallet_ledger_entry_wallet_currency_fk
          FOREIGN KEY (wallet_id, currency) REFERENCES wagering.wallet(id, currency)
          DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT wallet_ledger_entry_transaction_unique
          UNIQUE (wallet_id, transaction_id),
        CONSTRAINT wallet_ledger_entry_amount_positive CHECK (amount > 0),
        CONSTRAINT wallet_ledger_entry_direction_valid
          CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT wallet_ledger_entry_balance_before_non_negative
          CHECK (balance_before >= 0),
        CONSTRAINT wallet_ledger_entry_balance_after_non_negative
          CHECK (balance_after >= 0),
        CONSTRAINT wallet_ledger_entry_arithmetic_consistent
          CHECK (
            (direction = 'CREDIT' AND balance_after = balance_before + amount) OR
            (direction = 'DEBIT'  AND balance_after = balance_before - amount)
          )
      )
    `);

    this.addSql('GRANT SELECT, INSERT ON TABLE wagering.wallet TO wagering_app');
    this.addSql('GRANT SELECT, INSERT ON TABLE wagering.wallet_ledger_entry TO wagering_app');
    // wallet UPDATE is needed for balance/version changes via the ORM Unit of Work.
    this.addSql('GRANT UPDATE ON TABLE wagering.wallet TO wagering_app');

    this.addSql(`
      CREATE FUNCTION wagering.reject_ledger_mutation()
        RETURNS trigger LANGUAGE plpgsql AS
      $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entry is append-only: % is not allowed', TG_OP;
      END;
      $$
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_no_update
        BEFORE UPDATE ON wagering.wallet_ledger_entry
        FOR EACH STATEMENT EXECUTE FUNCTION wagering.reject_ledger_mutation()
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_no_delete
        BEFORE DELETE ON wagering.wallet_ledger_entry
        FOR EACH STATEMENT EXECUTE FUNCTION wagering.reject_ledger_mutation()
    `);
    this.addSql(`
      CREATE TRIGGER wallet_ledger_no_truncate
        BEFORE TRUNCATE ON wagering.wallet_ledger_entry
        FOR EACH STATEMENT EXECUTE FUNCTION wagering.reject_ledger_mutation()
    `);
  }

  override async down(): Promise<void> {
    this.addSql('DROP TRIGGER IF EXISTS wallet_ledger_no_update ON wagering.wallet_ledger_entry');
    this.addSql('DROP TRIGGER IF EXISTS wallet_ledger_no_delete ON wagering.wallet_ledger_entry');
    this.addSql('DROP TRIGGER IF EXISTS wallet_ledger_no_truncate ON wagering.wallet_ledger_entry');
    this.addSql('DROP FUNCTION IF EXISTS wagering.reject_ledger_mutation()');
    this.addSql('DROP TABLE IF EXISTS wagering.wallet_ledger_entry');
    this.addSql('DROP TABLE IF EXISTS wagering.wallet');
  }
}
