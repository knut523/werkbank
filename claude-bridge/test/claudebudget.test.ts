import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as b from '../src/claudebudget.ts';
import { kapazitaetGrund } from '../src/kapazitaet.ts';
import { planQueue, type Account } from '../src/accounts.ts';

const T0 = Date.parse('2026-11-08T10:00:00Z');
const H = 3_600_000;
const cswap = (accs: any[]) => ({ accounts: accs });
const acc = (number: number, f: number, w: number, ahead = false, resetsAt?: number) => ({ number, usage: { fiveHour: { pct: f }, sevenDay: { pct: w, aheadOfPace: ahead, resetsAt } } });
const lage = (id: string, f: number, w: number, ahead = false, resetWoche: number | null = T0 + 100 * H): b.KontoLage => ({ id, status: 'ok', fuenfH: f, siebenT: w, vorPlan: ahead, resetFuenfH: T0 + 2 * H, resetWoche });
beforeEach(() => b.budgetVergessen());

test('1 Grenzen: zählt, was zuerst bricht; aheadOfPace kommt von cswap', () => {
  const l = b.kontenLage(cswap([acc(1, 90, 20, true)]), { k1: '1' })[0];
  assert.equal(l.vorPlan, true);
  assert.deepEqual(b.grenzen(lage('a', 90, 20), T0), { luft: 5, bindend: '5h' });     // 100-5-90
  assert.equal(b.grenzen(lage('b', 10, 97), T0).bindend, 'woche');                      // Rest 3 < 5h-Luft
  assert.equal(b.grenzen(lage('c', 10, 50), T0).bindend, 'tempo');                      // Burst 18 < 85 < 90
});

test('2 Eimer: Burst-Deckel, Nachladung, Ausschöpfen vor Wochenreset', () => {
  const l = lage('a', 0, 50);
  assert.equal(b.budgetStand(l, T0).level, 18);
  b.entnehmen('a', 18, T0);
  const s = b.budgetStand(l, T0 + 10 * H);                 // Rate 50/90h Resthorizont → +5,56
  assert.ok(Math.abs(s.level - 500 / 90) < 1e-9, String(s.level));
  assert.equal(b.budgetStand(lage('v', 0, 50, true), T0).ratePerH, 0);                   // vor Plan: keine Nachladung
  const nah = b.budgetStand(lage('n', 0, 5, false, T0 + 6 * H), T0);
  assert.equal(nah.cap, 95); assert.ok(nah.hoch && nah.ausschoepfen);
});

test('3 Konto unbekannt: gesperrt bis Probe, Breaker + Backoff; Konto 3 per Konfig', async () => {
  const karte = b.kontoKarte({ BRIDGE_CLAUDE_KONTO_MAP: 'chat:1,k2:2,k3:3' });
  assert.deepEqual(Object.keys(karte), ['chat', 'k2', 'k3']);
  b.aktualisiere(cswap([acc(1, 10, 10), acc(3, 5, 5), { number: 2 }]), karte);
  assert.equal(b.lageVon('k2')!.status, 'unbekannt'); assert.equal(b.lageVon('k3')!.status, 'ok');
  assert.equal(b.kontoFrei('k2'), false); assert.equal(b.kontoFrei('k3'), true); assert.equal(b.kontoFrei('unregistriert'), true);
  const mk = (id: string): Account => ({ id, label: id, token: 't-' + id });
  assert.deepEqual(planQueue([mk('chat'), mk('k2'), mk('k3')], {}, { conv: 'c', chatOn: false }).map((a) => a.id).sort(), ['chat', 'k3']);
  let n = 0;
  assert.equal(await b.probeKonto('k2', async () => { n++; return false; }, T0), 'wartet');
  assert.equal(await b.probeKonto('k2', async () => { n++; return true; }, T0 + 1000), 'wartet'); assert.equal(n, 1);   // Backoff
  assert.equal(await b.probeKonto('k2', async () => { n++; throw new Error('x'); }, T0 + 2 * 60_000), 'wartet');
  assert.equal(await b.probeKonto('k2', async () => false, T0 + 10 * 60_000), 'offen');                                // Breaker
  assert.equal(b.kontoFrei('k2'), false);
  assert.equal(await b.probeKonto('k2', async () => true, T0 + 2 * H), 'frei');
  assert.equal(b.kontoFrei('k2'), true);
});

