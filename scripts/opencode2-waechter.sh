#!/usr/bin/env bash
# Pilot opencode 2 als Läufer (Entscheidung Hauptsitzung 06.11., umkehrbar; Test: review-pakete/opencode2-test-0611).
# Wächter für mehrere lokale opencode-2-Server. Bedingungen der Entscheidung:
#   (1) ein abgestürzter Server wird neu gestartet — offene Sitzungen stößt danach die Brücke neu an (laeufer.ts, OC2_WEITER);
#   (2) feste Version (Vorgabe 2.2.5, Installation ~/.local/opencode2) — eine andere Version startet nicht; nach jedem Update
#       `netz` laufen lassen (nur api.melious.ai darf als Ziel auftauchen);
#   (3) nicht alle Stränge an einem Server — Vorgabe zwei Server (47811, 47812), die Brücke verteilt (BRIDGE_OPENCODE2_URLS).
# Der Melious-Schlüssel kommt nur aus der Umgebung (MELIOUS_API_KEY) und wird nie ausgegeben; das Server-Passwort steht in einer
# Datei mit Rechten 600 (dieselbe Datei bekommt die Brücke als BRIDGE_OPENCODE2_PW_DATEI).
#
#   opencode2-waechter.sh pruefen     Version und Konfiguration prüfen (ändert nichts)
#   opencode2-waechter.sh start       Server starten (nur, wenn pruefen grün ist)
#   opencode2-waechter.sh wache       Dauerschleife: alle OC2_TAKT_S Sekunden prüfen, abgestürzte Server neu starten
#   opencode2-waechter.sh stop        Server beenden
#   opencode2-waechter.sh status      je Server: läuft / antwortet
#   opencode2-waechter.sh netz        entfernte Ziele der Server-Prozesse (nach einem Update: nur Melious erlaubt)
set -euo pipefail
R=${OC2_HOME:-$HOME/.local/opencode2}
OC2=${OC2_BIN:-$R/bin/opencode2}
VERSION=${OC2_VERSION:-2.2.5}
PORTS=${OC2_PORTS:-"47811 47812"}
PWDATEI=${OC2_PW_DATEI:-$R/server.pw}
KONFIG=${OC2_KONFIG:-$R/xdg/config/opencode/opencode.jsonc}
RUN=$R/waechter
TAKT=${OC2_TAKT_S:-10}
mkdir -p "$RUN"

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$RUN/waechter.log"; }
umgebung() {   # wie oc2-wrapper.sh aus dem Test: eigene XDG-Pfade, nichts nach außen außer Melious
  export XDG_CONFIG_HOME=$R/xdg/config XDG_DATA_HOME=$R/xdg/data XDG_STATE_HOME=$R/xdg/state XDG_CACHE_HOME=$R/xdg/cache
  export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_SHARE=1 OPENCODE_DISABLE_MODELS_FETCH=1 DO_NOT_TRACK=1 OPENCODE_DISABLE_FREE_MODELS=1 OPENCODE_DISABLE_CLAUDE_CODE=1
}
version() { "$OC2" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }
pruefen() {
  local ok=1 v
  [ -x "$OC2" ] || { echo "  ✗ $OC2 fehlt"; return 1; }
  v=$(version); [ "$v" = "$VERSION" ] && echo "  ✓ Version $v" || { echo "  ✗ Version „$v“, erwartet $VERSION (Bedingung 2: feste Version)"; ok=0; }
  if [ -f "$KONFIG" ]; then
    grep -q '"melious"' "$KONFIG" && echo "  ✓ Provider melious in der Konfiguration" || { echo "  ✗ kein Provider melious in $KONFIG"; ok=0; }
    grep -Eq '"update"[[:space:]]*:[[:space:]]*"disable"' "$KONFIG" && echo '  ✓ update: "disable"' || { echo '  ✗ update ist nicht "disable" (Updates nur von Hand, danach netz)'; ok=0; }
    grep -Eq '"share"[[:space:]]*:[[:space:]]*"disabled"' "$KONFIG" && echo '  ✓ share: "disabled"' || { echo '  ✗ share ist nicht "disabled"'; ok=0; }
  else echo "  ✗ Konfiguration $KONFIG fehlt"; ok=0; fi
  [ -f "$PWDATEI" ] && [ "$(stat -c %a "$PWDATEI")" = 600 ] && echo "  ✓ Passwortdatei (600)" || { echo "  ✗ Passwortdatei $PWDATEI fehlt oder nicht 600"; ok=0; }
  [ -n "${MELIOUS_API_KEY:-}" ] && echo "  ✓ MELIOUS_API_KEY gesetzt (Wert nicht gezeigt)" || { echo "  ✗ MELIOUS_API_KEY nicht gesetzt"; ok=0; }
  [ "$ok" = 1 ]
}
# Passwort über die Konfiguration auf stdin, nie als Argument (sonst stünde es in der Prozessliste — Gegenprüfung 06.11.).
antwortet() { [ "$(printf 'user = "opencode:%s"\n' "$(cat "$PWDATEI")" | curl -s -m 5 -o /dev/null -w '%{http_code}' -K - "http://127.0.0.1:$1/api/session?limit=1" || true)" = 200 ]; }
sperre() { exec 9> "$RUN/lock"; flock -w "${1:-30}" 9 || { echo "ABBRUCH: ein anderer Wächter oder Start läuft gerade ($RUN/lock)"; exit 3; }; }
laeuft() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
start_one() {
  local p=$1
  umgebung
  OPENCODE_SERVER_PASSWORD="$(cat "$PWDATEI")" setsid "$OC2" serve --hostname 127.0.0.1 --port "$p" < /dev/null >> "$RUN/$p.log" 2>&1 9>&- &   # 9>&-: Server erben die Sperre nicht
  echo $! > "$RUN/$p.pid"
  for _ in $(seq 1 30); do antwortet "$p" && { log "server $p gestartet (pid $(cat "$RUN/$p.pid"))"; return 0; }; sleep 1; done
  log "server $p antwortet nach dem Start nicht"; return 1
}
stop_one() { local p=$1; laeuft "$p" && { kill "$(cat "$RUN/$p.pid")" 2>/dev/null || true; sleep 1; kill -9 "$(cat "$RUN/$p.pid")" 2>/dev/null || true; }; rm -f "$RUN/$p.pid"; }

case "${1:-status}" in
  pruefen) pruefen ;;
  start)
    pruefen > /dev/null || { pruefen || true; echo "ABBRUCH: erst pruefen grün machen"; exit 1; }
    sperre 30; fehl=0
    for p in $PORTS; do laeuft "$p" && antwortet "$p" && echo "  = $p läuft" || { stop_one "$p"; start_one "$p" && echo "  ✓ $p" || { echo "  ✗ $p"; fehl=1; }; }; done
    exit "$fehl" ;;
  wache)
    pruefen > /dev/null || { pruefen || true; echo "ABBRUCH: erst pruefen grün machen"; exit 1; }
    sperre 0   # höchstens ein Wächter
    log "wächter an ($PORTS, Takt $TAKT s)"
    while :; do
      [ "$(version)" = "$VERSION" ] || { log "version geändert — wächter hält an (Bedingung 2)"; for p in $PORTS; do stop_one "$p"; done; exit 2; }
      for p in $PORTS; do laeuft "$p" && antwortet "$p" || { log "server $p weg — neustart (Bedingung 1)"; stop_one "$p"; start_one "$p" || true; }; done
      sleep "$TAKT"
    done ;;
  stop) for p in $PORTS; do stop_one "$p"; echo "  ■ $p"; done ;;
  status) for p in $PORTS; do laeuft "$p" && { antwortet "$p" && echo "  ✓ $p läuft und antwortet" || echo "  ! $p läuft, antwortet nicht"; } || echo "  ✗ $p läuft nicht"; done ;;
  netz)   # Bedingung 2: nach jedem Update — entfernte Ziele aller Server-Prozesse (erlaubt: nur api.melious.ai)
    for p in $PORTS; do laeuft "$p" || continue; pid=$(cat "$RUN/$p.pid")
      ss -tnpH 2>/dev/null | grep "pid=$pid," | awk '{print $5}' | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | sort -u | sed "s/^/  $p → /" || true
    done
    ss -tnpH 2>/dev/null | grep -q 'pid=' || echo "  ! ss liefert keine Prozesse (Rechte?) — leere Liste heißt dann nichts"
    echo "  (erwartet: nur die Adresse von api.melious.ai, z. B. 162.19.136.184:443)" ;;
  *) sed -n 2,19p "$0"; exit 1 ;;
esac
