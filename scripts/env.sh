# Gemeinsame Pfade für alle Skripte (wird per `source` geladen).
WB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RT="$WB/.runtime"
LOGS="$RT/logs"
PIDS="$RT/pids"
LIBRECHAT_TAG="v0.8.7"
MONGO_VERSION="8.0.20"
MEILI_VERSION="v1.35.1"
mkdir -p "$LOGS" "$PIDS" "$RT/bin" "$RT/data/mongo" "$RT/data/meili"
