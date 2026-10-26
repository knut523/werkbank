// R29 D / S5: GitHub schreiben aus dem Hauptchat — nur geprüfte Aktionen (Kommentar, PR öffnen, Branch pushen), nie mergen,
// nie geschützte Zweige, nur freigegebene Orgs, Push nur aus einem Klon dieses Repos unter dem Arbeitsbaum;
// Schalter WERKBANK_HAUPTCHAT_GITHUB, Vorgabe aus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubAktionAn, pruefeAktion, fuehreAus } from '../server/githubaktion.ts';

const ENV = { HOME: '/h' } as Record<string, string | undefined>;
const KLON = '/h/work/wt';
const ORIGIN = ['https://', 'github.com/WirStrom1/x.git'].join('');

test('Schalter: Vorgabe aus, nur „on“ schaltet ein', () => {
  assert.equal(githubAktionAn({}), false);
  assert.equal(githubAktionAn({ WERKBANK_HAUPTCHAT_GITHUB: 'on' }), true);
  for (const v of ['true', '1', 'ON', 'off']) assert.equal(githubAktionAn({ WERKBANK_HAUPTCHAT_GITHUB: v }), false, v);
});

test('Kommentar: gültig', () => {
  const r = pruefeAktion({ art: 'kommentar', repo: 'WirStrom1/olaf-admin', nummer: 12, text: 'Thanks — fixed in abc1234.' }, ENV);
  assert.ok(!('fehler' in r), JSON.stringify(r));
});

test('Kommentar: leerer Text, falsche Nummer, fremde Org werden abgelehnt', () => {
  assert.ok('fehler' in pruefeAktion({ art: 'kommentar', repo: 'WirStrom1/x', nummer: 1, text: '  ' }, ENV));
  assert.ok('fehler' in pruefeAktion({ art: 'kommentar', repo: 'WirStrom1/x', nummer: 0, text: 'a' }, ENV));
  assert.ok('fehler' in pruefeAktion({ art: 'kommentar', repo: 'evil/x', nummer: 1, text: 'a' }, ENV));
  assert.ok('fehler' in pruefeAktion({ art: 'kommentar', repo: 'WirStrom1-evil/x', nummer: 1, text: 'a' }, ENV));
});

test('PR öffnen: Quell- und Zielzweig geprüft, Quelle nie geschützt', () => {
  const ok = pruefeAktion({ art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base: 'dev', titel: 'feat: a', text: 'Body' }, ENV);
  assert.ok(!('fehler' in ok));
  for (const head of ['main', 'develop', 'dev', 'release/1', '../x', 'a b']) {
    assert.ok('fehler' in pruefeAktion({ art: 'pr_oeffnen', repo: 'WirStrom1/x', head, base: 'dev', titel: 't', text: 'b' }, ENV), head);
  }
  assert.ok('fehler' in pruefeAktion({ art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base: 'dev', titel: '', text: 'b' }, ENV));
  for (const base of ['', '../x', 'a b', 'x:y']) assert.ok('fehler' in pruefeAktion({ art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base, titel: 't', text: 'b' }, ENV), base);
});

test('Push: nie auf geschützte Zweige (auch Groß-/Kleinschreibung), Klon nur unter dem Arbeitsbaum', () => {
  assert.ok(!('fehler' in pruefeAktion({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON }, ENV)));
  for (const zweig of ['main', 'MAIN', 'Dev', 'release/1', 'Hotfix/x']) assert.ok('fehler' in pruefeAktion({ art: 'push', repo: 'WirStrom1/x', zweig, klon: KLON }, ENV), zweig);
  for (const klon of ['rel/wt', '/vault', '/h/.ssh', '/h/work', '/h/workx/y', '/h/work/../.ssh', '/tmp/wt']) {
    assert.ok('fehler' in pruefeAktion({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon }, ENV), klon);
  }
});

test('unbekannte Art (merge!) wird abgelehnt — auch mit sonst vollständig gültigen Feldern', () => {
  const voll = { repo: 'WirStrom1/x', nummer: 1, head: 'feat/a', base: 'dev', titel: 't', text: 'b', zweig: 'feat/a', klon: KLON };
  for (const art of ['merge', 'pr_mergen', 'force_push', 'pr_schliessen', '']) assert.match(String((pruefeAktion({ ...voll, art }, ENV) as any).fehler), /Mergen gibt es hier nicht/, art);
});

const wege = (calls: string[], origin = ORIGIN) => ({
  kommentar: async () => { calls.push('kommentar'); return { url: 'u1' }; },
  prOeffnen: async () => { calls.push('pr'); return { url: 'u2' }; },
  push: async (_r: string, _k: string, sha: string, z: string) => { calls.push(`push ${sha} ${z}`); },
  kopf: async () => 'a'.repeat(40),
  origin: async () => origin,
});

test('Ausführen: aus → nichts passiert; an → genau der passende Schreibweg', async () => {
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'kommentar', repo: 'WirStrom1/x', nummer: 1, text: 'a' }, ENV, wege(calls)), /aus/);
  assert.deepEqual(calls, []);
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  assert.equal((await fuehreAus({ art: 'kommentar', repo: 'WirStrom1/x', nummer: 1, text: 'a' }, on, wege(calls))).url, 'u1');
  assert.equal((await fuehreAus({ art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base: 'dev', titel: 't', text: 'b' }, on, wege(calls))).url, 'u2');
  const p = await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON }, on, wege(calls));
  assert.match(p.text, /feat\/a/);
  assert.deepEqual(calls, ['kommentar', 'pr', `push ${'a'.repeat(40)} feat/a`]);
});

test('Push: der Klon muss zu diesem Repo gehören (origin) — sonst nichts gepusht', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const a = { art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON };
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN.replace('/x.git', '/anderes.git'))), /gehört nicht zu/);
  await assert.rejects(() => fuehreAus(a, on, wege(calls, '')), /gehört nicht zu/);
  await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN.replace('/x.git', '/xx.git'))), /gehört nicht zu/);
  assert.deepEqual(calls, []);
  await fuehreAus(a, on, wege(calls));
  await fuehreAus(a, on, wege(calls, ['git', '@github.com:wirstrom1/X'].join('')));
  assert.equal(calls.length, 2);
});

test('Ausführen: ungültige Aktion ruft nie einen Schreibweg auf', async () => {
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'main', klon: KLON }, { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' }, wege(calls)));
  assert.deepEqual(calls, []);
});
