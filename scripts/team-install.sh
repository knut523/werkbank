#!/usr/bin/env bash
# Eine Workspace-Instanz für eine Person aus dem Team (Zielbild § 4a, F6, Knut 19.10.: „jedes Teammitglied bekommt einen eigenen
# Zugang/eine eigene Instanz, alles individuell“). Läuft in der EIGENEN Coder-Umgebung der Person (eigene 16 GB), aus einem Checkout
# des Werkbank-Repos. Idempotent — darf beliebig oft laufen; Updates danach wie überall mit `scripts/werkbank.sh update`.
#
#   scripts/team-install.sh <email> [--vault <git-url>] [--trocken]
#   scripts/team-install.sh pruefen <email>        # nach der ersten Anmeldung: ist die Person Admin ihrer Instanz?
#
# Was es tut:
#   1. scripts/setup.sh — Werkzeuge, LibreChat, frische Geheimnisse (nie aus einer fremden .env.local), URLs der Coder-Umgebung.
#   2. Verwalteter Block „werkbank-team“ in .env.local: Instanz-Profil team (Chief of Staff aus), nur diese Person freigeschaltet,
#      Vault nur lesen (Schreiben läuft über den Vault-Sync bei Knut), keine Vault-Sync-/Roadmap-Takte dieser Instanz.
#   3. Vault: ist /vault nicht eingehängt und --vault angegeben, ein eigener Klon zum Lesen (git pull bei jedem Lauf).
#   4. Start (scripts/werkbank.sh up) und die Checkliste für die Person: im Chat registrieren (das erste Konto wird Admin
#      ihrer Instanz), dann Einrichtung › Claude verbinden, Jira verbinden, Melious (optional).
# Geheimnisse werden nie ausgegeben. Eigene Claude-/Melious-Zugänge verbindet die Person selbst in der Einrichtung.
set -euo pipefail
WB="${WB_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
UMG="$WB/.env.local"
say() { printf '→ %s\n' "$*"; }

if [ "${1:-}" = pruefen ]; then
  EMAIL="${2:?E-Mail angeben}"
  (cd "$WB/web" && node -e '
    const { MongoClient } = require("mongodb");
    (async () => {
      const m = await MongoClient.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
      const u = await m.db("LibreChat").collection("users").findOne({ email: process.argv[1].toLowerCase() }, { projection: { role: 1 } });
      await m.close();
      if (!u) { console.log("✗ Noch kein Konto für " + process.argv[1] + " — erst im Chat registrieren."); process.exit(1); }
      console.log(u.role === "ADMIN" ? "✓ Admin der eigenen Instanz." : "✗ Konto ist nicht Admin (Rolle " + u.role + ") — war jemand vorher registriert?");
      process.exit(u.role === "ADMIN" ? 0 : 1);
    })().catch((e) => { console.log("✗ Datenbank nicht erreichbar: " + e.message); process.exit(2); });
  ' "$EMAIL")
  exit $?
fi

EMAIL="${1:-}"; shift || true
[[ "$EMAIL" =~ ^[^@[:space:]]+@(maxenergy\.at|konekto\.energy)$ ]] || { echo "✗ Aufruf: scripts/team-install.sh <name@maxenergy.at|name@konekto.energy> [--vault <git-url>] [--trocken]"; exit 1; }
VAULT_URL=""; TROCKEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vault) VAULT_URL="${2:?git-URL fehlt}"; shift 2 ;;
    --trocken) TROCKEN=1; shift ;;
    *) echo "✗ Unbekannt: $1"; exit 1 ;;
  esac
done

# Vault: eingehängt (/vault) oder eigener Klon zum Lesen
VAULT_DIR=/vault
if [ ! -d /vault/_meta ]; then
  VAULT_DIR="$HOME/vault-lesen"
  if [ -d "$VAULT_DIR/.git" ]; then [ $TROCKEN = 1 ] || git -C "$VAULT_DIR" pull -q --ff-only || echo "  ! Vault-Klon nicht aktualisiert (offline?)"
  elif [ -n "$VAULT_URL" ]; then say "Vault zum Lesen klonen nach $VAULT_DIR"; [ $TROCKEN = 1 ] || git clone -q "$VAULT_URL" "$VAULT_DIR"
  else echo "  ! Kein Vault: /vault ist nicht eingehängt und --vault fehlt — Wissen und Skills bleiben leer, bis einer da ist."; fi
fi

# Der verwaltete Block (wird bei jedem Lauf neu geschrieben; alles andere in .env.local bleibt unberührt)
block() {
  cat <<EOT
# >>> werkbank-team (von scripts/team-install.sh verwaltet — Zielbild § 4a)
WERKBANK_INSTANZ=team
BRIDGE_ALLOWED_EMAILS=$EMAIL
WERKBANK_ALLOWED_EMAILS=$EMAIL
BRIDGE_AUTO_EMAILS=$EMAIL
WERKBANK_VAULT_DIR=$VAULT_DIR
BRIDGE_VAULT_DIR=$VAULT_DIR
WERKBANK_SKILLS_SOURCE=$VAULT_DIR/_meta/dist-skill
WERKBANK_VAULT_DRYRUN=1
WERKBANK_ROADMAP_AUTOSYNC=0
WERKBANK_VAULT_SYNC_SCRIPT=/bin/false
# <<< werkbank-team
EOT
}
if [ $TROCKEN = 1 ]; then say "Trockenlauf — dieser Block käme nach .env.local:"; block; exit 0; fi

say "Einrichtung (scripts/setup.sh)"
WERKBANK_SKILLS_SOURCE="$VAULT_DIR/_meta/dist-skill" "$WB/scripts/setup.sh"

umask 077
tmp="$(mktemp)"
awk '/^# >>> werkbank-team/{skip=1} !skip{print} /^# <<< werkbank-team/{skip=0}' "$UMG" > "$tmp"
block >> "$tmp"
cat "$tmp" > "$UMG"; rm -f "$tmp"; chmod 600 "$UMG"
say "Instanz-Profil team gesetzt, freigeschaltet: $EMAIL"

say "Starten (scripts/werkbank.sh up)"
"$WB/scripts/werkbank.sh" up

source "$WB/scripts/env.sh"
cat <<EOT

✓ Instanz steht. Jetzt du ($EMAIL):
  1. Chat öffnen: $(coder_url 3080) — mit $EMAIL registrieren. Das erste Konto wird Admin deiner Instanz.
     Danach prüfen: scripts/team-install.sh pruefen $EMAIL
  2. Kontomenü (unten links) › Workspace-Einrichtung: Claude verbinden (Pflicht), Jira verbinden, Melious (optional).
  3. Im Workspace links „Lead“: schreib ihm, woran du arbeitest.
Updates: scripts/werkbank.sh update (dasselbe Release wie bei allen).
EOT
