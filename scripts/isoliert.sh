#!/usr/bin/env bash
# Zweite, isolierte Werkbank aus DIESEM Checkout — zum Testen neben der Live-Instanz, ohne sie anzufassen.
#
#   scripts/isoliert.sh start | stop | status
#
# Suche (Meilisearch + LibreChat-Suche) nur mit WB_ISO_SUCHE=1 — spart je Instanz bis zu 2 GB beim Indexieren.
# Mehrere Testinstanzen nebeneinander: ISO_PORT_BASE=3570 → Web 3570, LibreChat 3580, Brücke 3590, Mongo 27580,
# Meili 7795; ISO_DIR=<pfad> statt .runtime-iso. ISO_COPY_CLAUDE_ACCOUNTS=1 übernimmt zusätzlich WERKBANK_CREDS_KEY aus der
# Quell-.env.local, damit kopierte weitere Claude-Konten (werkbank.creds) lesbar bleiben (nichts wird ausgegeben).
#
# Ports (Web/LibreChat/Brücke = Live + 100): Mongo 27180 · Meili 7790 · Brücke 3190 · LibreChat 3180 · Web 3170. Alles unter .runtime-iso/
# (eigene Datenbanken, Bridge-Zustand, Logs, PIDs). LibreChat ist eine Hardlink-Kopie der gebauten Installation der
# Quelle (ISO_SOURCE_RT, Vorgabe: .runtime dieses Checkouts, sonst ~/work/werkbank-dev/.runtime) mit eigenen
# Log-/Upload-Ordnern; librechat.yaml wird mit der Brücke auf 3190 kopiert.
# Geheimnisse: frisch erzeugt in .runtime-iso/.env.local; nur CREDS_KEY/CREDS_IV kommen aus der Quell-.env.local
# (ISO_SOURCE_ENV), damit ein kopierter LibreChat-Schlüssel (Claude-Token, verschlüsselt) lesbar bleibt. Nichts wird
# ausgegeben. Jira/Vault-Schreiben der Web-App: Trockenlauf, keine Hintergrund-Jobs, Roadmap-Nachzug aus, eigenes
# Vault-Sync-Verzeichnis (sonst schriebe die Testinstanz ~/.cache/vault-sync/freigaben.md der Live-Instanz).
# stop beendet nur Prozesse aus den eigenen PID-Dateien.
set -euo pipefail
WB="$(cd "$(dirname "$0")/.." && pwd)"
ISO="${ISO_DIR:-$WB/.runtime-iso}"
SRC_RT="${ISO_SOURCE_RT:-$([ -d "$WB/.runtime/librechat" ] && echo "$WB/.runtime" || echo "$HOME/work/werkbank-dev/.runtime")}"
SRC_ENV="${ISO_SOURCE_ENV:-$(dirname "$SRC_RT")/.env.local}"
# Eigene .runtime ohne .env.local (z. B. kopierte LibreChat-Installation): Schlüssel aus der Live-Instanz.
[ -f "$SRC_ENV" ] || SRC_ENV="$HOME/work/werkbank-dev/.env.local"
LOGS="$ISO/logs"; PIDS="$ISO/pids"
if [ -n "${ISO_PORT_BASE:-}" ]; then
  P_WEB=$ISO_PORT_BASE P_LC=$((ISO_PORT_BASE + 10)) P_BRIDGE=$((ISO_PORT_BASE + 20)) P_MONGO=$((ISO_PORT_BASE + 24010)) P_MEILI=$((ISO_PORT_BASE + 4225))
else P_MONGO=27180 P_MEILI=7790 P_BRIDGE=3190 P_LC=3180 P_WEB=3170; fi
mkdir -p "$LOGS" "$PIDS" "$ISO/data/mongo" "$ISO/data/meili" "$ISO/bridge" "$ISO/werkbank" "$ISO/vault-sync"

coder_url() {
  if [ -n "${CODER_WORKSPACE_NAME:-}" ] && [ -n "${CODER_WORKSPACE_OWNER_NAME:-}" ]; then
    echo "https://$1--${CODER_WORKSPACE_AGENT_NAME:-main}--${CODER_WORKSPACE_NAME}--${CODER_WORKSPACE_OWNER_NAME}.${WERKBANK_PREVIEW_DOMAIN:-ws.konekto.energy}"
  else echo "http://127.0.0.1:$1"; fi
}
running() { [ -f "$PIDS/$1.pid" ] && kill -0 "$(cat "$PIDS/$1.pid")" 2>/dev/null; }
wait_port() {
  for _ in $(seq 1 120); do (echo > "/dev/tcp/127.0.0.1/$2") 2>/dev/null && { echo "  ✓ $1 :$2"; return 0; }; sleep 1; done
  echo "  ✗ $1 antwortet nicht auf :$2 – siehe $LOGS/$1.log"; return 1
}
start_one() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  if running "$name"; then echo "  = $name läuft (pid $(cat "$PIDS/$name.pid"))"; return; fi
  if (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "  ✗ Port $port ist belegt (nicht von uns) — Abbruch"; exit 1; fi
  (cd "$dir" && exec setsid bash -c 'echo $$ > "$0"; exec "$@"' "$PIDS/$name.pid" "$@" >> "$LOGS/$name.log" 2>&1 < /dev/null) &
  wait_port "$name" "$port"
}

