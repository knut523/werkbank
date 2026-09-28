#!/usr/bin/env bash
# Startet MongoDB, Meilisearch, claude-bridge und LibreChat im Hintergrund (alles auf 127.0.0.1).
# Logs: .runtime/logs/<dienst>.log · PIDs: .runtime/pids/<dienst>.pid
# BRIDGE_MOCK=1 scripts/start.sh startet die Brücke im Mock-Modus (kein Claude-Aufruf).
set -euo pipefail
source "$(dirname "$0")/env.sh"

[ -f "$WB/.env.local" ] || { echo "Fehlt: .env.local – erst scripts/setup.sh ausführen"; exit 1; }
set -a; source "$WB/librechat/.env"; source "$WB/.env.local"; set +a

running() { [ -f "$PIDS/$1.pid" ] && kill -0 "$(cat "$PIDS/$1.pid")" 2>/dev/null; }

wait_port() { # name port
  for _ in $(seq 1 120); do
    (echo > "/dev/tcp/127.0.0.1/$2") 2>/dev/null && { echo "  ✓ $1 auf 127.0.0.1:$2"; return 0; }
    sleep 1
  done
  echo "  ✗ $1 antwortet nicht auf :$2 – siehe $LOGS/$1.log"; return 1
}

start() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  if running "$name"; then echo "  = $name läuft schon (pid $(cat "$PIDS/$name.pid"))"; return; fi
  # Der Kindprozess schreibt seine eigene PID (setsid kann forken, $! wäre dann falsch).
  (cd "$dir" && setsid bash -c 'echo $$ > "$0"; exec "$@"' "$PIDS/$name.pid" "$@" >> "$LOGS/$name.log" 2>&1 < /dev/null &)
  wait_port "$name" "$port"
}

echo "OLAF-Werkbank starten"
start mongodb 27017 "$RT" "$RT/bin/mongod" --dbpath "$RT/data/mongo" --bind_ip 127.0.0.1 --port 27017 --quiet
# Master-Key über die Umgebung (MEILI_MASTER_KEY), nicht über die Kommandozeile – sonst steht er in `ps`.
start meilisearch 7700 "$RT/data/meili" "$RT/bin/meilisearch" --http-addr 127.0.0.1:7700 \
  --db-path "$RT/data/meili/data.ms" --env production --no-analytics
start claude-bridge 3090 "$WB/claude-bridge" env BRIDGE_PORT=3090 BRIDGE_HOST=127.0.0.1 \
  BRIDGE_STATE_DIR="$RT/bridge" BRIDGE_MOCK="${BRIDGE_MOCK:-0}" \
  BRIDGE_ALLOWED_EMAILS="${BRIDGE_ALLOWED_EMAILS-knut.peters@maxenergy.at}" node src/server.ts
start librechat 3080 "$RT/librechat" env CONFIG_PATH="$WB/librechat/librechat.yaml" node api/server/index.js

echo "Fertig: https://3080--main--dev--knut.ws.konekto.energy (lokal http://127.0.0.1:3080)"
