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
  for (const p of quellen.filter((x) => /\.tsx$|\/mehr\.ts$/.test(x))) {   // Pass A (UI 6): auch die sichtbaren Texte aus mehr.ts
    const t = sichtbar(readFileSync(p, 'utf8'));
    for (const re of VERBOTEN) for (const zeile of t.split('\n')) if (re.test(zeile)) funde.push(`${p.slice(SRC.length + 1)}: ${zeile.trim().slice(0, 80)}`);
  }
  assert.deepEqual(funde, []);
});

test('Begriffe: die Begriffsliste selbst ist jargonfrei und erklärt die Kernwörter', () => {
  for (const b of BEGRIFFE) for (const re of VERBOTEN) assert.doesNotMatch(`${b.wort} ${b.heisst} ${b.beispiel}`, re, b.wort);
  for (const w of ['Wartet auf dich', 'Unter-Chat', 'Hauptchat', 'Chat', 'Entscheidung', 'Freigabe', 'Dokument']) assert.ok(BEGRIFFE.some((b) => b.wort === w), w);
});

// Ausnahme (Parität, Knut 06.11. „lieber die alte Komponente 1:1 übernehmen“): nur alt.tsx hängt Seiten der alten Werkbank
// aus web/src ein — und zwar nur Seiten, ihre Hülle (ui/api) und das Stylesheet; nie web/server oder die Brücke.
const ALT_ERLAUBT = /^\.\.\/\.\.\/src\/(pages\/[A-Za-z]+\.tsx|ui\.tsx|api\.ts|styles\.css\?inline)$/;
test('Importregel (B6): nichts aus web/server, claude-bridge oder web/src (außer alt.tsx → alte Seiten)', () => {
  const funde: string[] = [];
  for (const p of quellen) {
    const t = readFileSync(p, 'utf8');
    for (const m of t.matchAll(/(?:\bimport\b[^'"]*?|\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const ziel = m[1];
      // erlaubt: Pakete (react, markdown-it …) und Dateien innerhalb von web/app/src
      const erlaubt = ziel.startsWith('./') ? join(dirname(p), ziel).startsWith(SRC) : !ziel.startsWith('.') && !ziel.startsWith('/');
      if (p.endsWith('/alt.tsx') && ALT_ERLAUBT.test(ziel)) continue;
      if (!erlaubt || /(^|\/)(server|claude-bridge)(\/|$)/.test(ziel)) funde.push(`${p.slice(SRC.length + 1)}: ${ziel}`);
    }
  }
  assert.deepEqual(funde, []);
});

test('Freigaben (B4, abgelöst Knut 06.11.): Push-Freigabe nur über die Freigabe-Ansicht (Erlaubnisliste); kein Push/Merge; Antworten nur über /api/v2/antwort', () => {
  // Phase 4: Pfade mit ${…} zählen mit (vorher griff das Muster dort nicht und der Test war grün, obwohl der Aufruf da war).
  const ERLAUBT = new Set(['seiten.tsx api/review/:x/freigabe', 'seiten.tsx api/review/:x/freigabe/:x/zurueck']);
  const funde: string[] = [];
  for (const p of quellen) {
    for (const m of readFileSync(p, 'utf8').matchAll(/\bapi\/[^'"`\s)]*?(freigabe|push|merge)[^'"`\s)]*/gi)) funde.push(`${p.slice(SRC.length + 1)} ${m[0].replace(/\$\{[^}]*\}/g, ':x')}`);
  }
  assert.deepEqual(funde.filter((f) => !ERLAUBT.has(f)), [], 'Freigabe-, Push- oder Merge-Aufruf außerhalb der Erlaubnisliste');
  assert.ok(funde.length > 0, 'das Muster erkennt die Aufrufe der Freigabe-Ansicht');
  const alle = quellen.map((p) => readFileSync(p, 'utf8')).join('\n');
  for (const re of [/\bapi\/inbox\/[^'"`]*\/antwort/, /\bapi\/entscheidungen\/fragen\/(antwort|alle)/]) assert.doesNotMatch(alle, re, String(re));
  assert.match(alle, /\bapi\/v2\/antwort/);
});

test('C5 (S14): jeder Eintrag der alten Navigation hat unter „Mehr“ einen Platz — in 2.0 gebaut oder als Link in die alte Werkbank', async () => {
  const { MEHR } = await import('../src/mehr.ts');
  const alt = readFileSync(join(SRC, '..', '..', 'src', 'App.tsx'), 'utf8');
  const hrefs = [...new Set([...alt.matchAll(/href: '(#\/[^']*)'/g)].map((m) => m[1]))];
  assert.ok(hrefs.length >= 15, `alte Navigation gefunden (${hrefs.length})`);
  const da = new Set(MEHR.map((e) => e.alt));
  assert.deepEqual(hrefs.filter((h) => !da.has(h)), [], 'fehlt unter „Mehr“');
  for (const e of MEHR) {
    if (e.ziel === 'v2') assert.match(e.url, /^v2\//, e.titel);
    else assert.match(e.url, /^[a-z]+$/, e.titel);
    assert.ok(e.satz.length > 15, `Klartext-Satz für ${e.titel}`);
  }
});
