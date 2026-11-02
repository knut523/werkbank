#!/usr/bin/env bash
# Führt einen Befehl ohne die Live-Schalter der laufenden Sitzung aus: entfernt WERKBANK_*, BRIDGE_*, LEITSTAND_* und
# GIT_CONFIG_GLOBAL (eine Strang-/Live-Sitzung setzt z. B. WERKBANK_FIX_DRYRUN=1 — dann fallen Fix-Tests scheinbar rot aus).
# Bleiben: WERKBANK_TEST_* (Ports/Testeinstellungen der Suiten). Genutzt von `werkbank.sh test`.
#   scripts/sauber-env.sh npm test
set -euo pipefail
weg=()
while IFS= read -r n; do
  case "$n" in WERKBANK_TEST_*) ;; *) weg+=(-u "$n") ;; esac
done < <(compgen -e | grep -E '^(WERKBANK|BRIDGE|LEITSTAND)_' || true)
exec env "${weg[@]}" -u GIT_CONFIG_GLOBAL "$@"
