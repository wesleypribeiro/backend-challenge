#!/usr/bin/env bash
set -euo pipefail

# Bootstrap local; schemas/tabelas da aplicação pertencem às migrations futuras.
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${APP_DATABASE:?APP_DATABASE is required}"
: "${WAGERING_APP_PASSWORD:?WAGERING_APP_PASSWORD is required}"
: "${WAGERING_MIGRATOR_PASSWORD:?WAGERING_MIGRATOR_PASSWORD is required}"
if [[ ! "$APP_DATABASE" =~ ^[a-z][a-z0-9_]{0,62}$ ]] ||
   [[ "$APP_DATABASE" == postgres || "$APP_DATABASE" == template0 || "$APP_DATABASE" == template1 ]]; then
  echo 'Invalid APP_DATABASE' >&2
  exit 1
fi
if [[ "$WAGERING_APP_PASSWORD" == "$WAGERING_MIGRATOR_PASSWORD" ]]; then
  echo 'Application and migrator passwords must differ' >&2
  exit 1
fi

# \getenv e quoting do psql evitam interpolação shell/SQL e senha em argumentos.
psql -X --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_database APP_DATABASE
\getenv app_password WAGERING_APP_PASSWORD
\getenv migrator_password WAGERING_MIGRATOR_PASSWORD
\getenv admin_user POSTGRES_USER

SELECT 'CREATE ROLE wagering_app' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wagering_app') \gexec
SELECT 'CREATE ROLE wagering_migrator' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wagering_migrator') \gexec
ALTER ROLE wagering_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE wagering_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';

SELECT format('CREATE DATABASE %I OWNER %I', :'app_database', :'admin_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_database') \gexec

REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC, wagering_app, wagering_migrator;
GRANT CONNECT ON DATABASE :"app_database" TO wagering_app, wagering_migrator;
GRANT CREATE ON DATABASE :"app_database" TO wagering_migrator;

\connect :app_database
REVOKE ALL ON SCHEMA public FROM PUBLIC, wagering_app, wagering_migrator;
GRANT USAGE ON SCHEMA public TO wagering_app, wagering_migrator;
GRANT CREATE ON SCHEMA public TO wagering_migrator;
SQL