prepare() {
  [ -x "$SRC_RT/bin/mongod" ] || { echo "Quelle ohne Binärdateien: $SRC_RT"; exit 1; }
  # LibreChat: Hardlink-Kopie (kein Platz, eigener Baum); beschriebene Ordner als echte eigene Ordner.
  if [ ! -d "$ISO/librechat" ]; then
    echo "→ LibreChat als Hardlink-Kopie aus $SRC_RT/librechat"
    cp -al "$SRC_RT/librechat" "$ISO/librechat"
    for d in logs api/logs uploads data client/public/images; do rm -rf "${ISO:?}/librechat/$d"; mkdir -p "$ISO/librechat/$d"; done
    [ -d "$SRC_RT/librechat/client/public/images" ] && cp -r "$SRC_RT/librechat/client/public/images/." "$ISO/librechat/client/public/images/" 2>/dev/null || true
  fi
  sed "s#127.0.0.1:3090/v1#127.0.0.1:$P_BRIDGE/v1#" "$WB/librechat/librechat.yaml" > "$ISO/librechat.yaml"
  # Geheimnisse (fehlende ergänzen, nie ausgeben).
  umask 077
  [ -f "$ISO/.env.local" ] || printf '# isolierte Werkbank – nie committen, nie ausgeben\n' > "$ISO/.env.local"
  ensure() { grep -q "^$1=" "$ISO/.env.local" || echo "$1=$(openssl rand -hex "$2")" >> "$ISO/.env.local"; }
  for k in CREDS_KEY CREDS_IV; do
    grep -q "^$k=" "$ISO/.env.local" || { [ -f "$SRC_ENV" ] && grep "^$k=" "$SRC_ENV" >> "$ISO/.env.local" || true; }
  done
  if [ "${ISO_COPY_CLAUDE_ACCOUNTS:-0}" = 1 ] && [ -f "$SRC_ENV" ] && ! grep -q "^WERKBANK_CREDS_KEY=" "$ISO/.env.local"; then
    grep "^WERKBANK_CREDS_KEY=" "$SRC_ENV" >> "$ISO/.env.local" || true
  fi
  ensure CREDS_KEY 32; ensure CREDS_IV 16; ensure JWT_SECRET 32; ensure JWT_REFRESH_SECRET 32
  ensure MEILI_MASTER_KEY 24; ensure WERKBANK_CREDS_KEY 32; ensure WERKBANK_INTERNAL_TOKEN 32
  chmod 600 "$ISO/.env.local"
  # Abhängigkeiten und Oberfläche dieses Checkouts.
  for p in claude-bridge web; do [ -d "$WB/$p/node_modules" ] || (cd "$WB/$p" && npm ci --no-fund --no-audit --loglevel=error); done
  [ -f "$WB/web/dist/index.html" ] || (cd "$WB/web" && npx vite build --logLevel error)
}

