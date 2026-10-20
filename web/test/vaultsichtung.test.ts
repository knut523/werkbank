// U6 (Knut 19.10.): Sichtung der wichtigen Vault-Fragen — aktuelle einzeln nach Priorität, erledigte/veraltete raus,
// nicht gesichtete nach der alten Regel; ohne Sichtung wie bisher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sichtKey, ladeSichtung, waehle } from '../server/vaultsichtung.ts';

const q = (path: string, head: string, first = false, old = true, since = '2026-09-01') => ({ path, head, first, old, since });

test('Sichtung: aktuelle nach Priorität einzeln, erledigte/veraltete gezählt und raus, ungesichtete nach alter Regel', () => {
  const sicht = new Map([
    [sichtKey('a.md', 'Frage A  mit   Leerraum'), { status: 'aktuell' as const, prio: 2, kurz: 'A kurz', beleg: 'a.md:1' }],
    [sichtKey('b.md', 'Frage B'), { status: 'aktuell' as const, prio: 1, kurz: 'B', beleg: 'b.md:2' }],
    [sichtKey('c.md', 'Frage C'), { status: 'erledigt' as const, prio: null, kurz: '', beleg: 'Decisions/x.md' }],
    [sichtKey('d.md', 'Frage D'), { status: 'veraltet' as const, prio: null, kurz: '', beleg: '4-Archive' }],
    [sichtKey('g.md', 'Frage G'), { status: 'aktuell' as const, prio: 3, kurz: 'G kann warten', beleg: 'g.md:3' }],
  ]);
  const r = waehle([q('a.md', 'Frage A mit Leerraum'), q('b.md', 'Frage B'), q('c.md', 'Frage C', true, false), q('d.md', 'Frage D'), q('e.md', 'Neu E', true, false), q('f.md', 'Alt F'), q('g.md', 'Frage G', true, false)], sicht);
  assert.deepEqual(r.einzeln.map((x) => x.path), ['b.md', 'a.md', 'e.md'], 'Prio 1 vor 2; Prio 3 im Sammeleintrag, auch wenn neu; ungesichtet neu nach alter Regel (Prio wie 2, jüngeres Datum zuerst)');
  assert.deepEqual(r.ausgesiebt, { erledigt: 1, veraltet: 1 });
  assert.equal(r.einzeln[0].sichtung?.kurz, 'B');
  assert.deepEqual(waehle([q('e.md', 'Neu E', true, false), q('f.md', 'Alt F')], null).einzeln.map((x) => x.path), ['e.md'], 'ohne Sichtung: alte Regel');
});

test('ladeSichtung: nur gültige Einträge, kaputte Datei → null', () => {
  const d = mkdtempSync(join(tmpdir(), 'sicht-'));
  writeFileSync(join(d, 's.json'), JSON.stringify({ stand: '2026-10-19', eintraege: [{ key: 'a|b', status: 'aktuell', prio: 1, kurz: 'k', beleg: 'x' }, { key: 'c|d', status: 'unsinn' }] }));
  const s = ladeSichtung(join(d, 's.json'))!;
  assert.equal(s.stand, '2026-10-19'); assert.equal(s.eintraege.size, 1);
  writeFileSync(join(d, 'k.json'), '{kaputt');
  assert.equal(ladeSichtung(join(d, 'k.json')), null);
  assert.equal(ladeSichtung(join(d, 'fehlt.json')), null);
});
