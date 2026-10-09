// Objetos técnicos exclusivamente em databases descartáveis do harness.
export const createPermissionFixture = `
  CREATE SCHEMA technical_probe AUTHORIZATION wagering_migrator;
  CREATE TABLE technical_probe.marker (id integer PRIMARY KEY, value text NOT NULL);
  INSERT INTO technical_probe.marker VALUES (1, 'preserved');
  GRANT USAGE ON SCHEMA technical_probe TO wagering_app;
  GRANT SELECT, INSERT ON technical_probe.marker TO wagering_app;
  CREATE TABLE public.technical_history_probe (id integer PRIMARY KEY);
`;

export const forbiddenApplicationSql = [
  'CREATE SCHEMA application_ddl',
  'CREATE TABLE public.application_ddl (id integer)',
  'CREATE TABLE technical_probe.application_ddl (id integer)',
  'CREATE TEMP TABLE application_ddl (id integer)',
  'ALTER TABLE technical_probe.marker ADD COLUMN illegal integer',
  'DROP TABLE technical_probe.marker',
  'TRUNCATE technical_probe.marker',
  'DROP TABLE public.technical_history_probe',
  'CREATE DATABASE application_ddl',
  'CREATE ROLE application_ddl',
  'SET ROLE wagering_migrator',
];
