import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bauerFuer, inSchutzzone, inSonnetzone, tamperGruende, waehle, rennen, nachAblehnung, Semaphor, neueStatistik, zaehle, abgeschaltet, bestofnAn, bauerDeckelMs, diffGroesse, pruefLauf, groupKill, OPUS, SONNET, VERLIERER_MS, type Deps, type Schnell, type BauErgebnis } from '../src/bauerrennen.ts';
import { laeuft, gruppeWeg } from '../src/prozesse.ts';
import { FLASH, DEEPSEEK, GLM } from '../src/modellwahl.ts';

const gruen: Schnell = { tsc: true, lint: true, tests: true };
const diffN = (n: number, datei = 'src/a.ts') => `diff --git a/${datei} b/${datei}\n--- a/${datei}\n+++ b/${datei}\n` + Array.from({ length: n }, (_, i) => `+zeile ${i}`).join('\n');
const A = { id: 't1', plan: 'p', dateien: ['src/a.ts'] };
const mk = (o: Record<string, { diff: string; ok?: boolean; schnell?: Schnell }>): Deps & { aufrufe: string[]; ev: any[] } => {
  const aufrufe: string[] = [], ev: any[] = [];
  return { aufrufe, ev,
    bauen: async (b) => { aufrufe.push(b); return { bauer: b, ok: o[b]?.ok ?? true, diff: o[b]?.diff ?? '' }; },
    schnell: async (k) => o[k.bauer]?.schnell ?? gruen,
    ledger: (e) => ev.push(e) };
};

test('Schutzzonen-Routing: Migrationen/Auth/Billing/Workflows/.env → Opus allein, sonst beide Flash-Bauer', () => {
  for (const d of ['db/migrations/001.sql', 'src/auth/login.ts', 'web/billing/x.ts', 'src/abrechnung/a.ts', 'x/payment/y.ts', '.github/workflows/ci.yml', '.env.local', 'app/.env.prod']) {
    assert.ok(inSchutzzone([d], {}), d); assert.deepEqual(bauerFuer([d], {}), [OPUS], d);
  }
  assert.deepEqual(bauerFuer(['src/a.ts', 'README.md'], {}), [FLASH, DEEPSEEK]);
  assert.deepEqual(bauerFuer(['src/auth.ts'], {}), [FLASH, DEEPSEEK], 'auth.ts ist keine auth-Ordner');
  assert.deepEqual(bauerFuer(['src/geheim/x.ts'], { BRIDGE_SCHUTZZONEN: 'src/geheim/**' }), [OPUS], 'konfigurierbar');
  assert.deepEqual(bauerFuer(['src/a.ts'], { BRIDGE_BESTOFN: 'aus' }), [FLASH]);
});

test('Sonnet-Klasse: kapazitaet.ts → sonnet, Schutzzone schlägt Sonnetzone, meliousLeer, BRIDGE_SONNETZONEN überschreibt', () => {
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], {}), [SONNET], 'Kapazität ist Geld → Sonnet');
  assert.deepEqual(bauerFuer(['src/kontofuehrung.ts'], {}), [SONNET], '*konto* Glob');
  assert.deepEqual(bauerFuer(['src/a.ts'], {}, undefined, true), [SONNET], 'Melious leer → Sonnet');
  assert.deepEqual(bauerFuer(['src/a.ts'], {}, undefined, false), [FLASH, DEEPSEEK], 'ohne Sonnet-Grund wie bisher');
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], { BRIDGE_SONNETKLASSE: 'aus' }), [FLASH, DEEPSEEK], 'Env-Abschaltung');
  // Schutzzone bleibt vorrangig: auth/kapazitaet.ts → Opus
  assert.deepEqual(bauerFuer(['src/auth/kapazitaet.ts'], {}), [OPUS]);
  assert.ok(inSonnetzone(['web/accounts.ts'], {}));
  assert.deepEqual(bauerFuer(['src/eigen/x.ts'], { BRIDGE_SONNETZONEN: 'src/eigen/**' }), [SONNET], 'überschreibbar');
  assert.deepEqual(bauerFuer(['src/kapazitaet.ts'], { BRIDGE_SONNETZONEN: 'src/eigen/**' }), [FLASH, DEEPSEEK], 'Überschreibung ersetzt die Vorgabe');
});