test('4 Endprüfung: gebündelt je Ereignis, nur Sonnet-geprüft, Konto mit Luft und Woche < 85', () => {
  const konten = [lage('a', 10, 90), lage('b', 10, 40), lage('c', 10, 60)];
  const p = b.endpruefungPlanen([{ id: 'e1', items: [{ id: 'x', sonnetOk: true }, { id: 'y', sonnetOk: true }, { id: 'z', sonnetOk: false }] }, { id: 'e2', items: [{ id: 'q', sonnetOk: false }] }], konten, { now: T0, kosten: (n) => n * 2 });
  assert.deepEqual(p[0], { ereignis: 'e1', items: ['x', 'y'], konto: 'b', zurueck: ['z'], reservierung: 4 });
  assert.equal(p[1].konto, null);
  const nur = b.endpruefungPlanen([{ id: 'e', items: [{ id: 'x', sonnetOk: true }] }], [lage('a', 10, 92), lage('c', 10, 88)], { now: T0, kosten: () => 1 });
  assert.equal(nur[0].konto, 'c');   // keins < 85 % → geringste Woche
});

test('5 Alle heiß: Rang 0 Reserve, sonst Melious, sonst Warteschlange; nie Opus, nie hämmern', () => {
  const heiss = [lage('a', 96, 50), lage('b', 99, 50)];
  const mel = { modell: 'glm-5.3' };
  assert.equal(b.verteile([lage('a', 10, 50), lage('b', 60, 50)], { rang: 2, modell: 'opus', melious: mel, now: T0 }).art, 'claude');
  const r0 = b.verteile(heiss, { rang: 0, modell: 'sonnet', melious: mel, now: T0 });
  assert.ok(r0.art === 'claude' && r0.reserve && r0.konto === 'a');
  const m = b.verteile(heiss, { rang: 1, modell: 'opus', melious: mel, now: T0 });
  assert.ok(m.art === 'melious' && m.modell !== 'opus');
  const w = b.verteile(heiss, { rang: 1, modell: 'opus', melious: null, now: T0 });
  assert.ok(w.art === 'warte' && /braucht dich/.test(w.meldung) && w.bis >= T0 + 5 * 60_000);
  const w0 = b.verteile([lage('a', 99.5, 50)], { rang: 0, modell: 'opus', melious: null, now: T0 });
  assert.equal(w0.art, 'warte');
});

test('6 Kalibrierung: % je 1 Mio. Token je Modell, Reservierung 3× Median (×1,2 unsicher)', () => {
  for (let i = 0; i < 5; i++) b.zugNotieren({ modell: 'claude-opus-5', tokens: 1e6, deltaPct: 2 + (i === 4 ? 10 : 0) });
  for (let i = 0; i < 5; i++) b.zugNotieren({ modell: 'sonnet', tokens: 2e6, deltaPct: 1 });
  const k = b.kalibriere();
  assert.equal(k.opus.pctJe1M, 2); assert.equal(k.sonnet.pctJe1M, 0.5);
  assert.equal(b.reservierung('opus', 1e6, k), 6);
  assert.ok(Math.abs(b.reservierung('opus', 1e6, k, { unsicher: true }) - 7.2) < 1e-9);
  assert.ok(Math.abs(b.reservierung('haiku', 1e6, k) - 7.2) < 1e-9);   // unbekanntes Modell → unsicher
});

test('7 Hauptchat-Tagesbudget, Tageswechsel, Einhängung in kapazitaetGrund, Schalter', () => {
  const env = { BRIDGE_HAUPTCHAT_TAGES_PCT: '10' };
  assert.equal(b.claudeBudgetGrund({ rolle: 'hauptchat' }, T0, env), '');
  b.hauptchatBuchen(10, T0);
  assert.match(b.claudeBudgetGrund({ rolle: 'hauptchat' }, T0, env), /Tagesbudget/);
  assert.equal(b.claudeBudgetGrund({ rolle: 'strang' }, T0, env), '');
  assert.equal(b.claudeBudgetGrund({ rolle: 'hauptchat' }, T0 + 24 * H, env), '');
  const k = { meliousProzent: 90, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 0 };
  const o = { neu: false, bauend: false, rolle: 'hauptchat' };
  const alt = process.env.BRIDGE_HAUPTCHAT_TAGES_PCT; process.env.BRIDGE_HAUPTCHAT_TAGES_PCT = '10';
  try {
    assert.match(kapazitaetGrund(k, o, {}), /Tagesbudget/);
    assert.equal(kapazitaetGrund(k, o, { BRIDGE_CLAUDEBUDGET: 'aus' }), '');
  } finally { if (alt === undefined) delete process.env.BRIDGE_HAUPTCHAT_TAGES_PCT; else process.env.BRIDGE_HAUPTCHAT_TAGES_PCT = alt; }
});
