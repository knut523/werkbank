// Wissen › Ablage › Pakete (Plan 213 S5, K10): Status aus dem Bericht-Kopf, Archiv ohne Bericht, unlesbarer Kopf mit Grund,
// Decks/Downloads/Bilder, neueste zuerst, Zählung je Status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { paketIndex, paketZahlen, _cacheLeeren } from '../server/pakete.ts';

test('Index: wartet/bereit/blockiert aus dem Kopf, offene Fragen, Archiv, Kopf unlesbar, Decks und Downloads', () => {
  const r = mkdtempSync(join(tmpdir(), 'pakete-'));
  const p = (n: string, files: Record<string, string>) => { mkdirSync(join(r, n), { recursive: true }); for (const [f, t] of Object.entries(files)) { mkdirSync(join(r, n, f, '..'), { recursive: true }); writeFileSync(join(r, n, f), t); } };
  p('209-chief-of-staff', { 'bericht.md': '---\nstatus: wartet_auf_knut\ntitel: "Der CoS steht"\nfragen:\n  - id: D1\n    frage: x\n    empfehlung: y\n    antwort: ""\n  - id: D2\n    frage: x\n    empfehlung: y\n    antwort: "ja"\n---\n# x\n', 'screenshots/a.png': 'x', 'folien.html': '<html>' });
  p('210-werkbank-17c', { 'bericht.md': '---\nstatus: bereit_fuer_github\ntitel: 17c\n---\n', 'release.patch': 'x', 'daten.csv': 'a,b' });
  p('189-decks', { 'deck.pdf': '%PDF', 'notiz.md': '# n' });
  p('211-kaputt', { 'bericht.md': '---\nstatus: wartet_auf_knut\ntitel: Scheibe 1–3): Morgenlage: x\n  nested: : bad\n---\n' });
  p('212-ohne', { 'bericht.md': '# Nur Text\n' });
  mkdirSync(join(r, 'notizen'));   // kein Paketname
  _cacheLeeren();
  const z = paketIndex(r);
  assert.deepEqual(z.map((x) => x.name), ['212-ohne', '211-kaputt', '210-werkbank-17c', '209-chief-of-staff', '189-decks'], 'neueste zuerst, nur Paketnamen');
  const cos = z.find((x) => x.name === '209-chief-of-staff')!;
  assert.equal(cos.status, 'wartet'); assert.equal(cos.titel, 'Der CoS steht'); assert.equal(cos.offen, 1); assert.equal(cos.bilder, 1); assert.deepEqual(cos.decks, ['folien.html']);
  const c17 = z.find((x) => x.name === '210-werkbank-17c')!;
  assert.equal(c17.status, 'bereit'); assert.deepEqual(c17.downloads.sort(), ['daten.csv', 'release.patch']);
  assert.equal(z.find((x) => x.name === '189-decks')!.status, 'archiv', 'ohne bericht.md = Archiv');
  assert.deepEqual(z.find((x) => x.name === '189-decks')!.decks, ['deck.pdf']);
  const k = z.find((x) => x.name === '211-kaputt')!;
  assert.equal(k.status, 'kopf-fehler'); assert.match(String(k.fehler), /YAML unlesbar/);
  assert.equal(z.find((x) => x.name === '212-ohne')!.status, 'ohne-kopf');
  assert.deepEqual(paketZahlen(z), { wartet: 1, bereit: 1, blockiert: 0, 'ohne-kopf': 1, 'kopf-fehler': 1, archiv: 1 });
});
