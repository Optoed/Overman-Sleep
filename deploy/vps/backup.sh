#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$(readlink -f "$0")")"
mkdir -p backups
target="backups/overman-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
docker compose exec -T postgres pg_dump -U postgres -d overman -Fc >"$target.partial"
[ -s "$target.partial" ] || { echo 'Backup empty; no successful backup recorded.' >&2; exit 1; }
mv -- "$target.partial" "$target"
sha256sum "$target" >"$target.sha256"
echo "Private backup saved: $target"
