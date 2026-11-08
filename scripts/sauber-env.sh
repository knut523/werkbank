#!/usr/bin/env bash
# Führt einen Befehl in einer sauberen Umgebung aus (dieselbe Regel wie checkEnv in claude-bridge/src/sauberenv.ts):
#  - ohne WERKBANK_*, BRIDGE_*, LEITSTAND_* (eine Strang-/Live-Sitzung setzt z. B. WERKBANK_FIX_DRYRUN=1 — dann fallen
#    Fix-Tests scheinbar rot aus) und ohne GIT_CONFIG_GLOBAL; bleiben: WERKBANK_TEST_* (Ports/Testeinstellungen der Suiten),
#  - ohne alles, was scripts/secret-env.pattern trifft (GH_TOKEN, ANTHROPIC_API_KEY, MONGODB_URI, *_PASS, ...) und die Namen
#    in scripts/drop-env.names (BW_SESSION, SSH_AUTH_SOCK, ...),
#  - mit Wegwerf-HOME (mktemp, danach per trap gelöscht): Tests sehen weder ~/.claude noch ~/.config noch ~/.ssh.
# Ausnahme: Namen in SAUBER_ENV_KEEP (Leerzeichen-getrennt) bleiben, auch wenn das Muster sie trifft — für Werte, die der
# Aufrufer ausdrücklich gesetzt hat (das Gate: MONGO_URI_WERKBANK = Wegwerf-Mongo). Genutzt von `werkbank.sh test` und abnahme.sh.
#   scripts/sauber-env.sh npm test
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PATTERN=$(grep -vE '^[[:space:]]*(#|$)' "$HERE/secret-env.pattern" | head -1)
[ -n "$PATTERN" ] || { echo "sauber-env: $HERE/secret-env.pattern is empty" >&2; exit 2; }
DROP=" $(grep -vE '^[[:space:]]*(#|$)' "$HERE/drop-env.names" 2>/dev/null | tr '\n' ' ') "
KEEP=" ${SAUBER_ENV_KEEP:-} "

weg=(-u SAUBER_ENV_KEEP -u GIT_CONFIG_GLOBAL)
while IFS= read -r n; do
  [ -z "$n" ] && continue
  case "$KEEP" in *" $n "*) continue ;; esac
  case "$n" in WERKBANK_TEST_*) continue ;; esac
  if [[ $n =~ ^(WERKBANK|BRIDGE|LEITSTAND)_ ]] || [[ $DROP == *" $n "* ]] || printf '%s\n' "$n" | grep -qiE -- "$PATTERN"; then weg+=(-u "$n"); fi
done < <(compgen -e)

HOME_NEU=$(mktemp -d "${TMPDIR:-/tmp}/werkbank-sauber-XXXXXX") || exit 2
KIND=""
aufraeumen() { [ -n "$KIND" ] && kill "$KIND" 2>/dev/null; rm -rf "$HOME_NEU"; }
trap aufraeumen EXIT
trap 'aufraeumen; exit 143' TERM INT HUP
# Git bekommt nur Name/E-Mail (kein Credential-Helfer, kein Systemconfig), damit Tests mit Commits laufen.
gname=$(git config --global --get user.name 2>/dev/null || true); gmail=$(git config --global --get user.email 2>/dev/null || true)
printf '[user]\n\tname = %s\n\temail = %s\n' "${gname:-Werkbank-Agent}" "${gmail:-werkbank-agent@localhost}" > "$HOME_NEU/.gitconfig"

env "${weg[@]}" HOME="$HOME_NEU" XDG_CONFIG_HOME="$HOME_NEU/.config" XDG_CACHE_HOME="$HOME_NEU/.cache" npm_config_cache="$HOME_NEU/.npm" \
  GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 "$@" &
KIND=$!
wait "$KIND"; rc=$?
KIND=""
exit $rc