test('Tamper-Guard: entfernte Assertion, geänderte Zeile, Skip-Marker, gelöschte Testdatei; neue Tests sind erlaubt', () => {
  const t = 'test/a.test.ts';
  const kopf = `diff --git a/${t} b/${t}\n--- a/${t}\n+++ b/${t}\n`;
  assert.equal(tamperGruende(kopf + '-  assert.equal(a, 1);\n+  assert.equal(a, 2);').length, 1);
  assert.equal(tamperGruende(kopf + "+test.skip('x', () => {});").length, 1);
  assert.equal(tamperGruende(kopf + "+it.only('x', () => {});").length, 1);
  assert.equal(tamperGruende(`diff --git a/${t} b/${t}\ndeleted file mode 100644\n--- a/${t}\n+++ /dev/null\n-x`).length, 1);
  assert.deepEqual(tamperGruende(kopf + "+test('neu', () => assert.ok(1));"), []);
  assert.deepEqual(tamperGruende(`diff --git a/test/n.test.ts b/test/n.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/test/n.test.ts\n+x`), []);
  assert.deepEqual(tamperGruende(diffN(3).replace(/-/g, '-')), [], 'Quellcode ist frei');
});

test('Tamper-Guard: erweiterte Import-Zeile (auch mehrzeilig) ist kein Tamper, entfernte Assertion daneben schon', () => {
  const t = 'test/a.test.ts';
  const kopf = `diff --git a/${t} b/${t}\n--- a/${t}\n+++ b/${t}\n`;
  assert.deepEqual(tamperGruende(kopf + "-import { a } from '../src/a.ts';\n+import { a, b } from '../src/a.ts';\n+test('b', () => assert.ok(b()));"), []);
  assert.deepEqual(tamperGruende(kopf + "-import {\n-  a,\n-} from '../src/a.ts';\n+import {\n+  a,\n+  b,\n+} from '../src/a.ts';"), []);
  assert.equal(tamperGruende(kopf + "-import { a } from '../src/a.ts';\n+import { a, b } from '../src/a.ts';\n-  assert.equal(a(), 1);").length, 1);
});

test('Auswahl: Tamper disqualifiziert den kleineren Diff; sonst kleinerer Diff; Gleichstand → glm-flash; Repro/tsc/Tests rot raus', () => {
  const tamper = `diff --git a/test/a.test.ts b/test/a.test.ts\n--- a/test/a.test.ts\n+++ b/test/a.test.ts\n-assert.ok(1)\n`;
  const w1 = waehle([{ bauer: FLASH, ok: true, diff: tamper, schnell: gruen }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: gruen }]);
  assert.equal(w1.sieger?.bauer, DEEPSEEK); assert.match(w1.abgelehnt[0].grund, /Tamper/);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(9), schnell: gruen }, { bauer: DEEPSEEK, ok: true, diff: diffN(4), schnell: gruen }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: DEEPSEEK, ok: true, diff: diffN(4), schnell: gruen }, { bauer: FLASH, ok: true, diff: diffN(4), schnell: gruen }]).sieger?.bauer, FLASH);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(2), schnell: { ...gruen, tsc: false } }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: gruen }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: FLASH, ok: true, diff: diffN(2), schnell: { ...gruen, repro: false } }, { bauer: DEEPSEEK, ok: true, diff: diffN(9), schnell: { ...gruen, repro: true } }]).sieger?.bauer, DEEPSEEK);
  assert.equal(waehle([{ bauer: FLASH, ok: false, diff: '' }]).sieger, null);
});

test('Semaphor: höchstens 3 Prüfläufe gleichzeitig, der Rest wartet in der Schlange', async () => {
  const s = new Semaphor(3); let lauf = 0, spitze = 0;
  const frei: (() => void)[] = [];
  const ps = Array.from({ length: 7 }, () => s.run(async () => { spitze = Math.max(spitze, ++lauf); await new Promise<void>((r) => frei.push(r)); lauf--; }));
  await new Promise((r) => setImmediate(r));
  assert.equal(lauf, 3); assert.equal(s.wartend, 4);
  while (frei.length || lauf) { frei.shift()?.(); await new Promise((r) => setImmediate(r)); }
  await Promise.all(ps);
  assert.equal(spitze, 3); assert.equal(s.spitze, 3);
});

test('Rennen: beide bauen, Sieger gewählt, Verlierer 24 h aufgehoben, Ledger meldet bauer/sieger/abgelehnt', async () => {
  const d = mk({ [FLASH]: { diff: diffN(8) }, [DEEPSEEK]: { diff: diffN(3) } });
  const l = await rennen(d, A, { env: {} });
  assert.deepEqual(d.aufrufe.sort(), [DEEPSEEK, FLASH].sort());
  assert.equal(l.sieger?.bauer, DEEPSEEK); assert.equal(l.verlierer?.bauer, FLASH);
  assert.deepEqual(d.ev[0].bauer, [FLASH, DEEPSEEK]); assert.equal(d.ev[0].sieger, DEEPSEEK); assert.equal(d.ev[0].abgelehnt[0].bauer, FLASH);
});

