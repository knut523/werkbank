#!/usr/bin/env bash
# Startet MongoDB, Meilisearch, claude-bridge, LibreChat und die Werkbank-Web-App im Hintergrund
# (alles auf 127.0.0.1). Überspringt, was schon läuft.
# Logs: .runtime/logs/<dienst>.log · PIDs: .runtime/pids/<dienst>.pid
# BRIDGE_MOCK=1 scripts/start.sh startet die Brücke im Mock-Modus (kein Claude-Aufruf).
# Claude-Konfiguration: je Person (.runtime/claude/<id>); nur die Konten in BRIDGE_CLAUDE_CONFIG_SHARED laufen mit
# der Konfiguration des VM-Nutzers (Pilot: Knut). BRIDGE_CLAUDE_CONFIG_SHARED= (leer) → alle je Person.
# Auto-Modus (Knut, 06.10.2026): für die Konten in BRIDGE_AUTO_EMAILS (Vorgabe: Knut) entscheidet ein Klassifikator über
# Bash/Edits im eigenen Arbeitsordner; Vault/Jira bleiben „ja“, GitHub gesperrt. Not-Aus:
# BRIDGE_PERMISSION_MODE=default scripts/werkbank.sh restart → exakt das bisherige Verhalten.
# Parallel (Release 11.10.2026, gemessen ≈ 420 MB je laufendem Chat, 16 GiB Workspace): 4 Züge je Person; LibreChat
# CONCURRENT_MESSAGE_MAX=5 (librechat/.env) bleibt eins darüber. Wartende Rückfragen enden nach BRIDGE_IDLE_REAP_S (900).
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
  # exec: keine Hülle bleibt hängen, die stdout offen hält.
  (cd "$dir" && exec setsid bash -c 'echo $$ > "$0"; exec "$@"' "$PIDS/$name.pid" "$@" >> "$LOGS/$name.log" 2>&1 < /dev/null) &
  wait_port "$name" "$port"
}

echo "OLAF Workspace starten"
# RAM (Plan 125): ohne Deckel nimmt WiredTiger bis 50 % des cgroup-Limits minus 1 GB (hier ≈ 7,5 GB) und Meilisearch
# beim Indexieren bis 2/3 (≈ 10,7 GiB, gemessen: Spitzen 0,6–2,1 GB je Instanz). Unsere Daten sind klein.
# Leer setzen (WB_MONGO_CACHE_GB= / WB_MEILI_INDEXING_MEMORY=) → Vorgabe der Programme.
MONGO_CACHE=(); [ -n "${WB_MONGO_CACHE_GB-0.25}" ] && MONGO_CACHE=(--wiredTigerCacheSizeGB "${WB_MONGO_CACHE_GB-0.25}")
MEILI_MEM=(); [ -n "${WB_MEILI_INDEXING_MEMORY-256MiB}" ] && MEILI_MEM=(--max-indexing-memory "${WB_MEILI_INDEXING_MEMORY-256MiB}")
start mongodb 27017 "$RT" "$RT/bin/mongod" --dbpath "$RT/data/mongo" --bind_ip 127.0.0.1 --port 27017 --quiet "${MONGO_CACHE[@]}"
# Master-Key über die Umgebung (MEILI_MASTER_KEY), nicht über die Kommandozeile – sonst steht er in `ps`.
start meilisearch 7700 "$RT/data/meili" "$RT/bin/meilisearch" --http-addr 127.0.0.1:7700 \
  --db-path "$RT/data/meili/data.ms" --env production --no-analytics "${MEILI_MEM[@]}"
start claude-bridge 3090 "$WB/claude-bridge" env BRIDGE_PORT=3090 BRIDGE_HOST=127.0.0.1 \
  BRIDGE_STATE_DIR="$RT/bridge" BRIDGE_MOCK="${BRIDGE_MOCK:-0}" \
  BRIDGE_ALLOWED_EMAILS="${BRIDGE_ALLOWED_EMAILS-knut.peters@maxenergy.at}" \
  BRIDGE_CLAUDE_CONFIG_SHARED="${BRIDGE_CLAUDE_CONFIG_SHARED-knut.peters@maxenergy.at}" \
  BRIDGE_PERMISSION_MODE="${BRIDGE_PERMISSION_MODE-auto}" \
  BRIDGE_AUTO_SCOPE="${BRIDGE_AUTO_SCOPE-voll}" \
  BRIDGE_AUTO_EMAILS="${BRIDGE_AUTO_EMAILS-knut.peters@maxenergy.at}" \
  BRIDGE_MAX_PARALLEL_CHATS="${BRIDGE_MAX_PARALLEL_CHATS-4}" node src/server.ts
start librechat 3080 "$RT/librechat" env CONFIG_PATH="$WB/librechat/librechat.yaml" node api/server/index.js
# Freigabe wie bei der Brücke: dieselbe Liste, solange die Sitzungen als VM-Nutzer laufen.
start werkbank-web 3070 "$WB/web" env WERKBANK_PORT=3070 WERKBANK_HOST=127.0.0.1 BRIDGE_STATE_DIR="$RT/bridge" \
  WERKBANK_ALLOWED_EMAILS="${WERKBANK_ALLOWED_EMAILS-${BRIDGE_ALLOWED_EMAILS-knut.peters@maxenergy.at}}" node server/main.ts

echo "Fertig: OLAF Workspace ${LIBRECHAT_PUBLIC_URL:-http://127.0.0.1:3080}/wb/heute (Chat und Seiten) · Web-App direkt (Health/Debug) ${WERKBANK_PUBLIC_URL:-http://127.0.0.1:3070}"
