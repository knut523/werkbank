// B4 (Knut 07.11.): Verbrauchsbuch je Lauf — Läufer, Aufgabenart, Summen heute/Woche, Mediane je Aufgabe, Ausreißer (> 2 × Median).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laeuferVon, aufgabeVon, ergebnisVon, median, verbrauchAus, type Zug, type RunInfo } from '../server/verbrauch.ts';

const now = Date.UTC(2026, 10, 7, 15);
const tagAb = Date.UTC(2026, 10, 7, 0);
const z = (o: Partial<Zug>): Zug => ({ at: now - 3600_000, conv: 'c1', art: 'strang', anbieter: 'claude', modell: 'Claude opus', input: 1000, output: 100, cacheRead: 0, energie: 0, outcome: 'ok', ms: 60_000, ...o });

test('Läufer aus Buchung, Modellname oder Anbieter', () => {
  assert.equal(laeuferVon({ laeufer: 'oc2', modell: 'x', anbieter: 'melious' }), 'oc2');
  assert.equal(laeuferVon({ laeufer: 'quatsch', modell: 'glm-5.3 (jcode)', anbieter: 'melious' }), 'jcode');
  assert.equal(laeuferVon({ modell: 'glm-5.2 (opencode2, ensemble)', anbieter: 'melious' }), 'oc2');
  assert.equal(laeuferVon({ modell: 'Melious glm-5.3', anbieter: 'melious' }), 'melious');
  assert.equal(laeuferVon({ modell: 'Claude opus', anbieter: 'claude' }), 'claude');
});

test('Aufgabenart und Ergebnis', () => {
  const r = (o: Partial<RunInfo>): RunInfo => ({ id: 'a', conv: 'c', titel: 'Rechner bauen', ...o });
  assert.equal(aufgabeVon({ art: 'strang' }, r({ titel: 'Review PR #12', tiefe: 'deep' })), 'review-tief');
  assert.equal(aufgabeVon({ art: 'strang' }, r({ titel: 'Bot: Review olaf#3' })), 'review');
  assert.equal(aufgabeVon({ art: 'strang' }, r({ profil: 'leser' })), 'lesen');
  assert.equal(aufgabeVon({ art: 'strang' }, r({ code: true })), 'bau');
  assert.equal(aufgabeVon({ art: 'strang' }, r({})), 'sonst');
  assert.equal(aufgabeVon({ art: 'gegenpruefung' }, null), 'gegenpruefung');
  assert.equal(aufgabeVon({ art: 'hauptchat' }, null), 'hauptchat');
  assert.equal(aufgabeVon({ art: 'strang', aufgabe: 'lesen' }, r({ code: true })), 'lesen', 'ausdrücklich gebucht gewinnt');
  assert.equal(ergebnisVon('erledigt', 'aborted'), 'fertig');
  assert.equal(ergebnisVon('laeuft', 'aborted'), 'abgebrochen');
  assert.equal(ergebnisVon('laeuft', 'ok'), 'offen');
  assert.equal(ergebnisVon(undefined, 'ok'), 'fertig', 'Gegenprüfung ohne Strang: ok = fertig');
  assert.equal(median([]), 0); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('Summen je Läufer: Worker zählen zum Strang, Tokens ohne Cache-Lesen, heute/Woche getrennt', () => {
  const runs: RunInfo[] = [{ id: 'aaaa0001', conv: 'c1', titel: 'Bauen A', code: true, zustand: 'erledigt' }];
  const zs = [
    z({ input: 5000, cacheRead: 4000, output: 500 }),   // Claude-Lead: 1000 + 500 = 1500 Tokens
    z({ art: 'worker', conv: 'w1', parent: 'u1:c1', anbieter: 'melious', modell: 'glm-5.3 (jcode)', input: 300, output: 50, energie: 40, ms: 30_000 }),
    z({ at: now - 3 * 86400_000, conv: 'c9', input: 100, output: 10 }),   // Woche, nicht heute
  ];
  const v = verbrauchAus(zs, runs, now, { tagAb });
  const h = Object.fromEntries(v.heute.map((x) => [x.laeufer, x]));
  assert.equal(h.claude.versuche, 1); assert.equal(h.claude.input - h.claude.cacheRead + h.claude.output, 1500);
  assert.equal(h.jcode.energie, 40); assert.equal(h.jcode.versuche, 1);
  const w = Object.fromEntries(v.woche.map((x) => [x.laeufer, x]));
  assert.equal(w.claude.versuche, 2);
  const lauf = v.laeufe.find((x) => x.key === 's:c1')!;
  assert.equal(lauf.versuche, 2, 'Worker gehört zum Strang'); assert.equal(lauf.laeufer, 'claude', 'größter Anteil');
  assert.equal(lauf.aufgabe, 'bau'); assert.equal(lauf.ergebnis, 'fertig'); assert.equal(lauf.energie, 40);
  assert.equal(h.claude.laeufe, 1, 'Strang zählt einmal, beim Läufer mit dem größten Anteil');
});

test('Vergleich je Aufgabe und Läufer (nur fertige) und Ausreißer über 2 × Median ab 3 Läufen', () => {
  const runs: RunInfo[] = [];
  const zs: Zug[] = [];
  const reviews = [1000, 1100, 900, 5000];
  reviews.forEach((n, i) => { runs.push({ id: `r${i}`, conv: `rc${i}`, titel: `Review ${i}`, tiefe: 'regular', zustand: 'fertig' }); zs.push(z({ conv: `rc${i}`, input: n, output: 0 })); });
  runs.push({ id: 'o1', conv: 'oc', titel: 'Review offen', zustand: 'laeuft' }); zs.push(z({ conv: 'oc', input: 99_999, output: 0 }));
  zs.push(z({ art: 'gegenpruefung', conv: null, laeufer: 'oc2', anbieter: 'melious', modell: 'ensemble', input: 2000, output: 200, energie: 300 }));
  const v = verbrauchAus(zs, runs, now, { tagAb });
  const r = v.vergleich.find((x) => x.aufgabe === 'review' && x.laeufer === 'claude')!;
  assert.equal(r.n, 4, 'der offene Review zählt nicht'); assert.equal(r.tokensMedian, 1050);
  assert.ok(v.vergleich.some((x) => x.aufgabe === 'gegenpruefung' && x.laeufer === 'oc2' && x.energieMedian === 300));
  assert.equal(v.ausreisser.length, 1); assert.equal(v.ausreisser[0].titel, 'Review 3'); assert.equal(v.ausreisser[0].wert, 'tokens'); assert.equal(v.ausreisser[0].faktor, 4.8);
  // unter 3 fertigen Läufen keine Ausreißer
  assert.equal(verbrauchAus(zs.slice(0, 2), runs, now, { tagAb }).ausreisser.length, 0);
});