test('Rennen: Schutzzone → nur Opus; beide scheitern → glm-5.3 mit beiden Fehlerlogs', async () => {
  const d1 = mk({ [OPUS]: { diff: diffN(2, 'db/migrations/1.sql') } });
  const l1 = await rennen(d1, { ...A, dateien: ['db/migrations/1.sql'] }, { env: {} });
  assert.deepEqual(d1.aufrufe, [OPUS]); assert.equal(l1.sieger?.bauer, OPUS);
  const logs: string[][] = [];
  const d2 = mk({ [FLASH]: { diff: diffN(2), schnell: { ...gruen, tsc: false, log: 'TSFEHLER' } }, [DEEPSEEK]: { diff: diffN(2), schnell: { ...gruen, lint: false, log: 'LINTFEHLER' } }, [GLM]: { diff: diffN(5) } });
  const b = d2.bauen; d2.bauen = (x, a, o) => { if (o?.fehlerlogs) logs.push(o.fehlerlogs); return b(x, a, o); };
  const l2 = await rennen(d2, A, { env: {} });
  assert.equal(l2.sieger?.bauer, GLM); assert.ok(d2.aufrufe.includes(GLM));
  const text = logs[0].join('\n'); assert.match(text, /TSFEHLER/); assert.match(text, /LINTFEHLER/);
  assert.deepEqual(d2.ev[0].bauer, [FLASH, DEEPSEEK, GLM]);
});

test('Ablehnung: erst Verlierer-Diff (24 h), danach Fixrunden, nach 2 abgelehnten Fixrunden → glm-5.3', async () => {
  const d = mk({ [FLASH]: { diff: diffN(8) }, [DEEPSEEK]: { diff: diffN(3) } });
  const l = await rennen(d, A, { env: {} });
  const t0 = l.verlierer!.at;
  const f1 = nachAblehnung(l, 'Review: Mangel 1', t0 + 1000);
  assert.deepEqual([f1.art, f1.bauer], ['verlierer', FLASH]);
  assert.equal(nachAblehnung(l, 'm2', t0 + 2000).art, 'fix');
  assert.equal(nachAblehnung(l, 'm3', t0 + 3000).art, 'fix');
  const e = nachAblehnung(l, 'm4', t0 + 4000);
  assert.equal(e.art, 'eskalation'); assert.equal(e.bauer, GLM); assert.equal((e as any).fehlerlogs.length, 4);
  // nach Ablauf der 24 h kein Verlierer-Retry
  const l2 = await rennen(d, A, { env: {} });
  assert.equal(nachAblehnung(l2, 'x', l2.verlierer!.at + VERLIERER_MS + 1).art, 'fix');
});

test('Abschaltregel: Zweitbauer < 15 % nach 30 Läufen → aus; Env BRIDGE_BESTOFN=aus', () => {
  const s = neueStatistik();
  for (let i = 0; i < 29; i++) zaehle(s, FLASH);
  assert.equal(abgeschaltet(s, {}), false, 'erst ab 30 Läufen');
  zaehle(s, FLASH);
  assert.equal(abgeschaltet(s, {}), true);
  const ok = neueStatistik(); for (let i = 0; i < 30; i++) zaehle(ok, i < 5 ? DEEPSEEK : FLASH);
  assert.equal(abgeschaltet(ok, {}), false, '5/30 ≥ 15 %');
  assert.equal(abgeschaltet(neueStatistik(), { BRIDGE_BESTOFN: 'aus' }), true); assert.equal(bestofnAn({ BRIDGE_BESTOFN: 'aus' }), false);
  assert.deepEqual(bauerFuer(['a.ts'], {}, s), [FLASH], 'abgeschaltet → nur glm-flash');
});

// ---- Zeitdeckel (wb21/i-f-deckel): ein zu großer Punkt ist ein Signal an den Plan, keine Eskalation --------------------------------
test('Deckel-Vorgabe: BRIDGE_BAUER_DECKEL_S, ungültig/leer/0 → 600 s', () => {
  assert.equal(bauerDeckelMs({}), 600_000);
  assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: '30' }), 30_000);
  assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: '0.05' }), 50);
  for (const x of ['', '  ', 'x', '0', '-5']) assert.equal(bauerDeckelMs({ BRIDGE_BAUER_DECKEL_S: x }), 600_000, JSON.stringify(x));
});

