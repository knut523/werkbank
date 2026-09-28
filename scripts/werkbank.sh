#!/usr/bin/env bash
# OLAF-Werkbank — ein Einstieg für alles. Jeder Befehl darf beliebig oft laufen.
#
#   scripts/werkbank.sh up        einrichten (falls nötig), starten, prüfen, nächste Schritte zeigen
#   scripts/werkbank.sh down      alles stoppen
#   scripts/werkbank.sh restart   stoppen und wieder hochfahren
#   scripts/werkbank.sh status    läuft alles?
#   scripts/werkbank.sh update    Abhängigkeiten/Build auffrischen, Skills abgleichen, neu starten
#   scripts/werkbank.sh doctor    ausführliche Prüfung mit Hinweisen (ändert nichts)
#   scripts/werkbank.sh skills [--apply]   Vault-Skills: Bericht bzw. fehlende verlinken
#   scripts/werkbank.sh test      Tests der Brücke und der Web-App
#   scripts/werkbank.sh e2e       Playwright-Durchlauf durch alle Seiten (Demo-Daten, eigene Instanz)
#   scripts/werkbank.sh bridge-mock on|off   Brücke im Mock-Modus (kein Claude-Aufruf) bzw. wieder echt
#   scripts/werkbank.sh restart-web   nur die Web-App neu starten
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/env.sh"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
FAIL=0

load_env() { set -a; source "$WB/librechat/.env"; [ -f "$WB/.env.local" ] && source "$WB/.env.local"; set +a; }

health() {
  FAIL=0
  echo "Prüfung"
  for name in $SERVICES; do
    f="$PIDS/$name.pid"
    if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then ok "$name läuft (pid $(cat "$f"))"; else bad "$name läuft nicht — Log: $LOGS/$name.log"; fi
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/health); [ "$code" = 200 ] && ok "LibreChat antwortet" || bad "LibreChat /health → $code"
  curl -sf http://127.0.0.1:3090/health >/dev/null && ok "Brücke antwortet ($(curl -s http://127.0.0.1:3090/health))" || bad "Brücke antwortet nicht"
  h=$(curl -sf http://127.0.0.1:3070/api/health) && ok "Werkbank-Web antwortet: $h" || bad "Werkbank-Web antwortet nicht"
  return $FAIL
}