do_start() {
  prepare
  local LC_URL WEB_URL; LC_URL="$(coder_url $P_LC)"; WEB_URL="$(coder_url $P_WEB)"
  set -a; source "$WB/librechat/.env"; source "$ISO/.env.local"; set +a
  export DOMAIN_CLIENT="$LC_URL" DOMAIN_SERVER="$LC_URL" LIBRECHAT_PUBLIC_URL="$LC_URL" WERKBANK_PUBLIC_URL="$WEB_URL"
  export MEILI_HOST="http://127.0.0.1:$P_MEILI" CUSTOM_FOOTER="OLAF Workspace · ISOLIERTE TESTINSTANZ ($WB)"
  [ -x "$SRC_RT/node/bin/node" ] && export PATH="$SRC_RT/node/bin:$PATH"
  echo "Isolierten OLAF Workspace starten ($WB)"
  # RAM (Plan 125): Mongo-Cache und Meili-Indexierung gedeckelt wie in start.sh; ohne WB_ISO_SUCHE=1 keine Suche
  # (LibreChat SEARCH=false, kein Meilisearch-Prozess) — Vault-Suche/Wissen-Suche gehen dann in der Testinstanz nicht.
  MONGO_CACHE=(); [ -n "${WB_MONGO_CACHE_GB-0.25}" ] && MONGO_CACHE=(--wiredTigerCacheSizeGB "${WB_MONGO_CACHE_GB-0.25}")
  MEILI_MEM=(); [ -n "${WB_MEILI_INDEXING_MEMORY-256MiB}" ] && MEILI_MEM=(--max-indexing-memory "${WB_MEILI_INDEXING_MEMORY-256MiB}")
  start_one mongodb $P_MONGO "$ISO" "$SRC_RT/bin/mongod" --dbpath "$ISO/data/mongo" --bind_ip 127.0.0.1 --port $P_MONGO --quiet "${MONGO_CACHE[@]}"
  if [ "${WB_ISO_SUCHE:-0}" = 1 ]; then
    start_one meilisearch $P_MEILI "$ISO/data/meili" "$SRC_RT/bin/meilisearch" --http-addr 127.0.0.1:$P_MEILI \
      --db-path "$ISO/data/meili/data.ms" --env production --no-analytics "${MEILI_MEM[@]}"
  else
    export SEARCH=false; echo "  · Suche aus (WB_ISO_SUCHE=1 schaltet Meilisearch und die LibreChat-Suche ein)"
  fi
  start_one claude-bridge $P_BRIDGE "$WB/claude-bridge" env BRIDGE_PORT=$P_BRIDGE BRIDGE_HOST=127.0.0.1 \
    BRIDGE_STATE_DIR="$ISO/bridge" BRIDGE_MOCK="${BRIDGE_MOCK:-0}" WERKBANK_URL="http://127.0.0.1:$P_WEB" \
    BRIDGE_ALLOWED_EMAILS="${BRIDGE_ALLOWED_EMAILS-knut.peters@maxenergy.at}" \
    BRIDGE_CLAUDE_CONFIG_SHARED="${BRIDGE_CLAUDE_CONFIG_SHARED-knut.peters@maxenergy.at}" \
    BRIDGE_PERMISSION_MODE="${BRIDGE_PERMISSION_MODE-auto}" BRIDGE_AUTO_SCOPE="${BRIDGE_AUTO_SCOPE-voll}" \
    BRIDGE_AUTO_EMAILS="${BRIDGE_AUTO_EMAILS-knut.peters@maxenergy.at}" node src/server.ts
  start_one librechat $P_LC "$ISO/librechat" env CONFIG_PATH="$ISO/librechat.yaml" PORT=$P_LC HOST=127.0.0.1 \
    MONGO_URI="mongodb://127.0.0.1:$P_MONGO/LibreChat" WERKBANK_WEB_PORT=$P_WEB CONCURRENT_MESSAGE_MAX="${CONCURRENT_MESSAGE_MAX:-5}" \
    node api/server/index.js
  start_one werkbank-web $P_WEB "$WB/web" env WERKBANK_PORT=$P_WEB WERKBANK_HOST=127.0.0.1 WERKBANK_RUNTIME_DIR="$ISO" \
    BRIDGE_STATE_DIR="$ISO/bridge" BRIDGE_URL="http://127.0.0.1:$P_BRIDGE" LIBRECHAT_URL="http://127.0.0.1:$P_LC" \
    MONGO_URI_WERKBANK="mongodb://127.0.0.1:$P_MONGO" WERKBANK_DATA_DIR="$ISO/werkbank" WERKBANK_LIBRECHAT_DIR="$ISO/librechat" \
    WERKBANK_NO_JOBS=1 WERKBANK_DRYRUN=1 WERKBANK_ROADMAP_AUTOSYNC=0 WERKBANK_VAULT_SYNC_SCRIPT=/bin/false \
    WERKBANK_VAULT_SYNC_DIR="$ISO/vault-sync" WERKBANK_ROADMAP_FEED="$ISO/vault-sync/werkbank-feed.md" WERKBANK_MEILI_INDEX=werkbank_vault_iso \
    WERKBANK_ALLOWED_EMAILS="${WERKBANK_ALLOWED_EMAILS-${BRIDGE_ALLOWED_EMAILS-knut.peters@maxenergy.at}}" node server/main.ts
  echo "Fertig: Chat $LC_URL · Web $WEB_URL"
  echo "CLI:    WERKBANK_URL=http://127.0.0.1:$P_WEB WERKBANK_ENV_FILE=$ISO/.env.local $WB/scripts/orch list"
}

do_stop() {
  for name in werkbank-web librechat claude-bridge meilisearch mongodb; do
    f="$PIDS/$name.pid"; [ -f "$f" ] || continue
    pid=$(cat "$f")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"; for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid"; echo "  ■ $name gestoppt"
    fi
    rm -f "$f"
  done
}

do_status() {
  for name in mongodb meilisearch claude-bridge librechat werkbank-web; do
    if running "$name"; then echo "  ✓ $name (pid $(cat "$PIDS/$name.pid"))"; else echo "  ✗ $name"; fi
  done
}

case "${1:-status}" in
  start) do_start ;;
  stop) do_stop ;;
  status) do_status ;;
  *) echo "Aufruf: $0 start|stop|status"; exit 1 ;;
esac
