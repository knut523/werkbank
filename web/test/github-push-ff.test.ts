import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, pruefeAktion } from '../server/githubaktion.ts';

// Hotfix 03.11.2026 (Knut): Fix-Push als Fast-Forward über dem PR-Kopf; olaf-docs main als einzige Ausnahme vom Schutz.
const HOME = '/home/test'; const KLON = `${HOME}/work/knut/klon`;
const ENV = { HOME, WERKBANK_HAUPTCHAT_GITHUB: 'on' } as any;
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const PR = { state: 'OPEN', headRefName: 'feat/a', headRefOid: A, baseRefName: 'develop' };
const wege = (calls: string[], o: { origin?: string; kopf?: string; pr?: any; vorfahre?: boolean } = {}) => ({
  nachweis: async () => true,
  gate: async () => ({ exit: 0, out: 'ok' }),
  kommentar: async () => ({ url: null }), prOeffnen: async () => ({ url: null }),
  push: async (_r: string, _k: string, sha: string, z: string) => { calls.push(`push ${sha} ${z}`); },
  kopf: async () => o.kopf ?? B,
  origin: async () => o.origin ?? 'https://github.com/WirStrom1/x.git',
  pr: async () => o.pr ?? null,
  standard: async () => 'main',
  ...(o.vorfahre === undefined ? {} : { vorfahre: async (_k: string, v: string) => { calls.push(`vorfahre ${v}`); return o.vorfahre!; } }),
});

test('Fix über dem PR-Kopf (Fast-Forward) wird gepusht', async () => {
  const c: string[] = [];
  const r = await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, ENV, wege(c, { pr: PR, vorfahre: true }) as any);
  assert.ok(c.includes(`push ${B} feat/a`), JSON.stringify(c)); assert.match(r.text, /Gepusht/);
});
test('PR-Kopf ist kein Vorfahre → abgelehnt, nichts gepusht', async () => {
  const c: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, ENV, wege(c, { pr: PR, vorfahre: false }) as any), /kein Fast-Forward/);
  assert.ok(!c.some((x) => x.startsWith('push')));
});
test('olaf-docs main: geht nur als Fast-Forward auf origin/main, ohne PR', async () => {
  const D = { origin: 'https://github.com/WirStrom1/olaf-docs.git' };
  assert.ok(!('fehler' in pruefeAktion({ art: 'push', repo: 'WirStrom1/olaf-docs', zweig: 'main', klon: KLON }, ENV)));
  const c: string[] = [];
  await fuehreAus({ art: 'push', repo: 'WirStrom1/olaf-docs', zweig: 'main', klon: KLON }, ENV, wege(c, { ...D, vorfahre: true }) as any);
  assert.ok(c.includes('vorfahre origin/main') && c.includes(`push ${B} main`), JSON.stringify(c));
  const c2: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/olaf-docs', zweig: 'main', klon: KLON }, ENV, wege(c2, { ...D, vorfahre: false }) as any), /kein Fast-Forward auf origin\/main/);
  assert.ok(!c2.some((x) => x.startsWith('push')));
});
test('main/develop in jedem anderen Repo bleibt gesperrt', () => {
  for (const [repo, zweig] of [['WirStrom1/olaf-admin', 'main'], ['WirStrom1/olaf-admin', 'develop'], ['WirStrom1/olaf-docs', 'develop'], ['WirStrom1/olaf-tariff-app', 'master']])
    assert.match(String((pruefeAktion({ art: 'push', repo, zweig, klon: KLON }, ENV) as any).fehler), /geschützt/, `${repo} ${zweig}`);
});

test('Schutzpfade (Paket G): Weg githubaktion push — schutz meldet nicht ok → nichts gepusht; ok → Push; schutzGo wird durchgereicht', async () => {
  const c: string[] = [];
  const w = { ...wege(c, { pr: PR, vorfahre: true }), schutz: async (x: any) => { c.push(`schutz go=${x.schutzGo} base=${x.base}`); return x.schutzGo ? { ok: true } : { ok: false, grund: 'Schutzpfade berührt (db/migrations/1.sql)' }; } };
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, ENV, w as any), /Schutzpfade berührt.*nichts gepusht/);
  assert.ok(!c.some((x) => x.startsWith('push ')), JSON.stringify(c));
  const r = await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7, schutzGo: true }, ENV, w as any);
  assert.match(r.text, /Gepusht/); assert.ok(c.includes('schutz go=true base=develop'));
});