const mkLahm = (b: Record<string, { ms: number; n: number }>): Deps & { aufrufe: string[]; ev: any[] } => {
  const aufrufe: string[] = [], ev: any[] = [];
  return { aufrufe, ev,
    bauen: async (x) => { aufrufe.push(x); await new Promise((r) => setTimeout(r, b[x]?.ms ?? 400)); return { bauer: x, ok: true, diff: diffN(b[x]?.n ?? 3) }; },
    schnell: async () => gruen,
    ledger: (e) => ev.push(e) };
};
test('Zeitdeckel: beide Bauer zu langsam → zerlegen: true, kein GLM-Aufruf', async () => {
  const d = mkLahm({ [FLASH]: { ms: 400, n: 3 }, [DEEPSEEK]: { ms: 400, n: 2 } });
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.zerlegen, true); assert.equal(l.sieger, null);
  assert.equal(d.aufrufe.includes(GLM), false, 'keine Eskalation an glm-5.3');
  assert.deepEqual(d.ev[0].bauer, [FLASH, DEEPSEEK]);
});
test('Zeitdeckel: nur ein Bauer zu langsam → der schnelle siegt (ohne Deckel gewänne der kleinere Diff), kein zerlegen', async () => {
  const d = mkLahm({ [FLASH]: { ms: 0, n: 6 }, [DEEPSEEK]: { ms: 400, n: 2 } });
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.sieger?.bauer, FLASH); assert.equal(!!l.zerlegen, false);
  assert.equal(d.aufrufe.includes(GLM), false);
  assert.equal(diffGroesse(l.sieger!.diff), 6);
});

// ---- P7: Prüflauf ohne Shell, eigene Prozessgruppe ----
test('P7: Dateiname mit $(…) wird nicht von einer Shell ausgeführt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  await pruefLauf(cwd, 'node', ['--test', 'x$(touch PWNED).test.ts']);
  assert.equal(existsSync(join(cwd, 'PWNED')), false);
});
test('P7: Timeout tötet die ganze Gruppe (Enkel sleep 600)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  const r = await pruefLauf(cwd, 'sh', ['-c', 'sleep 600 & echo $$ > pgid; echo $! > enkel; wait'], { timeoutMs: 2000 });
  assert.equal(r.ok, false);
  const enkel = Number(readFileSync(join(cwd, 'enkel'), 'utf8'));
  // 'läuft nicht' = weg oder Zombie; pruefLauf kehrt erst zurück, wenn kein Gruppenmitglied mehr läuft (keine Wartezeit hier).
  assert.equal(laeuft(enkel), false, 'Enkel läuft nicht mehr');
  assert.equal(await gruppeWeg(Number(readFileSync(join(cwd, 'pgid'), 'utf8')), 0), true, 'Gruppe weg');
});
test('P7: Kill einer toten Gruppe wirft nicht', () => {
  assert.doesNotThrow(() => groupKill(2 ** 22 - 1));
});
test('P7: Kind endet mit 0, Enkel hält die Pipe → Rückkehr schnell, ok, Gruppe tot', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'p7-'));
  const t0 = Date.now();
  const r = await pruefLauf(cwd, 'sh', ['-c', 'sleep 600 & echo $! > enkel; echo $$ > pgid; exit 0'], { timeoutMs: 30000 });
  assert.ok(Date.now() - t0 < 3000, `dauerte ${Date.now() - t0} ms`);
  assert.equal(r.ok, true);
  assert.equal(laeuft(Number(readFileSync(join(cwd, 'enkel'), 'utf8'))), false, 'Enkel läuft nicht mehr');
});

// ---- P8: Deckel bricht den Bauer ab (Signal), statt ihn im Hintergrund auslaufen zu lassen -----------------------------------------
test('P8: Deckel → Signal des Bauers abgebrochen, rennen wartet auf sein Ende', async () => {
  const signale: AbortSignal[] = []; let beendet = false;
  const d: Deps = {
    bauen: (x, _a, o) => new Promise((res) => { signale.push(o!.signal!); setTimeout(() => res({ bauer: x, ok: false, diff: '', log: 'spät' }), 600); o!.signal?.addEventListener('abort', () => setTimeout(() => { beendet = true; res({ bauer: x, ok: false, diff: '', log: 'abgebrochen' }); }, 20)); }),
    schnell: async () => gruen };
  const l = await rennen(d, A, { env: { BRIDGE_BAUER_DECKEL_S: '0.05' } });
  assert.equal(l.zerlegen, true);
  assert.ok(signale.length >= 2 && signale.every((s) => s.aborted), 'jedes Signal nach dem Deckel abgebrochen');
  assert.equal(beendet, true, 'Rückkehr erst, nachdem der Bauer den Abbruch bestätigt hat');
});
