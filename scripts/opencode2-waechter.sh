#!/usr/bin/env bash
# Pilot opencode 2 als Läufer (Entscheidung Hauptsitzung 06.11., umkehrbar; Test: review-pakete/opencode2-test-0611).
# Die Server startet, überwacht und beendet die Brücke selbst (claude-bridge/src/oc2server.ts): Hauptsitzung 06.11. „kein
# Klartext-Schlüssel in Umgebung/Datei für Stränge“ — der Melious-Schlüssel kommt wie bei jcode aus dem Konto und geht nur an die
# Server-Prozesse, das Server-Passwort entsteht im Speicher der Brücke. Dieses Skript braucht deshalb keinen Schlüssel; es prüft
# die Installation (Bedingung 2: feste Version, nur Melious) und zeigt, wohin die laufenden Server verbinden.
#
#   opencode2-waechter.sh pruefen     Version und Konfiguration prüfen (ändert nichts)
#   opencode2-waechter.sh status      je Port: läuft ein Server der Brücke?
#   opencode2-waechter.sh netz        entfernte Ziele der Server-Prozesse (nach einem Update: nur Melious erlaubt)
set -euo pipefail
R=${OC2_HOME:-$HOME/.local/opencode2}
OC2=${OC2_BIN:-$R/bin/opencode2}
VERSION=${OC2_VERSION:-2.2.5}
PORTS=${OC2_PORTS:-"47811 47812"}
KONFIG=${OC2_KONFIG:-$R/xdg/config/opencode/opencode.jsonc}
RUN=$R/waechter

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
  echo "  · Schlüssel: kommt zur Laufzeit von der Brücke (aus dem Melious-Konto), nicht aus Umgebung oder Datei"
  [ "$ok" = 1 ]
}
# nur glauben, wenn die Prozessnummer wirklich ein opencode-Server dieses Ports ist (sonst zeigte netz einen fremden Prozess)
laeuft() { [ -f "$RUN/$1.pid" ] && tr '\0' ' ' < "/proc/$(cat "$RUN/$1.pid")/cmdline" 2>/dev/null | grep -q "opencode.* serve .*--port $1"; }

case "${1:-status}" in
  pruefen) pruefen ;;
  status) for p in $PORTS; do laeuft "$p" && echo "  ✓ $p läuft (pid $(cat "$RUN/$p.pid"))" || echo "  ✗ $p läuft nicht (startet die Brücke beim ersten Bedarf)"; done ;;
  netz)   # Bedingung 2: nach jedem Update — entfernte Ziele aller Server-Prozesse (erlaubt: nur api.melious.ai)
    for p in $PORTS; do laeuft "$p" || continue; pid=$(cat "$RUN/$p.pid")
      ss -tnpH 2>/dev/null | grep "pid=$pid," | awk '{print $5}' | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | sort -u | sed "s/^/  $p → /" || true
    done
    ss -tnpH 2>/dev/null | grep -q 'pid=' || echo "  ! ss liefert keine Prozesse (Rechte?) — leere Liste heißt dann nichts"
    echo "  (erwartet: nur die Adresse von api.melious.ai, z. B. 162.19.136.184:443)" ;;
  *) sed -n 2,10p "$0"; exit 1 ;;
esac
