# Gemeinsame Pfade für alle Skripte (wird per `source` geladen).
WB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RT="$WB/.runtime"
LOGS="$RT/logs"
PIDS="$RT/pids"
LIBRECHAT_TAG="v0.8.7"
MONGO_VERSION="8.0.20"
MEILI_VERSION="v1.35.1"
NODE_VERSION="v22.23.1"   # wird nur installiert, wenn kein Node >= 22 da ist
SERVICES="mongodb meilisearch claude-bridge librechat werkbank-web"
mkdir -p "$LOGS" "$PIDS" "$RT/bin" "$RT/data/mongo" "$RT/data/meili"
# Eigenes Node (falls installiert) hat Vorrang.
[ -x "$RT/node/bin/node" ] && export PATH="$RT/node/bin:$PATH"

# Öffentliche URLs aus der Coder-Umgebung: https://<port>--<agent>--<workspace>--<owner>.ws.konekto.energy
coder_url() { # port
  if [ -n "${CODER_WORKSPACE_NAME:-}" ] && [ -n "${CODER_WORKSPACE_OWNER_NAME:-}" ]; then
    echo "https://$1--${CODER_WORKSPACE_AGENT_NAME:-main}--${CODER_WORKSPACE_NAME}--${CODER_WORKSPACE_OWNER_NAME}.${WERKBANK_PREVIEW_DOMAIN:-ws.konekto.energy}"
  else
    echo "http://127.0.0.1:$1"
  fi
}
