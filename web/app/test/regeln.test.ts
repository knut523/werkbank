// Werkbank 2.0 (Paket 436): Regeln, die die Oberfläche als Ganzes einhalten muss.
//  - Begriffe (plan §4): kein Jargon der alten Werkbank in sichtbaren Texten (Quelltext-Scan der .tsx, außer begriffe.ts).
//  - Importregel (Council B6): die App importiert nichts aus web/server, claude-bridge oder web/src — nur über /api.
//  - Freigaben (Council B4): die App ruft keinen Freigabe-/Push-Endpunkt auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERBOTEN, BEGRIFFE } from '../src/begriffe.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const dateien = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? dateien(p) : [p]; });
const quellen = dateien(SRC).filter((p) => /\.(tsx?|css)$/.test(p));

/** Sichtbare Texte grob: JSX-Text zwischen Tags und String-Literale; Kommentare und Import-Zeilen raus. */
function sichtbar(src: string): string {
  const ohne = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^import .*$/gm, '');
  const jsx = [...ohne.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  const str = [...ohne.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((s) => !/^[\w./-]*$/.test(s) || /\s/.test(s));
  return [...jsx, ...str].join('\n');
}

test('Begriffe: kein Strang/Leitstand/Orchestrator/Vault/Inbox/„Braucht Knut“ in sichtbaren Texten', () => {
  const funde: string[] = [];
  for (const p of quellen.filter((x) => /\.tsx$/.test(x))) {
    const t = sichtbar(readFileSync(p, 'utf8'));
    for (const re of VERBOTEN) for (const zeile of t.split('\n')) if (re.test(zeile)) funde.push(`${p.slice(SRC.length + 1)}: ${zeile.trim().slice(0, 80)}`);
  }
  assert.deepEqual(funde, []);
});

test('Begriffe: die Begriffsliste selbst ist jargonfrei und erklärt die Kernwörter', () => {
  for (const b of BEGRIFFE) for (const re of VERBOTEN) assert.doesNotMatch(`${b.wort} ${b.heisst} ${b.beispiel}`, re, b.wort);
  for (const w of ['Wartet auf dich', 'Unter-Chat', 'Chat (Hauptchat)', 'Entscheidung', 'Freigabe', 'Dokument']) assert.ok(BEGRIFFE.some((b) => b.wort === w), w);
});

test('Importregel (B6): nichts aus web/server, claude-bridge oder web/src', () => {
  const funde: string[] = [];
  for (const p of quellen) {
    const t = readFileSync(p, 'utf8');
    for (const m of t.matchAll(/(?:\bimport\b[^'"]*?|\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const ziel = m[1];
      // erlaubt: Pakete (react, markdown-it …) und Dateien innerhalb von web/app/src
      const erlaubt = ziel.startsWith('./') ? join(dirname(p), ziel).startsWith(SRC) : !ziel.startsWith('.') && !ziel.startsWith('/');
      if (!erlaubt || /(^|\/)(server|claude-bridge)(\/|$)/.test(ziel)) funde.push(`${p.slice(SRC.length + 1)}: ${ziel}`);
    }
  }
  assert.deepEqual(funde, []);
});

test('Freigaben (B4): die App ruft keine Freigabe-, Push- oder Merge-Endpunkte auf; Antworten nur über /api/v2/antwort', () => {
  const alle = quellen.map((p) => readFileSync(p, 'utf8')).join('\n');
  // S16: Pfade sind relativ ('api/…') — die Muster erkennen beide Schreibweisen.
  for (const re of [/\bapi\/[\w/-]*freigabe/i, /\bapi\/[\w/-]*push/i, /\bapi\/[\w/-]*merge/i, /\bapi\/inbox\/[^'"`]*\/antwort/, /\bapi\/entscheidungen\/fragen\/(antwort|alle)/]) assert.doesNotMatch(alle, re, String(re));
  assert.match(alle, /\bapi\/v2\/antwort/);
});
