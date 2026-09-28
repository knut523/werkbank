#!/usr/bin/env bash
# Stoppt alle Werkbank-Dienste (umgekehrte Reihenfolge), gezielt über die PID-Dateien.
set -uo pipefail
source "$(dirname "$0")/env.sh"
for name in werkbank-web librechat claude-bridge meilisearch mongodb; do
  f="$PIDS/$name.pid"
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
    echo "  ■ $name gestoppt"
  fi
  rm -f "$f"
done
