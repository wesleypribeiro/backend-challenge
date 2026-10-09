import { DecimalType, EntitySchema } from '@mikro-orm/core';

export interface PersistenceRecord { id: number; label: string; decimal: string }
export const PersistenceRecordSchema = new EntitySchema<PersistenceRecord>({
  name: 'PersistenceRecord', schema: 'technical_probe', tableName: 'record',
  properties: {
    id: { type: 'integer', primary: true, autoincrement: false },
    label: { type: 'string' },
    decimal: { type: new DecimalType('string'), precision: 20, scale: 2 },
  },
});

// DDL explícito somente no database descartável; não usar schema sync nem permissões ampliadas.
export const persistenceFixtureSql = `
  create schema technical_probe authorization wagering_migrator;
  create table technical_probe.record (id integer primary key, label text not null, decimal numeric(20,2) not null);
  grant usage on schema technical_probe to wagering_app;
  grant select, insert, update, delete on technical_probe.record to wagering_app;
  insert into technical_probe.record values (1, 'original', '0.00');
`;
