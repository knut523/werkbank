#!/usr/bin/env bash
# Auswertung des Such-Protokolls der Agenten (web/mcp/search-log.ts): Top-Anfragen, Nulltreffer, Fehlgriffe.
#   scripts/suchlog.sh [Verzeichnis] [--tage N] [--json]
# Vorgabe-Verzeichnis: .runtime/search-log dieses Checkouts. Liest nur Pfade und Suchwörter, keine Inhalte.
set -euo pipefail
WB="$(cd "$(dirname "$0")/.." && pwd)"
[ -x "$WB/.runtime/node/bin/node" ] && export PATH="$WB/.runtime/node/bin:$PATH"
DIR="$WB/.runtime/search-log"
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then DIR="$1"; shift; fi
exec node "$WB/web/mcp/search-log-summary.ts" "$DIR" "$@"
