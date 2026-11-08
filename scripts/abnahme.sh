#!/usr/bin/env bash
# Acceptance gate for a build pass: runs BEFORE anyone (model or human) reads the report.
# Council 08.11. (council-wb21-betrieb-0811.md): mechanical checks are a script, not a model.
#
#   scripts/abnahme.sh <base> [<head>=HEAD]      (run inside the worktree that is being checked)
#
# Checks (a–f); exit 0 = GREEN, 1 = RED. Warnings do not change the result.
#   a) at least one commit base..head, diff not empty           (against "done" without a commit)
#   b) every new export has a call site outside the tests       (against "stops at the module")
#   c) affected test files one by one, 120 s cap, duration      (against "green" while a test hangs)
#   d) test files: asserts/test blocks don't shrink, no skip     (tamper guard; imports allowed)
#   e) tsc: no file gains type errors compared to base
#   f) warning: module state (top-level Map/let) without a file write  (persistence)
# Env: ABNAHME_TEST_TIMEOUT_S (per file, default 150), ABNAHME_TSC=aus, ABNAHME_TESTS=aus.
set -uo pipefail
BASE=${1:?usage: abnahme.sh <base> [<head>]}; HEAD_REF=${2:-HEAD}
ROOT=$(git rev-parse --show-toplevel) || exit 2; cd "$ROOT"
HERE=$ROOT/scripts; RT=$ROOT/.runtime
[ "$(git rev-parse "$HEAD_REF")" = "$(git rev-parse HEAD)" ] || { echo "abnahme: <head> must be checked out (tests and tsc run on the working tree)"; exit 2; }
TMO=${ABNAHME_TEST_TIMEOUT_S:-240}   # leitstand.test.ts alone takes ~2 min
ROT=0; WARN=0
rot()  { echo "  RED   $*"; ROT=1; }
warn() { echo "  WARN  $*"; WARN=1; }
ok()   { echo "  ok    $*"; }
istest() { [[ $1 == */test/* || $1 == *.test.ts || $1 == *.test.mjs || $1 == */e2e/* ]]; }
mapfile -t GEAENDERT < <(git diff --name-only --diff-filter=AM "$BASE" "$HEAD_REF" -- '*.ts' '*.tsx' '*.mjs')
mapfile -t GELOESCHT < <(git diff --name-only --diff-filter=D "$BASE" "$HEAD_REF")

echo "== a) commit and diff ($BASE..$HEAD_REF)"
n=$(git rev-list --count "$BASE..$HEAD_REF" 2>/dev/null || echo 0)
if [ "$n" -lt 1 ]; then rot "no new commit since $BASE"; elif git diff --quiet "$BASE" "$HEAD_REF"; then rot "$n commit(s), but diff empty"; else ok "$n commit(s): $(git diff --shortstat "$BASE" "$HEAD_REF")"; fi
[ -n "$(git status --porcelain --untracked-files=no)" ] && warn "uncommitted changes in the worktree (not part of the check)"

echo "== b) call sites of new exports"
SRC_FILES=$(git ls-files '*.ts' '*.tsx' '*.mjs' | grep -vE '(^|/)(test|e2e)/|\.test\.(ts|mjs)$|node_modules')
nb=0
for f in "${GEAENDERT[@]}"; do
  istest "$f" && continue
  for name in $(git diff -U0 "$BASE" "$HEAD_REF" -- "$f" | grep -E '^\+export ' | sed -nE 's/^\+export (default )?(async )?(function\*?|const|let|class) +([A-Za-z0-9_$]+).*/\4/p'); do
    [[ $name == _* ]] && continue   # _name = test helper by convention
    nb=$((nb+1))
    # Call site = occurrence in another source file, or a second occurrence in the same file.
    andere=$(echo "$SRC_FILES" | grep -vxF "$f" | xargs grep -lw -- "$name" 2>/dev/null | head -1)
    selbst=$(grep -cw -- "$name" "$f" 2>/dev/null || echo 0)
    if [ -z "$andere" ] && [ "$selbst" -le 1 ]; then rot "$f: export '$name' is called nowhere outside the tests"; fi
  done
done
[ "$nb" -eq 0 ] && ok "no new exports" || { [ $ROT -eq 0 ] && ok "$nb new export(s), all called"; }

echo "== c) affected tests (file by file, ${TMO}s cap)"
declare -A TESTS=()
for f in "${GEAENDERT[@]}"; do
  if istest "$f"; then [[ $f == *.test.ts || $f == *.test.mjs ]] && TESTS[$f]=1; continue; fi
  pkg=${f%%/*}; mod=$(basename "${f%.*}")
  for t in $(grep -lE "[/'\"]${mod}(\.ts|\.tsx|\.mjs)?['\"]" "$pkg"/test/*.test.ts "$pkg"/app/test/*.test.ts 2>/dev/null); do TESTS[$t]=1; done
done
if [ "${ABNAHME_TESTS:-}" = aus ]; then warn "tests switched off (ABNAHME_TESTS=aus)"
elif [ ${#TESTS[@]} -eq 0 ]; then warn "no affected test file found — is there no test for the change?"
else
  # Free ports instead of fixed ones (a foreign mongod on a fixed port = tests against someone else's DB).
  frei() { local p; for p in $(seq "$1" $(( $1 + 200 ))); do (echo > "/dev/tcp/127.0.0.1/$p") 2>/dev/null || { echo "$p"; return; }; done; }
  MP=""; TP=${ABNAHME_MONGO_PORT:-$(frei 28100)}
  # All fixed test ports of the suites (WERKBANK_TEST_*PORT || nnnn) onto free ports — a foreign server on a fixed port answers in place of the test server.
  PORTENV=""; nx=3700
  for v in $(grep -rhoE 'WERKBANK_TEST_[A-Z_]*PORT' "$ROOT"/web/test "$ROOT"/web/app/test "$ROOT"/claude-bridge/test 2>/dev/null | sort -u); do
    pp=$(frei $nx); PORTENV="$PORTENV $v=$pp"; nx=$(( pp + 1 ))
  done
  if printf '%s\n' "${!TESTS[@]}" | grep -q '^web/' && [ ! -x "$RT/bin/mongod" ]; then
    rot "web tests affected, but no test mongo ($RT/bin/mongod missing) — check .runtime link"
  fi
  if printf '%s\n' "${!TESTS[@]}" | grep -q '^web/' && [ -x "$RT/bin/mongod" ]; then
    TM=$(mktemp -d); "$RT/bin/mongod" --dbpath "$TM" --bind_ip 127.0.0.1 --port "$TP" --quiet --wiredTigerCacheSizeGB 0.25 > "$TM.log" 2>&1 & MP=$!
    for _ in $(seq 1 60); do (echo > "/dev/tcp/127.0.0.1/$TP") 2>/dev/null && break; sleep 0.5; done
    kill -0 "$MP" 2>/dev/null || { rot "test mongo on :$TP did not start — web tests not meaningful"; MP=""; }
  fi
  for t in $(printf '%s\n' "${!TESTS[@]}" | sort); do
    pkg=${t%%/*}; rel=${t#*/}; s=$(date +%s)
    out=$(cd "$ROOT/$pkg" && MONGO_URI_WERKBANK="mongodb://127.0.0.1:$TP" \
      env $PORTENV timeout "$TMO" "$HERE/sauber-env.sh" node --test --test-timeout=120000 "$rel" 2>&1); rc=$?; d=$(( $(date +%s)-s ))
    p=$(echo "$out" | sed -n 's/^# pass //p' | tail -1); fl=$(echo "$out" | sed -n 's/^# fail //p' | tail -1); c=$(echo "$out" | sed -n 's/^# cancelled //p' | tail -1)
    if [ $rc -eq 124 ]; then rot "$t: hangs (> ${TMO}s, killed)"
    elif [ $rc -ne 0 ] || [ "${fl:-0}" != 0 ] || [ "${c:-0}" != 0 ]; then rot "$t: rc=$rc pass=${p:-?} fail=${fl:-?} cancelled=${c:-0} (${d}s)"; echo "$out" | grep -E '^not ok|error:' | head -4 | sed 's/^/          /'
    else ok "$t: pass=$p (${d}s)"; fi
  done
  [ -n "$MP" ] && { kill "$MP" 2>/dev/null; wait "$MP" 2>/dev/null; rm -rf "$TM" "$TM.log"; }
fi

echo "== d) tamper guard on test files"
zaehl() { grep -cE '\b(assert(\.[a-zA-Z]+)?|expect)\(|^\s*(test|it|describe)\(|\bt\.(test|assert)' ; }
nd=0
for f in $(git diff --name-only --diff-filter=M "$BASE" "$HEAD_REF" | grep -E '(^|/)test/|\.test\.(ts|mjs)$'); do
  nd=$((nd+1)); a=$(git show "$BASE:$f" | zaehl); b=$(git show "$HEAD_REF:$f" | zaehl)
  [ "$b" -lt "$a" ] && rot "$f: asserts/test blocks $a → $b"
  git diff -U0 "$BASE" "$HEAD_REF" -- "$f" | grep -E '^\+' | grep -qE '\.(skip|only|todo)\(|\{ *(skip|todo|only) *:' && rot "$f: skip/only/todo marker added"
done
for f in "${GELOESCHT[@]}"; do istest "$f" && rot "test file deleted: $f"; done
[ $nd -eq 0 ] && ok "no existing test file changed" || ok "$nd test file(s) checked"

echo "== e) type check (errors on lines added in the diff)"
if [ "${ABNAHME_TSC:-}" = aus ]; then warn "tsc switched off (ABNAHME_TSC=aus)"
else
  # Added lines per file from the diff (no base build: a broken base, e.g. a syntax error, would hide everything).
  NEUZ=$(for f in "${GEAENDERT[@]}"; do git diff -U0 "$BASE" "$HEAD_REF" -- "$f" | awk -v f="$f" '/^@@/{split($3,a,",");s=substr(a[1],2);n=(a[2]==""?1:a[2]);for(i=0;i<n;i++)print f":"s+i}'; done)
  for pkg in $(printf '%s\n' "${GEAENDERT[@]}" | cut -d/ -f1 | sort -u); do
    [ -f "$pkg/tsconfig.json" ] && [ -x "$pkg/node_modules/.bin/tsc" ] || { warn "$pkg: no tsconfig/typescript — type check skipped"; continue; }
    neu=0; alle=0
    while IFS= read -r l; do
      [ -z "$l" ] && continue; alle=$((alle+1))
      f=${l%%(*}; z=$(echo "$l" | sed -E 's/^[^(]+\(([0-9]+),.*/\1/')
      echo "$NEUZ" | grep -qxF "$pkg/$f:$z" && { rot "$pkg/$l" ; neu=1; }
    done < <(cd "$pkg" && node_modules/.bin/tsc -p . 2>&1 | grep -E '^[^ (]+\([0-9]+,[0-9]+\): error' | cut -c1-180)
    [ $neu -eq 0 ] && ok "$pkg: no type errors on new lines ($alle pre-existing elsewhere)"
  done
fi

echo "== f) persistence (warning only)"
nf=0
for f in "${GEAENDERT[@]}"; do
  istest "$f" && continue
  if git diff -U0 "$BASE" "$HEAD_REF" -- "$f" | grep -qE '^\+(const|let) +[A-Za-z0-9_]+ *(: *[^=]+)?= *(new Map|new Set|\{\}|\[\]|0\b)'; then
    grep -qE 'writeFileSync|renameSync|writeFile\(|merkeIn|Persistenz|persist' "$f" || { warn "$f: new module state without a file write — does it survive a restart?"; nf=1; }
  fi
done
[ $nf -eq 0 ] && ok "no unpersisted new module state"

echo
if [ $ROT -eq 0 ]; then echo "ABNAHME: GREEN$([ $WARN -eq 1 ] && echo ' (with warnings)')"; exit 0; else echo "ABNAHME: RED"; exit 1; fi
