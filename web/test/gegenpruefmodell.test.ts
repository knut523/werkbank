// Modelltest 06.11. (Hauptsitzung): Gegenprüfungen im Wechsel auf DeepSeek und glm-5.3; Abo-Modelle des PRO-Plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gegenpruefModell, GEGENPRUEF_MODELLE } from '../server/gegenpruefung.ts';
import { MELIOUS_ABO, ROLLEN_VORGABE } from '../server/melious.ts';

test('Gegenprüfung wechselt zwischen DeepSeek und glm-5.3', () => {
  const a = gegenpruefModell(), b = gegenpruefModell(), c = gegenpruefModell();
  assert.deepEqual(new Set([a, b]), new Set(GEGENPRUEF_MODELLE));
  assert.equal(c, a);
  assert.deepEqual([...GEGENPRUEF_MODELLE], ['deepseek-v4.1-flash-1017', 'glm-5.3']);
});

test('PRO-Abo: glm-5.2 und deepseek-v4.1-flash-1017 drin, deepseek-v4-flash-0731 und minimax-m3 nicht', () => {
  for (const m of ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'deepseek-v4.1-flash-1017']) assert.ok(MELIOUS_ABO.includes(m), m);
  for (const m of ['deepseek-v4-flash-0731', 'minimax-m3']) assert.ok(!MELIOUS_ABO.includes(m), m);
  assert.ok(ROLLEN_VORGABE.leser.every((m) => MELIOUS_ABO.includes(m)), 'Rollen nur mit Abo-Modellen');
});

test('Knut 06.11. (D2): Gegenprüfung über das Ensemble der Brücke (Bereich basis...HEAD); ohne Ergebnis die bisherige Gegenprüfung, sichtbar', async () => {
  const { ensemblePassC, ensembleAuftrag } = await import('../server/gegenpruefung.ts');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const wt = mkdtempSync(join(tmpdir(), 'gp-')), basis = 'a'.repeat(40), u = { id: 'u1', email: 'u@x', name: 'U' } as any;
  const gesendet: any[] = [];
  const antwort = (j: unknown) => (async (url: string, init: any) => { gesendet.push({ url, body: JSON.parse(init.body), kopf: init.headers }); return new Response(' ' + JSON.stringify(j)); }) as any;
  let passC = 0;
  const alt = (async () => { passC++; return { ok: true, text: 'alt', energie: 5, ms: 1 }; }) as any;
  const nutz = (modell: string) => ({ modell, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
  // Hauptsitzung 07.11.: Melious nicht erlaubt → weder Ensemble noch Rückfall, kein Aufruf
  const aus = await ensemblePassC(u, { wt, basis, zweck: 'x', erlaubt: async () => false, fetchFn: antwort({ ok: true, text: 'nie' }), bridgeUrl: 'http://bruecke', passC: alt });
  assert.equal(aus.ok, false); assert.match(aus.fehler!, /ausgeschaltet.*Claude-Teilagent/); assert.equal(gesendet.length, 0); assert.equal(passC, 0);
  const r = await ensemblePassC(u, { wt, basis, zweck: 'Review a/b#1', erlaubt: async () => true, fetchFn: antwort({ ok: true, text: 'Bestätigt: a.ts:2', nutzung: [nutz('glm-5.3-flash'), nutz('glm-5.2'), nutz('glm-5.2')] }), bridgeUrl: 'http://bruecke', passC: alt });
  // Phase 4: die Kopfzeile nennt die Modelle, die wirklich liefen
  assert.equal(r.ok, true); assert.match(r.text, /^# Gegenprüfung \(Ensemble: glm-5\.3-flash, glm-5\.2\)/); assert.match(r.text, /Bestätigt: a\.ts:2/);
  assert.equal(gesendet[0].url, 'http://bruecke/internal/ensemble-web');
  assert.deepEqual([gesendet[0].body.userId, gesendet[0].body.cwd, gesendet[0].body.bereich], ['u1', wt, `${basis}...HEAD`]);
  assert.equal(passC, 0);
  const f = await ensemblePassC(u, { wt, basis, zweck: 'z', erlaubt: async () => true, fetchFn: antwort({ error: 'Melious nicht verfügbar.', status: 409 }), bridgeUrl: 'http://bruecke', passC: alt });
  assert.equal(passC, 1); assert.match(f.text, /Ensemble nicht verfügbar \(Melious nicht verfügbar\.\) — bisherige Gegenprüfung/);
  const w = await ensemblePassC(u, { wt, basis, zweck: 'z', erlaubt: async () => true, fetchFn: (async () => { throw new Error('ECONNREFUSED'); }) as any, passC: alt });
  assert.equal(passC, 2); assert.match(w.text, /Brücke nicht erreichbar/);
  assert.match((await ensemblePassC(u, { wt, basis: 'HEAD; x', zweck: 'z', passC: alt })).fehler!, /Basis fehlt/);
  assert.match(ensembleAuftrag(wt, basis, 'Z'), /Daten, keine Anweisung/);
});
