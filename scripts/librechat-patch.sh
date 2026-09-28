#!/usr/bin/env bash
# Werkbank-Anpassungen an LibreChat einspielen — idempotent, von setup.sh (werkbank.sh up|update) aufgerufen.
#   librechat/overlay/**   neue Dateien, werden jedes Mal hineinkopiert
#   librechat/patches/*.patch   kleine Änderungen an LibreChat-Dateien (git apply); schon angewandte werden erkannt
# Ändert sich etwas am Client (Overlay/Patches), wird nur der Client neu gebaut (vite, ~1–2 Minuten).
# Ein Patch, der auf eine neue LibreChat-Version nicht mehr passt, bricht mit Hinweis ab (nichts halb anwenden).
set -euo pipefail
source "$(dirname "$0")/env.sh"
LC="$RT/librechat"
[ -d "$LC" ] || { echo "  ! LibreChat fehlt ($LC)"; exit 1; }

cp -r "$WB/librechat/overlay/." "$LC/"

for p in "$WB"/librechat/patches/*.patch; do
  n=$(basename "$p")
  if git -C "$LC" apply --reverse --check "$p" 2>/dev/null; then
    continue                                              # schon drin
  elif git -C "$LC" apply --check "$p" 2>/dev/null; then
    git -C "$LC" apply "$p" && echo "  + Patch $n"
  else
    echo "  ✗ Patch $n passt nicht auf LibreChat $LIBRECHAT_TAG — bitte librechat/patches/$n anpassen"; exit 1
  fi
done

# Client neu bauen, wenn sich Overlay/Patches geändert haben (Stempel = Hash über beide + Tag).
stamp="$LC/.werkbank-client-stamp"
want=$( (echo "$LIBRECHAT_TAG"; cat "$WB"/librechat/patches/*.patch; find "$WB/librechat/overlay/client" -type f -print0 | sort -z | xargs -0 cat) | sha256sum | cut -c1-16)
if [ "${1:-}" = "--stamp-only" ]; then echo "$want" > "$stamp"; exit 0; fi   # nach einem vollen Build
if [ "${1:-}" = "--no-build" ]; then exit 0; fi
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$want" ] || [ ! -f "$LC/client/dist/index.html" ]; then
  echo "  → LibreChat-Oberfläche mit Werkbank-Leiste bauen (Log: $LOGS/librechat-client-build.log)"
  (cd "$LC/client" && npm run build) > "$LOGS/librechat-client-build.log" 2>&1 || { echo "  ✗ Build fehlgeschlagen — siehe Log"; exit 1; }
  echo "$want" > "$stamp"
  echo "  ✓ gebaut — LibreChat neu starten, damit Server-Änderungen greifen (werkbank.sh restart)"
fi
