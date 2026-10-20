#!/usr/bin/env bash
# Review-Läufer auf dem Docker-Host (Plan 213 S7b, D4 a „docker-remote“). Wird NUR über einen SSH-Schlüssel mit erzwungenem
# Befehl aufgerufen — kein Shell-Zugang für die Werkbank:
#
#   ~/.ssh/authorized_keys des Läufer-Nutzers (nicht root!):
#   command="/usr/local/bin/wb-review-runner.sh",restrict ssh-ed25519 AAAA… werkbank-review
#
# stdin: tar.gz mit src/ (PR-Stand ohne .git) und spec.json ({ id, befehle[], deckel }). stdout: je Befehl eine JSON-Zeile,
# zuletzt {"ende":true,"gruende":[…]}. Ablauf je Lauf (Namensraum wb-review-<id>, Label wb-review=1):
#   1. Abhängigkeiten installieren (npm ci --ignore-scripts) — einziger Schritt mit Netz.
#   2. Datenbank als Sidecar (mongo:7 / postgres:16) in einem internen Docker-Netz (--internal: kein Weg nach draußen).
#   3. Prüfbefehle im Wegwerf-Container: ohne Netz (bzw. nur das interne Netz zur DB), --cap-drop ALL, no-new-privileges,
#      Nutzer 1000, Speicher/CPU/Prozess-Deckel, Zeitdeckel; das Image hat keine Geheimnisse, gemountet wird nur der Stand.
#   4. Aufräumen garantiert (trap): Container, Netz, Ordner. Vor jedem Lauf: Reste älter als 2 h entfernen.
# Nichts an anderen Containern (Vexa, Coolify) wird berührt — nur Objekte mit Label wb-review=1.
# Voraussetzungen auf dem Host: docker, tar, gzip; die Datei wb-review-runner.mjs neben diesem Skript.
set -euo pipefail
umask 077
ORIG="${SSH_ORIGINAL_COMMAND:-${*:-}}"
[[ "$ORIG" =~ ^run\ ([a-z0-9-]{1,30})$ ]] || { echo '{"ende":true,"gruende":["ungültiger Aufruf"]}'; exit 2; }
ID="${BASH_REMATCH[1]}"
NAME="wb-review-$ID"
HIER="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
IMAGE="${WB_REVIEW_IMAGE:-node:22-bookworm}"
MEM="${WB_REVIEW_MEM:-2g}"; CPUS="${WB_REVIEW_CPUS:-2}"; PIDS="${WB_REVIEW_PIDS:-512}"
D="$(mktemp -d "/tmp/$NAME.XXXX")"
GRUENDE=()

aufraeumen() {
  docker ps -aq --filter "label=wb-review=1" --filter "name=$NAME" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$D"
}
trap aufraeumen EXIT INT TERM

# Reste früherer Läufe (älter als 2 h): nur eigene Objekte.
docker container prune -f --filter "label=wb-review=1" --filter "until=2h" >/dev/null 2>&1 || true
docker network prune -f --filter "label=wb-review=1" --filter "until=2h" >/dev/null 2>&1 || true
find /tmp -maxdepth 1 -name 'wb-review-*' -mmin +120 -exec rm -rf {} + 2>/dev/null || true

tar -xzf - -C "$D"
[ -f "$D/spec.json" ] && [ -d "$D/src" ] || { echo '{"ende":true,"gruende":["Paket unvollständig"]}'; exit 2; }
cp "$HIER/wb-review-runner.mjs" "$D/runner.mjs"
chown -R 1000:1000 "$D/src" 2>/dev/null || true

SICHER=(--label wb-review=1 --cap-drop ALL --security-opt no-new-privileges -u 1000:1000 --memory "$MEM" --cpus "$CPUS" --pids-limit "$PIDS" --tmpfs /tmp:rw,size=512m -e HOME=/tmp -e CI=1 -e NODE_ENV=test -e TZ=Europe/Vienna)

# 1. Abhängigkeiten (mit Netz, ohne Skripte) je Ordner mit package-lock.json.
for ORDNER in $(grep -o '"ordner":"[^"]*"' "$D/spec.json" | cut -d'"' -f4 | sort -u) .; do
  [ -f "$D/src/$ORDNER/package-lock.json" ] || continue
  if ! timeout 900 docker run --rm --name "$NAME-install" "${SICHER[@]}" --network bridge -e npm_config_cache=/tmp/npm \
      -v "$D/src:/src" -w "/src/$ORDNER" "$IMAGE" npm ci --ignore-scripts --no-audit --no-fund >"$D/install.log" 2>&1; then
    GRUENDE+=("npm ci in $ORDNER fehlgeschlagen")
  fi
done

# 2. Datenbank als Sidecar im internen Netz (falls ein Befehl sie braucht).
NETZ=(--network none); DBENV=()
if grep -q '"db":"\(mongo\|postgres\)"' "$D/spec.json"; then
  docker network create --internal --label wb-review=1 "$NAME" >/dev/null
  NETZ=(--network "$NAME")
  if grep -q '"db":"mongo"' "$D/spec.json"; then
    docker run -d --name "$NAME-mongo" --label wb-review=1 --network "$NAME" --memory 1g mongo:7 --quiet >/dev/null && DBENV+=(-e "MONGO_URI=mongodb://$NAME-mongo:27017" -e "MONGO_URI_WERKBANK=mongodb://$NAME-mongo:27017") || GRUENDE+=("Mongo-Sidecar startet nicht")
  fi
  if grep -q '"db":"postgres"' "$D/spec.json"; then
    docker run -d --name "$NAME-pg" --label wb-review=1 --network "$NAME" --memory 1g -e POSTGRES_PASSWORD=review -e POSTGRES_DB=test postgres:16 >/dev/null && DBENV+=(-e "DATABASE_URL=postgres://postgres:review@$NAME-pg:5432/test") || GRUENDE+=("Postgres-Sidecar startet nicht")
  fi
  sleep 5
fi

# 3. Prüfbefehle ohne Netz nach draußen.
GESAMT=$(grep -o '"gesamtS":[0-9]*' "$D/spec.json" | cut -d: -f2); GESAMT=${GESAMT:-1800}
timeout $((GESAMT + 120)) docker run --rm --name "$NAME-lauf" "${SICHER[@]}" "${NETZ[@]}" "${DBENV[@]}" \
  -v "$D/src:/src" -v "$D/spec.json:/spec.json:ro" -v "$D/runner.mjs:/runner.mjs:ro" -w /src "$IMAGE" node /runner.mjs || GRUENDE+=("Lauf-Container endete mit Fehler")

printf '{"ende":true,"gruende":['
SEP=""; for G in "${GRUENDE[@]}"; do printf '%s"%s"' "$SEP" "${G//\"/\'}"; SEP=","; done
printf ']}\n'
