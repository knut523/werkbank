#!/usr/bin/env bash
# Werkbank aus einem Backup-Archiv wiederherstellen (Plan 81, Schnitt 5).
#
#   scripts/restore.sh <archiv.tar.gz> [--dry-run]
#
# Ziel kommt aus der Umgebung bzw. .env.local: MONGO_URI_WERKBANK, WERKBANK_DB (muss leer sein), WERKBANK_DOCS_DIR,
# WERKBANK_DATA_DIR, WERKBANK_BACKUP_KEY (nur für Personendaten-Dateien). Dateien werden nie überschrieben.
# Zum Üben gegen eine eigene Instanz: MONGO_URI_WERKBANK=mongodb://127.0.0.1:<anderer Port> WERKBANK_DB=werkbank_restore …
set -euo pipefail
WB="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-}"
[ -f "$archive" ] || { echo "Aufruf: scripts/restore.sh <archiv.tar.gz> [--dry-run]" >&2; exit 2; }
# .env.local nur für Werte, die nicht schon gesetzt sind (eine Übung mit eigener Mongo bleibt bei ihrer Mongo).
if [ -f "$WB/.env.local" ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [ -z "${!k:-}" ] && export "$k=$v"
  done < "$WB/.env.local"
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$archive" -C "$tmp"
node="$(command -v node || echo "$WB/.runtime/node/bin/node")"
cd "$WB/web"
"$node" server/restore-cli.ts "$tmp" "${2:-}"
