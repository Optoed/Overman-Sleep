#!/usr/bin/env bash
set -euo pipefail
export PGHOST=postgres PGUSER=postgres PGDATABASE=overman
export PGPASSWORD="$(cat /run/secrets/db_password)"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.overman_deploy_migrations(filename text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON public.overman_deploy_migrations FROM PUBLIC;
SQL
for file in /migrations/[0-9][0-9][0-9]_*.sql; do
 name="$(basename "$file")"
 digest="$(sha256sum "$file" | cut -d ' ' -f 1)"
 applied="$(psql -X -At -v ON_ERROR_STOP=1 -v filename="$name" <<'SQL'
SELECT sha256 FROM public.overman_deploy_migrations WHERE filename=:'filename';
SQL
)"
 if [ -n "$applied" ]; then
  [ "$applied" = "$digest" ] || { echo "Applied migration changed: $name" >&2; exit 1; }
  continue
 fi
 # Existing migration files include transaction boundaries. Replace only whole
 # BEGIN;/COMMIT; lines so DDL and its checksum commit atomically together.
 {
  printf 'BEGIN;\n'
  awk 'tolower($0) !~ /^[[:space:]]*(begin|commit);[[:space:]]*$/' "$file"
  printf "\nINSERT INTO public.overman_deploy_migrations(filename,sha256) VALUES (:'filename',:'digest');\nCOMMIT;\n"
 } | psql -X -v ON_ERROR_STOP=1 -v filename="$name" -v digest="$digest"
done
export OVERMAN_RUNTIME_PASSWORD="$(cat /run/secrets/runtime_password)"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_password OVERMAN_RUNTIME_PASSWORD
SELECT format('CREATE ROLE overman_runtime LOGIN PASSWORD %L',:'runtime_password')
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='overman_runtime')
\gexec
GRANT overman_client,overman_authenticator TO overman_runtime;
SQL
unset PGPASSWORD OVERMAN_RUNTIME_PASSWORD
echo 'Database migrations verified; application runtime role has only guarded API functions.'
