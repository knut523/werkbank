// „Braucht dich“-Klassifikation (R30b Teil A): jede „Braucht Knut“-Zeile wird (a) echte Entscheidung für Knut,
// (b) Aktion des Hauptchats oder (c) erledigt/veraltet — drei reale Beispiele aus der Hauptsitzung 02.11. als Fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klassifiziere, BRAUCHT_AN } from '../server/braucht.ts';

// Beispiel 1 (Hauptsitzung 02.11.): Admin-UAT-Strang — Knut hatte schon geantwortet, Karte stand trotzdem offen.
const B1_ZEILE = 'Liste mit Skill-Kopierpfad abarbeiten und D1–D3 entscheiden';
// Beispiel 2: Ticker-Fix, Paket 269, Commit 5899146 — längst in Release 29 live.
const B2_ZEILE = 'Push-Ok für den Zweig, D1 entscheiden, nach dem Deploy die CLI laufen lassen';
// Beispiel 3: tariff-app#193 — technische Aktion, die der Hauptchat ausführen kann.
const B3_ZEILE = 'Merge muss in diesem Strang erlaubt werden oder der Hauptchat führt ihn aus';

const beantwortet = (kennung: string) => kennung === 'b-uat-1' || kennung === 'D1';
const livePaket = (nr: number) => nr === 269;
const aktionen = ['push-nach-gate', 'merge-im-worktree', 'skill-installieren', 'strang-neustarten', 'cli-lesen'];

/** Ein Kontext wie ihn die Werkbank zur Zeile zusammenstellen kann (alles schon vorhanden, nur lesen). */
const ctx = (o: Partial<Parameters<typeof klassifiziere>[1]> = {}) => ({
  kennung: 'b-x', beantwortet: (_k: string) => false, paketLive: (_n: number) => false, prZu: (_pr: string) => null as boolean | null,
  laufNeuere: (_l: string) => false, hauptchatAktionen: [] as string[], ...o,
});

test('Schalter WERKBANK_BRAUCHT_DICH: Vorgabe aus, „an“ schaltet frei', () => {
  assert.equal(BRAUCHT_AN({}), false);
  assert.equal(BRAUCHT_AN(undefined), false);
  assert.equal(BRAUCHT_AN({ WERKBANK_BRAUCHT_DICH: 'an' }), true);
  assert.equal(BRAUCHT_AN({ WERKBANK_BRAUCHT_DICH: '1' }), false, 'nur der Wert „an“ schaltet');
});

test('Beispiel 1 (Admin-UAT): schon beantwortet → (c) veraltet mit Begründung', () => {
  const r = klassifiziere(B1_ZEILE, ctx({ kennung: 'b-uat-1', beantwortet }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund, /beantwortet/i);
});

test('Beispiel 2 (Ticker-Fix Paket 269): Paket im Live-Stand → (c) veraltet mit Begründung', () => {
  const r = klassifiziere(B2_ZEILE, ctx({ paket: 269, paketLive: livePaket }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund, /live|release/i);
});

test('Beispiel 2 variationsreich: genannte Paketnummer wird aus der Zeile/Karte gezogen, Commit-Abstammung allein genügt nicht', () => {
  // paketLive ist die Aussage „genanntes Paket ist im Live-Stand“ (Merge-Commit nach Nummer, releasestand.ts) —
  // hier nur der Inhaltsweg, nicht die Git-Abstammung. Ohne Live-Beleg: keine (c)-Einstufung.
  const r = klassifiziere(B2_ZEILE, ctx());
  assert.equal(r.art, 'entscheidung', 'ohne Beleg bleibt es eine Frage, kein stilles Schließen');
});

test('Beispiel 3 (tariff-app#193): Merge-Anweisung → (b) Hauptchat-Aktion mit Aktionstext', () => {
  const r = klassifiziere(B3_ZEILE, ctx({ hauptchatAktionen: aktionen }));
  assert.equal(r.art, 'aktion');
  assert.equal(r.aktion, 'merge-im-worktree');
  assert.match(r.wasTun, /Hauptchat/i);
});

test('Beispiel 3 ohne freigegebene Aktionen: bleibt Entscheidung für Knut', () => {
  const r = klassifiziere(B3_ZEILE, ctx());
  assert.equal(r.art, 'entscheidung');
});

test('(a) echte Entscheidung: Was-du-tun-musst-Satz statt Rohbericht, EmpfehlunggetOptionen', () => {
  const r = klassifiziere('Vertrag mit Rogue soll bis Freitag unterschrieben sein — zustimmen?', ctx());
  assert.equal(r.art, 'entscheidung');
  assert.ok(r.wasTun.length > 10, 'ein Satz, den Knut versteht');
});

test('Aktionen erkennen Muster: Push/CLI/Skill/Neustart', () => {
  assert.equal(klassifiziere('Push freigeben, danach CLI laufen lassen', ctx({ hauptchatAktionen: aktionen })).aktion, 'push-nach-gate');
  assert.equal(klassifiziere('Skill im Repo installieren (Kopierpfad beachten)', ctx({ hauptchatAktionen: aktionen })).aktion, 'skill-installieren');
  assert.equal(klassifiziere('Strang nach Fehler neu starten', ctx({ hauptchatAktionen: aktionen })).aktion, 'strang-neustarten');
  assert.equal(klassifiziere('nach dem Deploy die CLI laufen lassen', ctx({ hauptchatAktionen: aktionen })).aktion, 'cli-lesen');
});

test('Veraltete Prüfung: geschlossener/gemergter PR', () => {
  const r = klassifiziere(B3_ZEILE, ctx({ hauptchatAktionen: aktionen, pr: 'WirStrom1/olaf-tariff-app#193', prZu: () => true }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund, /gemergt|geschlossen/i);
});

test('Veraltete Prüfung: neuerer Strang mit gleichem Ziel (lauf)', () => {
  const r = klassifiziere('D1–D3 vom Admin-UAT entscheiden', ctx({ lauf: 'admin-uat', laufNeuere: () => true }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund, /neuerer/i);
});

test('Veraltet schlägt Aktion: beides trifft zu → geschlossen mit beiden Gründen', () => {
  const r = klassifiziere(B2_ZEILE, ctx({ beantwortet, paketLive: livePaket, hauptchatAktionen: aktionen }));
  assert.equal(r.art, 'veraltet');
  assert.match(r.grund, /beantwortet/);
});
