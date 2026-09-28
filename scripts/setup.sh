#!/usr/bin/env bash
# Einmalige Einrichtung: Binärdateien, LibreChat bauen, Geheimnisse erzeugen, Brücke installieren.
# Schwer (npm ci + Frontend-Build, einige Minuten) — nicht parallel zu anderen Builds laufen lassen.
set -euo pipefail
source "$(dirname "$0")/env.sh"

if [ ! -x "$RT/bin/mongod" ]; then
  echo "→ MongoDB $MONGO_VERSION"
  curl -sfL "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION.tgz" | tar xz -C "$RT"
  mv "$RT/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION/bin/mongod" "$RT/bin/"
  rm -rf "$RT/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION"
fi
if [ ! -x "$RT/bin/meilisearch" ]; then
  echo "→ Meilisearch $MEILI_VERSION"
  curl -sfL -o "$RT/bin/meilisearch" "https://github.com/meilisearch/meilisearch/releases/download/$MEILI_VERSION/meilisearch-linux-amd64"
  chmod +x "$RT/bin/meilisearch"
fi

if [ ! -d "$RT/librechat" ]; then
  echo "→ LibreChat $LIBRECHAT_TAG klonen"
  git clone --depth 1 --branch "$LIBRECHAT_TAG" https://github.com/danny-avila/LibreChat.git "$RT/librechat"
fi
if [ ! -d "$RT/librechat/client/dist" ]; then
  echo "→ LibreChat bauen (Log: $LOGS/librechat-build.log)"
  (cd "$RT/librechat" && npm ci && npm run frontend) > "$LOGS/librechat-build.log" 2>&1
fi

if [ ! -f "$WB/.env.local" ]; then
  echo "→ Geheimnisse erzeugen: .env.local"
  umask 077
  cat > "$WB/.env.local" <<EOT
# Erzeugt von scripts/setup.sh – nie committen, nie ausgeben.
CREDS_KEY=$(openssl rand -hex 32)
CREDS_IV=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
MEILI_MASTER_KEY=$(openssl rand -hex 24)
EOT
fi

echo "→ claude-bridge installieren"
(cd "$WB/claude-bridge" && npm ci --no-fund --no-audit)
echo "Fertig. Starten mit scripts/start.sh"
