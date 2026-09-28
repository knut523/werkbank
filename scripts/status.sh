#!/usr/bin/env bash
# Zeigt, welche Werkbank-Dienste laufen, und prüft die Endpunkte.
source "$(dirname "$0")/env.sh"
for name in $SERVICES; do
  f="$PIDS/$name.pid"
  if [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null; then echo "✓ $name (pid $(cat "$f"))"; else echo "✗ $name"; fi
done
echo "LibreChat  http://127.0.0.1:3080  → $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/)"
echo "Brücke     http://127.0.0.1:3090  → $(curl -s http://127.0.0.1:3090/health)"
echo "Werkbank   http://127.0.0.1:3070  → $(curl -s http://127.0.0.1:3070/api/health)"
