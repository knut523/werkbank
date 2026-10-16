// Wächter für das Glossar (Plan 185/187, S1): sichtbare Texte nennen „Strang“, „Leitstand“, „Hauptsitzung“,
// „Orchestrator“ und Env-Namen (WERKBANK_…) nicht. Gesucht wird nur in String-Literalen und JSX-Text, nicht in
// Kommentaren, Importen oder Bezeichnern. Env-Namen dürfen hinter „Technische Details“ (<details>) stehen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WURZELN = ['src', '../librechat/overlay/client/src/components/Werkbank'];
const VERBOTEN = /Strang|Stränge|Hauptsitzung|Haupt-Sitzung|Leitstand|Orchestrator|WERKBANK_/;

function dateien(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? dateien(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

export function sichtbar(zeile: string): string[] {
  const r: string[] = [];
  for (const m of zeile.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) r.push(m[2]);
  for (const m of zeile.matchAll(/>([^<>{}]+)</g)) r.push(m[1]);
  return r;
}

test('Glossar: keine verbotenen Wörter in sichtbaren Texten', () => {
  const funde: string[] = [];
  for (const w of WURZELN) for (const f of dateien(w)) {
    const text = ohneKommentare(readFileSync(f, 'utf8')).replace(/<details[^>]*>(?:(?!<\/details>)[\s\S])*?Technische Details[\s\S]*?<\/details>/g, '');
    // JSX-Text über Zeilengrenzen hinweg
    for (const m of text.matchAll(/>([^<>{}]+)</g)) if (VERBOTEN.test(m[1])) funde.push(`${f}: ${m[1].trim().slice(0, 80)}`);
    text.split('\n').forEach((z, i) => {
      if (/^\s*(import|export .* from)\b/.test(z)) return;
      for (const t of sichtbar(z)) if (VERBOTEN.test(t) && !/^[\w./#-]+$/.test(t)) funde.push(`${f}:${i + 1}: ${t.slice(0, 80)}`);
    });
  }
  assert.deepEqual(funde, []);
});

test('Wächter erkennt echte Treffer', () => {
  assert.ok(sichtbar("<b>Strang meldet</b>").some((t) => VERBOTEN.test(t)));
  assert.ok(sichtbar("toast('Der Orchestrator liest')").some((t) => VERBOTEN.test(t)));
  assert.ok(!sichtbar("import { Leitstand } from './x';").some((t) => /^[\w./#-]+$/.test(t) === false && VERBOTEN.test(t)));
});