next_steps() {
  load_env
  cat <<EOT

Nächste Schritte
  1. Werkbank öffnen:  ${WERKBANK_PUBLIC_URL:-http://127.0.0.1:3070}
     Chat (LibreChat): ${LIBRECHAT_PUBLIC_URL:-http://127.0.0.1:3080}
  2. Konto anlegen (im Chat „Registrieren“, nur @maxenergy.at / @konekto.energy), in der Werkbank anmelden.
  3. „Einrichtung“: eigenes Claude verbinden (Terminal: claude setup-token → Token einfügen),
     eigenes Jira verbinden (Atlassian-API-Token).
  4. Freigabe im Pilot: nur ${WERKBANK_ALLOWED_EMAILS:-${BRIDGE_ALLOWED_EMAILS:-knut.peters@maxenergy.at}}
     (weitere: BRIDGE_ALLOWED_EMAILS=a@…,b@… scripts/werkbank.sh restart).
EOT
}

doctor() {
  FAIL=0
  load_env
  echo "Werkzeuge"
  v=$(node -v 2>/dev/null); [ "${v#v}" != "$v" ] && [ "$(echo "${v#v}" | cut -d. -f1)" -ge 22 ] && ok "Node $v" || bad "Node >= 22 fehlt (werkbank.sh up installiert es)"
  for t in curl git openssl jq; do command -v $t >/dev/null && ok "$t" || bad "$t fehlt"; done
  command -v claude >/dev/null && ok "Claude-CLI ($(claude --version 2>/dev/null | head -1))" || warn "Claude-CLI fehlt — für 'claude setup-token' auf dem eigenen Rechner reicht sie dort"
  command -v bw >/dev/null && ok "Bitwarden-CLI (für den Jira-Pilotzugang)" || warn "bw fehlt — Pilot-Jira nur mit eigenem Token"
  [ -x "$RT/bin/mongod" ] && ok "MongoDB-Binärdatei" || bad "MongoDB fehlt"
  [ -x "$RT/bin/meilisearch" ] && ok "Meilisearch-Binärdatei" || bad "Meilisearch fehlt"
  [ -d "$RT/librechat/client/dist" ] && ok "LibreChat gebaut ($(git -C "$RT/librechat" tag --points-at HEAD | grep '^v' | head -1))" || bad "LibreChat nicht gebaut"
  [ -f "$WB/web/dist/index.html" ] && ok "Web-App gebaut" || bad "Web-App nicht gebaut"
  echo "Geheimnisse (.env.local, nur Namen)"
  if [ -f "$WB/.env.local" ]; then
    perm=$(stat -c %a "$WB/.env.local"); [ "$perm" = 600 ] && ok ".env.local (600)" || warn ".env.local hat Rechte $perm (erwartet 600)"
    for k in CREDS_KEY CREDS_IV JWT_SECRET JWT_REFRESH_SECRET MEILI_MASTER_KEY WERKBANK_CREDS_KEY WERKBANK_INTERNAL_TOKEN; do grep -q "^$k=" "$WB/.env.local" && ok "$k gesetzt" || bad "$k fehlt"; done
    git -C "$WB" check-ignore -q .env.local && ok ".env.local ist gitignored" || bad ".env.local ist NICHT gitignored"
  else bad ".env.local fehlt"; fi
  echo "URLs"
  [ "${DOMAIN_CLIENT:-}" = "$(coder_url 3080)" ] && ok "Chat-URL passt zur Workspace: $DOMAIN_CLIENT" || warn "Chat-URL $DOMAIN_CLIENT ≠ $(coder_url 3080) — werkbank.sh up schreibt sie neu"
  echo "Vault und Skills"
  [ -r /vault/CLAUDE.md ] && ok "Vault lesbar (/vault)" || bad "Vault /vault nicht lesbar"
  node "$WB/web/server/skills-cli.ts" 2>/dev/null | sed 's/^/  /'
  [ -f "$HOME/.config/vw/session" ] && ok "Vaultwarden-Sitzung da (Jira-Pilotzugang)" || warn "keine Vaultwarden-Sitzung (~/.config/vw/session) — Jira-Sync nur mit eigenem Token"
  health
  echo "Logs (Fehlerzeilen der letzten 200 Zeilen)"
  for name in $SERVICES; do
    n=$(tail -200 "$LOGS/$name.log" 2>/dev/null | grep -ci 'error' || true); [ "${n:-0}" -eq 0 ] && ok "$name: keine" || warn "$name: $n Zeilen mit 'error' — $LOGS/$name.log"
  done
  df -h "$WB" | awk 'NR==2 {print "  · Platz: " $4 " frei"}'
  [ $FAIL -eq 0 ] && echo "Alles in Ordnung." || echo "Es gibt Probleme (✗ oben)."
  return $FAIL
}

case "${1:-}" in
  up)
    echo "OLAF-Werkbank: einrichten und starten"
    "$HERE/setup.sh" || exit 1
    "$HERE/start.sh" || exit 1
    (load_env; cd "$WB/web" && node server/reindex-cli.ts)
    health; rc=$?
    next_steps
    exit $rc ;;
  down) "$HERE/stop.sh" ;;
  restart) "$HERE/stop.sh"; "$HERE/start.sh" && health ;;
  status) "$HERE/status.sh" ;;
  update)
    echo "OLAF-Werkbank: auffrischen"
    rm -f "$WB/web/dist/index.html"   # erzwingt den Neubau der Oberfläche
    "$HERE/setup.sh" || exit 1
    "$HERE/stop.sh"; "$HERE/start.sh" || exit 1
    (load_env; cd "$WB/web" && node server/reindex-cli.ts)
    health ;;
  doctor) doctor ;;
  skills) shift; node "$WB/web/server/skills-cli.ts" "$@" ;;
  test)
    (cd "$WB/claude-bridge" && npm test 2>&1 | grep -E '^# (pass|fail)') && (cd "$WB/web" && npm test 2>&1 | grep -E '^# (pass|fail)') ;;
  e2e) (cd "$WB/web" && node e2e/smoke.mjs) ;;
  restart-web)   # nur die Web-App neu (z. B. mit anderer Freigabeliste: WERKBANK_ALLOWED_EMAILS=… werkbank.sh restart-web)
    f="$PIDS/werkbank-web.pid"
    if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then kill "$(cat "$f")"; for _ in $(seq 1 20); do kill -0 "$(cat "$f")" 2>/dev/null || break; sleep 0.3; done; rm -f "$f"; fi
    for _ in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/3070) 2>/dev/null || break; sleep 0.2; done
    "$HERE/start.sh" | grep -E 'werkbank-web' ;;
  bridge-mock)
    f="$PIDS/claude-bridge.pid"
    if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then kill "$(cat "$f")"; for _ in $(seq 1 20); do kill -0 "$(cat "$f")" 2>/dev/null || break; sleep 0.3; done; rm -f "$f"; fi
    for _ in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/3090) 2>/dev/null || break; sleep 0.2; done   # Port frei?
    if [ "${2:-}" = on ]; then BRIDGE_MOCK=1 "$HERE/start.sh" | grep -E 'claude-bridge'; else BRIDGE_MOCK=0 "$HERE/start.sh" | grep -E 'claude-bridge'; fi
    curl -s http://127.0.0.1:3090/health; echo ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
