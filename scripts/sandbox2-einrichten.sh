#!/usr/bin/env bash
# Sandbox Stufe 2 (D11, Plan §19): Unter-Chats laufen später als eigener Unix-Nutzer `werkbank-agent`, der Knuts Zugänge per
# Dateirecht nicht lesen kann. Dieses Skript richtet NUR die Regeln aus Plan §19 ein — idempotent, jeder Schritt prüft erst.
#
#   scripts/sandbox2-einrichten.sh                 Trockenlauf (Vorgabe): zeigt, was es tun würde, ändert nichts
#   sudo scripts/sandbox2-einrichten.sh --ausfuehren   führt aus (braucht root)
#   … --arbeit <ordner>                            zusätzlich: Ordner für Arbeitskopien der Unter-Chats der Gruppe geben
#
# Danach als Knut: `cd claude-bridge && node --test test/sandbox2.test.ts` — der Negativtest muss grün sein (nicht „wartet“).
# Rückweg: `sudo rm /etc/sudoers.d/werkbank-agent` (Agent kann nicht mehr gestartet werden); Nutzer/Gruppe dürfen bleiben.
# Die Brücke startet erst über `sudo -u werkbank-agent`, wenn ihr Schalter an ist (Plan §19, Schritt 5) — nicht hier.
set -euo pipefail

AGENT=werkbank-agent
GRUPPE=werkbank-arbeit
KNUT=${SANDBOX2_KNUT:-knut}
KNUT_HOME=$(getent passwd "$KNUT" | cut -d: -f6)
CLAUDE_BIN=${SANDBOX2_CLAUDE_BIN:-/home/$AGENT/bin/claude}
SUDOERS=/etc/sudoers.d/$AGENT
AUSFUEHREN=0
ARBEIT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ausfuehren) AUSFUEHREN=1 ;;
    --arbeit) ARBEIT=${2:?--arbeit braucht einen Ordner}; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unbekannt: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$KNUT_HOME" ] || { echo "Nutzer $KNUT unbekannt" >&2; exit 2; }
if [ "$AUSFUEHREN" = 1 ] && [ "$(id -u)" != 0 ]; then echo "--ausfuehren braucht root (sudo)" >&2; exit 2; fi

tu() {   # tu "Beschreibung" befehl… — im Trockenlauf nur anzeigen
  local was=$1; shift
  if [ "$AUSFUEHREN" = 1 ]; then echo "  ✓ $was"; "$@"; else echo "  → würde: $was   ($*)"; fi
}
ok() { echo "  = $1"; }

echo "Sandbox Stufe 2 — $([ "$AUSFUEHREN" = 1 ] && echo AUSFÜHREN || echo TROCKENLAUF), Knut=$KNUT ($KNUT_HOME)"

echo "1. Nutzer $AGENT"
if id -u "$AGENT" >/dev/null 2>&1; then ok "Nutzer $AGENT gibt es schon"
else tu "Nutzer $AGENT anlegen (ohne Login-Shell)" useradd --create-home --shell /usr/sbin/nologin "$AGENT"; fi

echo "2. Gruppe $GRUPPE für die Arbeitsordner"
if getent group "$GRUPPE" >/dev/null; then ok "Gruppe $GRUPPE gibt es schon"
else tu "Gruppe $GRUPPE anlegen" groupadd "$GRUPPE"; fi
for n in "$KNUT" "$AGENT"; do
  if id -nG "$n" 2>/dev/null | tr ' ' '\n' | grep -qx "$GRUPPE"; then ok "$n ist in $GRUPPE"
  else tu "$n in $GRUPPE aufnehmen" usermod -aG "$GRUPPE" "$n"; fi
done
if [ -n "$ARBEIT" ]; then
  [ -d "$ARBEIT" ] || { echo "Ordner $ARBEIT fehlt" >&2; exit 2; }
  tu "Arbeitsordner $ARBEIT der Gruppe $GRUPPE geben (g+rwX, neue Dateien erben die Gruppe)" \
    sh -c "chgrp -R '$GRUPPE' '$ARBEIT' && chmod -R g+rwX '$ARBEIT' && find '$ARBEIT' -type d -exec chmod g+s {} +"
else
  echo "  (Arbeitsordner nicht angefasst — mit --arbeit <ordner> nachholen, sobald die Brücke als $AGENT startet)"
fi

echo "3. Knuts Home und Zugänge"
# 711 statt 750 (Plan §19, Abweichung begründet): ohne ACL-Werkzeuge braucht der Agent ein reines Durchgangsrecht zu den
# Arbeitsordnern; Auflisten bleibt verboten. Geschützt wird über die Rechte der Zugänge selbst (700/600) — genau das prüft
# der Negativtest.
modus() { stat -c '%a' "$1"; }
if [ "$(modus "$KNUT_HOME")" = 711 ]; then ok "$KNUT_HOME steht auf 711"
else tu "$KNUT_HOME auf 711 (durchgehen ja, auflisten nein; war $(modus "$KNUT_HOME"))" chmod 711 "$KNUT_HOME"; fi
for d in .claude .config/vw .config/gh; do
  p=$KNUT_HOME/$d
  [ -e "$p" ] || { ok "$p gibt es nicht"; continue; }
  if [ "$(modus "$p")" = 700 ]; then ok "$p steht auf 700"; else tu "$p auf 700 (war $(modus "$p"))" chmod 700 "$p"; fi
done
for f in .claude.json .git-credentials .config/git/credentials; do
  p=$KNUT_HOME/$f
  [ -e "$p" ] || { ok "$p gibt es nicht"; continue; }
  if [ "$(modus "$p")" = 600 ]; then ok "$p steht auf 600"; else tu "$p auf 600 (war $(modus "$p"))" chmod 600 "$p"; fi
done

echo "4. sudo-Regeln (nur Start des Agenten und /usr/bin/test für den Negativtest)"
neu=$(mktemp); trap 'rm -f "$neu"' EXIT
cat > "$neu" <<REGELN
# Werkbank Sandbox Stufe 2 (Plan §19) — von scripts/sandbox2-einrichten.sh, nicht von Hand ändern.
# 4: nur der Start des Agenten, keine Shell, keine anderen Befehle
$KNUT ALL=($AGENT) NOPASSWD: /usr/bin/env CLAUDE_CONFIG_DIR=* $CLAUDE_BIN *
# 4b: Negativtest — prüft nur Rechte, liest nichts
$KNUT ALL=($AGENT) NOPASSWD: /usr/bin/test
REGELN
if [ -f "$SUDOERS" ] && cmp -s "$neu" "$SUDOERS"; then ok "$SUDOERS ist aktuell"
else
  if [ "$AUSFUEHREN" = 1 ]; then
    visudo -cf "$neu" >/dev/null || { echo "  ✗ Regeln ungültig — nichts geschrieben" >&2; exit 1; }
    install -m 0440 -o root -g root "$neu" "$SUDOERS"; echo "  ✓ $SUDOERS geschrieben (visudo geprüft)"
  else
    echo "  → würde $SUDOERS schreiben (mit visudo -cf geprüft, 0440):"; sed 's/^/      /' "$neu"
  fi
fi
[ -x "$CLAUDE_BIN" ] || echo "  ! $CLAUDE_BIN gibt es noch nicht — Claude für $AGENT installieren oder SANDBOX2_CLAUDE_BIN setzen"

echo "Fertig. Prüfen als $KNUT: cd claude-bridge && node --test test/sandbox2.test.ts"
