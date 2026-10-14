#!/usr/bin/env bash
# Plan 157: echte GitHub-Antworten für den PR-Ticker aufzeichnen (einmalig, von Knut oder der Hauptsitzung — Stränge
# dürfen GitHub nicht ansprechen). Nur LESEND: dieselbe GraphQL-Suche wie der Ticker (tickerQuery), mit dem Lesetoken
# „View only github API“ über den Credential-Helper (GIT_VW_READ=1). Der Token bleibt in der Umgebung dieses Aufrufs und
# wird nie ausgegeben. Ergebnis: web/test/fixtures/github/<datum>.json, Kommentar-/Review-Texte auf 300 Zeichen gekürzt.
# Vor dem Commit ansehen (enthält PR-Titel und Kommentar-Auszüge der privaten Repos).
#   scripts/pr-ticker-fixtures.sh [TAGE]   (Standard: PRs, die in den letzten 3 Tagen aktualisiert wurden)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
TAGE=${1:-3}
HELPER=${GIT_CREDENTIAL_VW:-$HOME/bin/git-credential-vaultwarden}
TOKEN=$(printf 'protocol=https\nhost=github.com\npath=WirStrom1/olaf-admin.git\n\n' | GIT_VW_READ=1 "$HELPER" get | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || { echo "Kein Lesetoken (Vaultwarden entsperrt?)" >&2; exit 1; }
cd "$HERE/../web"
mkdir -p test/fixtures/github
WERKBANK_GITHUB_TOKEN="$TOKEN" TAGE="$TAGE" node --input-type=module -e '
import { writeFileSync } from "node:fs";
import { graphql } from "./server/github.ts";
import { tickerQuery, scopes, ghTime } from "./server/prticker.ts";
const sc = scopes();
const since = new Date(Date.now() - Number(process.env.TAGE) * 86400_000);
const vars = Object.fromEntries(sc.map((s, i) => [`q${i}`, `is:pr ${s} updated:>=${ghTime(since)} sort:updated-desc`]));
const data = await graphql(process.env.WERKBANK_GITHUB_TOKEN, tickerQuery(sc.length), vars);
const cut = (t) => (typeof t === "string" && t.length > 300 ? t.slice(0, 300) + "…" : t);
for (const k of Object.keys(data)) for (const p of data[k]?.nodes ?? []) {
  for (const c of p.comments?.nodes ?? []) c.body = cut(c.body);
  for (const r of p.reviews?.nodes ?? []) r.body = cut(r.body);
}
const f = `test/fixtures/github/${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(f, JSON.stringify({ recordedAt: new Date().toISOString(), scopes: sc, variables: vars, data }, null, 1) + "\n");
console.log(`${f}: ${sc.map((s, i) => `${s} → ${data["s" + i]?.nodes?.length ?? 0} PRs`).join(", ")}`);
'
