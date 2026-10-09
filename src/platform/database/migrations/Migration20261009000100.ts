import { Migration } from '@mikro-orm/migrations';

export class Migration20261009000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql('create schema wagering authorization wagering_migrator');
    this.addSql('revoke all on schema wagering from public, wagering_app');
    this.addSql('grant usage on schema wagering to wagering_app');
    this.addSql('revoke all on table public.mikro_orm_migrations from public, wagering_app');
    this.addSql('grant select on table public.mikro_orm_migrations to wagering_app');
  }

  override async down(): Promise<void> {
    // RESTRICT recusa objetos adicionais. A transação mantém schema/permissões em caso de falha.
    this.addSql('drop schema wagering restrict');
  }
}
