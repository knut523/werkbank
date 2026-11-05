// Warteschlange statt Fehlschlag (Plan 213 S1a, Council K3): Reihenfolge (Vorrang, dann Ankunft), Warten bis frei,
// Verbindung weg, Zeitdeckel, Aufrücken nach dem Ende eines Zugs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reihe, position, warte, wecke, inSchlange, laenge, angemeldet, maxWarteMs, merkeIn, _leeren, type Platz } from '../src/schlange.ts';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeEach(() => _leeren());

test('Reihenfolge je Person: Vorrang zuerst, dann wer zuerst kam; andere Personen zählen nicht', () => {
  const q: Platz[] = [
    { key: 'a', userId: 'u', since: 1, vorrang: false },
    { key: 'b', userId: 'u', since: 2, vorrang: true },
    { key: 'c', userId: 'v', since: 0, vorrang: false },
    { key: 'd', userId: 'u', since: 3, vorrang: false },
  ];
  assert.deepEqual(reihe(q, 'u').map((p) => p.key), ['b', 'a', 'd']);
  assert.equal(position(q, 'b'), 1);
  assert.equal(position(q, 'a'), 2);
  assert.equal(position(q, 'c'), 1);
  assert.equal(position(q, 'x'), 0);
});

test('Fünf Starts bei Grenze 3: zwei warten (Platz 1 und 2), keiner schlägt fehl; nach dem Ende rücken sie auf', async () => {
  let laufend = 3;
  const frei = () => laufend < 3;
  const gemeldet: Record<string, number[]> = { x: [], y: [] };
  const x = warte({ key: 'x', userId: 'u', vorrang: false }, { frei, geschlossen: () => false, melde: (p) => gemeldet.x.push(p), takt: 20 });
  await new Promise((r) => setTimeout(r, 5));
  const y = warte({ key: 'y', userId: 'u', vorrang: false }, { frei, geschlossen: () => false, melde: (p) => gemeldet.y.push(p), takt: 20 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(laenge('u'), 2);
  assert.deepEqual(inSchlange('x')?.pos, 1);
  assert.deepEqual(inSchlange('y')?.pos, 2);
  laufend = 2; wecke();
  assert.equal(await x, 'start');
  laufend = 3; angemeldet();   // x läuft jetzt (sessions.ts meldet das gleich nach dem Eintrag)
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(inSchlange('y')?.pos, 1, 'y ist aufgerückt');
  assert.deepEqual(gemeldet.y, [2, 1]);
  laufend = 2; wecke();
  assert.equal(await y, 'start');
  assert.equal(laenge(), 0);
});

test('Vorrang (Review) überholt, Verbindung weg verlässt die Schlange, Zeitdeckel endet ehrlich', async () => {
  let frei = false;
  let zu = false;
  const normal = warte({ key: 'n', userId: 'u', vorrang: false }, { frei: () => frei, geschlossen: () => zu, melde: () => {}, takt: 10 });
  await new Promise((r) => setTimeout(r, 5));
  const review = warte({ key: 'r', userId: 'u', vorrang: true }, { frei: () => frei, geschlossen: () => false, melde: () => {}, takt: 10 });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(inSchlange('r')?.pos, 1);
  frei = true; wecke();
  assert.equal(await review, 'start');
  frei = false; zu = true; angemeldet();
  assert.equal(await normal, 'zu');
  assert.equal(laenge(), 0);
  // Zeitdeckel: 1 Minute Mindestwert, simuliert über eine eigene Uhr.
  let t = 0;
  const alt = process.env.BRIDGE_QUEUE_MAX_MIN; process.env.BRIDGE_QUEUE_MAX_MIN = '1';
  const z = warte({ key: 'z', userId: 'u', vorrang: false }, { frei: () => false, geschlossen: () => false, melde: () => { t += 61_000; }, now: () => t, takt: 5 });
  assert.equal(await z, 'zeit');
  if (alt === undefined) delete process.env.BRIDGE_QUEUE_MAX_MIN; else process.env.BRIDGE_QUEUE_MAX_MIN = alt;
});

test('Pass C: zwei Wartende, ein freier Platz, im selben Takt geweckt — der zweite startet erst nach angemeldet()', async () => {
  let laufend = 3;
  const frei = () => laufend < 3;
  const a = warte({ key: 'a', userId: 'u', vorrang: false }, { frei, geschlossen: () => false, melde: () => {}, takt: 1_000 });
  await new Promise((r) => setTimeout(r, 2));
  const b = warte({ key: 'b', userId: 'u', vorrang: false }, { frei, geschlossen: () => false, melde: () => {}, takt: 1_000 });
  await new Promise((r) => setTimeout(r, 2));
  laufend = 2; wecke();   // ein Platz frei, beide wachen im selben Takt auf
  assert.equal(await a, 'start');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(inSchlange('b')?.pos, 1, 'b wartet weiter, obwohl frei() noch „ja“ sagt (a ist noch nicht eingetragen)');
  laufend = 3; angemeldet();   // a ist jetzt eingetragen → kein Platz mehr
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(inSchlange('b')?.pos, 1);
  laufend = 2; wecke();
  assert.equal(await b, 'start');
  angemeldet();
});

test('Audit 05.11. (3): Wartegrund steht am Platz; jcode hat eine eigene Reihe', async () => {
  let g = 'Box voll (11,9 GB)';
  let zu = false;
  const a = warte({ key: 'a', userId: 'u', vorrang: false }, { frei: () => false, grund: () => g, geschlossen: () => zu, melde: () => {}, takt: 5 });
  await new Promise((r) => setTimeout(r, 3));
  const j = warte({ key: 'j', userId: 'u', vorrang: false, topf: 'jcode' }, { frei: () => false, geschlossen: () => zu, melde: () => {}, takt: 5 });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(inSchlange('a')?.grund, 'Box voll (11,9 GB)');
  assert.equal(inSchlange('j')?.pos, 1, 'jcode wartet nicht hinter Claude');
  g = 'Host knapp'; await new Promise((r) => setTimeout(r, 15));
  assert.equal(inSchlange('a')?.grund, 'Host knapp');
  zu = true; wecke();
  assert.equal(await a, 'zu'); assert.equal(await j, 'zu');
});

test('Audit 05.11. (3): Schlange übersteht Neustart und Zeitdeckel — wer wiederkommt, behält seinen Platz (since)', async () => {
  const datei = join(mkdtempSync(join(tmpdir(), 'schlange-')), 'schlange.json');
  merkeIn(datei);
  let t = 1_000, zu = false;
  const o = () => ({ frei: () => false, geschlossen: () => zu, melde: () => {}, now: () => t, takt: 5 });
  const x = warte({ key: 'x', userId: 'u', vorrang: false }, o());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(JSON.parse(readFileSync(datei, 'utf8')).plaetze[0].key, 'x', 'auf Platte');
  // „Neustart“: der Prozess ist weg — die Datei bleibt; der neue Prozess liest sie beim Start.
  _leeren(); merkeIn(datei);
  t = 5_000;
  const y = warte({ key: 'y', userId: 'u', vorrang: false }, o());
  await new Promise((r) => setTimeout(r, 3));
  const x2 = warte({ key: 'x', userId: 'u', vorrang: false }, o());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(inSchlange('x')?.since, 1_000, 'alter Platz');
  assert.equal(inSchlange('x')?.pos, 1, 'vor y, das erst nach dem Neustart kam');
  zu = true; wecke();
  await Promise.all([y, x2]); void x;
  // Zeitdeckel: der Platz bleibt gemerkt (für das automatische Fortsetzen der Werkbank)
  _leeren(); merkeIn(datei); zu = false;
  const alt = process.env.BRIDGE_QUEUE_MAX_MIN; process.env.BRIDGE_QUEUE_MAX_MIN = '1';
  t = 100_000;
  const z = warte({ key: 'z', userId: 'u', vorrang: false }, { ...o(), melde: () => { t += 61_000; } });
  assert.equal(await z, 'zeit');
  if (alt === undefined) delete process.env.BRIDGE_QUEUE_MAX_MIN; else process.env.BRIDGE_QUEUE_MAX_MIN = alt;
  _leeren(); merkeIn(datei);
  // Gegenprüfung 05.11. (Teil 1, B2): der alte Platz zählt für die Reihenfolge, NICHT für den Zeitdeckel — sonst liefe der
  // Deckel beim Wiederkommen sofort ab (Schleife mit dem Auto-weiter ohne Abstand).
  process.env.BRIDGE_QUEUE_MAX_MIN = '1';
  t = 200_000;
  const z2 = warte({ key: 'z', userId: 'u', vorrang: false }, o());
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(inSchlange('z')?.since, 100_000);
  assert.ok(inSchlange('z'), 'wartet noch — kein sofortiger Zeitdeckel');
  if (alt === undefined) delete process.env.BRIDGE_QUEUE_MAX_MIN; else process.env.BRIDGE_QUEUE_MAX_MIN = alt;
  zu = true; wecke(); await z2;
  _leeren(); merkeIn(null);
});

test('Pass C: ungültige Wartezeit fällt auf 45 min zurück (nie ewig warten)', () => {
  const alt = process.env.BRIDGE_QUEUE_MAX_MIN;
  process.env.BRIDGE_QUEUE_MAX_MIN = 'vierzig';
  assert.equal(maxWarteMs(), 45 * 60_000);
  process.env.BRIDGE_QUEUE_MAX_MIN = '0.5';
  assert.equal(maxWarteMs(), 60_000);
  if (alt === undefined) delete process.env.BRIDGE_QUEUE_MAX_MIN; else process.env.BRIDGE_QUEUE_MAX_MIN = alt;
});
