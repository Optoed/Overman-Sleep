#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$(readlink -f "$0")")"
[ "$(id -u)" = 0 ] || { echo 'Run as root on your dedicated VPS.' >&2; exit 1; }
command -v docker >/dev/null && docker compose version >/dev/null || { echo 'Docker Engine with Compose v2 is required.' >&2; exit 1; }
command -v openssl >/dev/null || { echo 'OpenSSL is required.' >&2; exit 1; }
exec 9>.install.lock
flock -n 9 || { echo 'Another Overman deployment is running.' >&2; exit 1; }
[ -f .env ] || { echo 'Copy .env.example to .env and set your domain first.' >&2; exit 1; }
domain="$(sed -n 's/^OVERMAN_DOMAIN=//p' .env | tail -n 1)"
[[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] && [[ "$domain" == *.* ]] && [[ "$domain" != *example.com* ]] || { echo 'Set a real DNS hostname in .env.' >&2; exit 1; }
[ -s ../../dist/overman-sleep-beta.apk ] || { echo 'Signed Android APK missing from release.' >&2; exit 1; }
mkdir -p secrets backups
if [ ! -f secrets/.initialized ]; then
 [ -z "$(find secrets -maxdepth 1 -type f -print -quit)" ] || { echo 'Partial secret setup found; inspect locally before retrying. Nothing overwritten.' >&2; exit 1; }
 db_password="$(openssl rand -hex 32)"
 runtime_password="$(openssl rand -hex 32)"
 printf '%s' "$db_password" >secrets/db_password.txt
 printf '%s' "$runtime_password" >secrets/runtime_password.txt
 printf '{"host":"postgres","port":5432,"database":"overman","runtimeUser":"overman_runtime","runtimePassword":"%s"}\n' "$runtime_password" >secrets/api.json
 chown 999:999 secrets/db_password.txt
 chown 65532:65532 secrets/api.json
 chmod 400 secrets/db_password.txt secrets/api.json
 chmod 600 secrets/runtime_password.txt
 touch secrets/.initialized
 unset db_password runtime_password
fi
docker compose config --quiet
docker compose up -d --wait postgres
if docker compose exec -T postgres psql -U postgres -d overman -Atc "SELECT to_regclass('public.overman_deploy_migrations') IS NOT NULL" | grep -qx t; then
 bash backup.sh
fi
docker compose run --rm migrate
docker compose up -d --build --wait api web caddy
curl --fail --silent --show-error "https://$domain/health" >/dev/null
echo "Overman: https://$domain"
echo "Android: https://$domain/downloads/overman.apk"
echo 'Keep secrets/ and backups/ private. Existing data and secrets were not replaced.'
