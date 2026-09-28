#!/usr/bin/env bash
# Einrichtung — idempotent, darf beliebig oft laufen (werkbank.sh up ruft es auf):
# Werkzeuge prüfen, Node/MongoDB/Meilisearch bereitstellen, LibreChat klonen+bauen, Geheimnisse und
# URLs in .env.local, Brücke und Web-App installieren/bauen, Skills aus dem Vault verlinken.
# Schwer beim ersten Mal (npm ci + Frontend-Build, einige Minuten) — nicht parallel zu anderen Builds.
set -euo pipefail
source "$(dirname "$0")/env.sh"
say() { printf '→ %s\n' "$*"; }

# 1) Werkzeuge
missing=()
for t in curl tar git openssl jq awk; do command -v "$t" >/dev/null || missing+=("$t"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ Es fehlen: ${missing[*]} — bitte installieren (z. B. sudo apt-get install -y ${missing[*]})"; exit 1
fi

# 2) Node >= 22 (sonst eigenes unter .runtime/node)
node_major() { node -v 2>/dev/null | sed 's/^v//; s/\..*//'; }
if [ "$(node_major || echo 0)" -lt 22 ] 2>/dev/null || ! command -v node >/dev/null; then
  say "Node $NODE_VERSION installieren (.runtime/node)"
  curl -sfL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" | tar xJ -C "$RT"
  rm -rf "$RT/node"; mv "$RT/node-$NODE_VERSION-linux-x64" "$RT/node"
  export PATH="$RT/node/bin:$PATH"
fi

# 3) Binärdateien
if [ ! -x "$RT/bin/mongod" ]; then
  say "MongoDB $MONGO_VERSION"
  curl -sfL "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION.tgz" | tar xz -C "$RT"
  mv "$RT/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION/bin/mongod" "$RT/bin/"
  rm -rf "$RT/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION"
fi
if [ ! -x "$RT/bin/meilisearch" ]; then
  say "Meilisearch $MEILI_VERSION"
  curl -sfL -o "$RT/bin/meilisearch" "https://github.com/meilisearch/meilisearch/releases/download/$MEILI_VERSION/meilisearch-linux-amd64"
  chmod +x "$RT/bin/meilisearch"
fi

# 4) LibreChat (Tag aus env.sh; bei anderem Tag neu holen und bauen)
if [ -d "$RT/librechat" ] && ! git -C "$RT/librechat" tag --points-at HEAD | grep -qx "$LIBRECHAT_TAG"; then
  say "LibreChat auf $LIBRECHAT_TAG umstellen"
  git -C "$RT/librechat" fetch --depth 1 origin tag "$LIBRECHAT_TAG" -q
  git -C "$RT/librechat" checkout -q "$LIBRECHAT_TAG"
  rm -rf "$RT/librechat/client/dist"
fi
if [ ! -d "$RT/librechat" ]; then
  say "LibreChat $LIBRECHAT_TAG klonen"
  git clone -q --depth 1 --branch "$LIBRECHAT_TAG" https://github.com/danny-avila/LibreChat.git "$RT/librechat"
fi
# Werkbank-Anpassungen (Leiste, /werkbank-Proxy) vor dem Bau einspielen, siehe librechat-patch.sh
"$(dirname "$0")/librechat-patch.sh" --no-build
if [ ! -d "$RT/librechat/client/dist" ]; then
  say "LibreChat bauen (einige Minuten, Log: $LOGS/librechat-build.log)"
  (cd "$RT/librechat" && npm ci && npm run frontend) > "$LOGS/librechat-build.log" 2>&1
  "$(dirname "$0")/librechat-patch.sh" --stamp-only
else
  "$(dirname "$0")/librechat-patch.sh"
fi

# 5) Geheimnisse: fehlende Einträge ergänzen, vorhandene nie ändern oder ausgeben
umask 077
[ -f "$WB/.env.local" ] || printf '# Erzeugt von scripts/setup.sh – nie committen, nie ausgeben.\n' > "$WB/.env.local"
ensure() { # NAME BYTES
  grep -q "^$1=" "$WB/.env.local" || { echo "$1=$(openssl rand -hex "$2")" >> "$WB/.env.local"; say "Geheimnis $1 erzeugt"; }
}
ensure CREDS_KEY 32; ensure CREDS_IV 16; ensure JWT_SECRET 32; ensure JWT_REFRESH_SECRET 32
ensure MEILI_MASTER_KEY 24; ensure WERKBANK_CREDS_KEY 32; ensure WERKBANK_INTERNAL_TOKEN 32
chmod 600 "$WB/.env.local"

# 6) URLs dieser Workspace (verwalteter Block, wird bei jedem Lauf neu geschrieben)
LC_URL="$(coder_url 3080)"; WEB_URL="$(coder_url 3070)"
tmp="$(mktemp)"
awk '/^# >>> werkbank-urls/{skip=1} !skip{print} /^# <<< werkbank-urls/{skip=0}' "$WB/.env.local" > "$tmp"
cat >> "$tmp" <<EOT
# >>> werkbank-urls (von scripts/setup.sh verwaltet)
DOMAIN_CLIENT=$LC_URL
DOMAIN_SERVER=$LC_URL
LIBRECHAT_PUBLIC_URL=$LC_URL
WERKBANK_PUBLIC_URL=$WEB_URL
CUSTOM_FOOTER="OLAF-Werkbank | [🚀 Einrichtung]($WEB_URL/#/) | [📚 Wissen]($WEB_URL/#/wissen) | [🗂️ Board]($WEB_URL/#/board) | [🔁 Sprint]($WEB_URL/#/sprint) | [🧰 Skills]($WEB_URL/#/skills) | [📎 Dateien]($WEB_URL/#/dateien)"
# <<< werkbank-urls
EOT
cat "$tmp" > "$WB/.env.local"; rm -f "$tmp"

# 7) Brücke und Web-App (npm ci nur, wenn nötig; Oberfläche bauen, wenn Quellen neuer sind)
need_ci() { [ ! -d "$1/node_modules" ] || [ "$1/package-lock.json" -nt "$1/node_modules/.package-lock.json" ]; }
if need_ci "$WB/claude-bridge"; then say "claude-bridge installieren"; (cd "$WB/claude-bridge" && npm ci --no-fund --no-audit --loglevel=error); fi
if need_ci "$WB/web"; then say "Web-App installieren"; (cd "$WB/web" && npm ci --no-fund --no-audit --loglevel=error); fi
if [ ! -f "$WB/web/dist/index.html" ] || [ -n "$(find "$WB/web/src" "$WB/web/index.html" -newer "$WB/web/dist/index.html" -print -quit)" ]; then
  say "Web-App bauen"; (cd "$WB/web" && npx vite build --logLevel error)
fi

# 8) Skills aus dem Vault (fehlende verlinken, nichts überschreiben)
if [ -d "${WERKBANK_SKILLS_SOURCE:-/vault/_meta/dist-skill}" ]; then
  node "$WB/web/server/skills-cli.ts" --apply | sed 's/^/  /'
else
  echo "  ! /vault/_meta/dist-skill fehlt — Skills bitte nach dem Einhängen des Vaults: scripts/werkbank.sh skills --apply"
fi

# 9) Hinweise
command -v claude >/dev/null || echo "  ! Claude-CLI fehlt (für 'claude setup-token'): npm i -g @anthropic-ai/claude-code"
echo "✓ Einrichtung fertig."
