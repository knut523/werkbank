// Konzept J, J1: review_ready per Datei — jcode-Stränge melden „fertig“ über review-ready.json im Arbeitsordner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewDateiLesen, ergebnisseUebernehmen, REVIEW_DATEI } from '../server/reviewdatei.ts';

const gut = { gemacht: 'Review Pass 1', nicht_gemacht: 'nichts', risiko: 'nichts', dod: [{ punkt: 'befunde.json', stand: 'ja', beleg: 'im Paket' }], artefakte: ['befunde.json'] };

test('review-ready.json: gültig → Review; ungültig → Fehler; älter als die letzte Marke → nichts; fehlt → nichts', () => {
  const d = mkdtempSync(join(tmpdir(), 'rd-'));
  assert.equal(reviewDateiLesen(d, null), null);
  writeFileSync(join(d, REVIEW_DATEI), JSON.stringify(gut));
  const r: any = reviewDateiLesen(d, null);
  assert.equal(r.review.gemacht, 'Review Pass 1'); assert.equal(r.review.dod.length, 1);
  assert.equal(reviewDateiLesen(d, r.mtime), null, 'schon übernommen');
  writeFileSync(join(d, REVIEW_DATEI), JSON.stringify({ gemacht: 'x' }));
  utimesSync(join(d, REVIEW_DATEI), new Date(), new Date(Date.now() + 5000));
  assert.match((reviewDateiLesen(d, r.mtime) as any).error, /Pflichtfelder fehlen/);
  writeFileSync(join(d, REVIEW_DATEI), '{kaputt');
  assert.match((reviewDateiLesen(d, null) as any).error, /kein gültiges JSON/);
});

test('review-ready.json als Symlink nach draußen zählt nicht', () => {
  const d = mkdtempSync(join(tmpdir(), 'rd-')), aussen = mkdtempSync(join(tmpdir(), 'rd-aussen-'));
  writeFileSync(join(aussen, 'x.json'), JSON.stringify(gut));
  symlinkSync(join(aussen, 'x.json'), join(d, REVIEW_DATEI));
  assert.equal(reviewDateiLesen(d, null), null);
});

test('befunde.json und bericht.md gehen ins Paket — nur neuere, befunde.json nur als gültiges JSON', () => {
  const d = mkdtempSync(join(tmpdir(), 'rd-')), p = join(mkdtempSync(join(tmpdir(), 'rd-paket-')), '500-review-x');
  writeFileSync(join(d, 'befunde.json'), '{"befunde":[]}');
  writeFileSync(join(d, 'bericht.md'), '# Bericht');
  assert.deepEqual(ergebnisseUebernehmen(d, p), ['befunde.json', 'bericht.md']);
  assert.equal(readFileSync(join(p, 'bericht.md'), 'utf8'), '# Bericht');
  assert.deepEqual(ergebnisseUebernehmen(d, p), [], 'unverändert → nichts');
  writeFileSync(join(d, 'befunde.json'), '{kaputt');
  utimesSync(join(d, 'befunde.json'), new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(ergebnisseUebernehmen(d, p), []);
  assert.equal(readFileSync(join(p, 'befunde.json'), 'utf8'), '{"befunde":[]}', 'kaputtes JSON überschreibt nicht');
  assert.deepEqual(ergebnisseUebernehmen(d, null), []);
  assert.ok(!existsSync(join(p, REVIEW_DATEI)));
});
