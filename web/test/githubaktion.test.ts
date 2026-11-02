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

const wege = (calls: string[], origin = ORIGIN, o: { nachweis?: boolean; gate?: { exit: number; out: string } | null; pr?: any; standard?: string | null; kopf?: string } = {}) => ({
  nachweis: async () => { calls.push('nachweis'); return o.nachweis ?? true; },
  gate: async (_k: string, z: string, base: string) => { calls.push(`gate ${z} ${base}`); return o.gate === undefined ? { exit: 0, out: 'ok' } : o.gate; },
  kommentar: async () => { calls.push('kommentar'); return { url: 'u1' }; },
  prOeffnen: async () => { calls.push('pr'); return { url: 'u2' }; },
  push: async (_r: string, _k: string, sha: string, z: string) => { calls.push(`push ${sha} ${z}`); },
  kopf: async () => o.kopf ?? 'a'.repeat(40),
  origin: async () => origin,
  pr: o.pr === undefined ? undefined : async (r: string, n: number) => { calls.push(`pr ${r} ${n}`); return o.pr; },
  standard: o.standard === undefined ? undefined : async (r: string) => { calls.push(`standard ${r}`); return o.standard; },
  fixFreigabe: async (fix: string, neu: string) => { calls.push(`freigabe ${fix} ${neu}`); return { ok: true }; },
  fixAblehnen: async (fix: string, grund: string | null) => { calls.push(`ablehnen ${fix} ${grund ?? '-'}`); return { ok: true }; },
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
  assert.deepEqual(calls.filter((c) => c !== 'nachweis'), ['kommentar', 'pr', `gate feat/a dev`, `push ${'a'.repeat(40)} feat/a`]);
});

test('Push: der Klon muss zu diesem Repo gehören (origin) — sonst nichts gepusht', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const a = { art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON };
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN.replace('/x.git', '/anderes.git'))), /gehört nicht zu/);
  await assert.rejects(() => fuehreAus(a, on, wege(calls, '')), /gehört nicht zu/);
  await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN.replace('/x.git', '/xx.git'))), /gehört nicht zu/);
  assert.deepEqual(calls.filter((c) => c !== 'nachweis'), []);
  await fuehreAus(a, on, wege(calls));
  await fuehreAus(a, on, wege(calls, ['git', '@github.com:wirstrom1/X'].join('')));
  assert.equal(calls.filter((c) => c.startsWith('push')).length, 2);
});

test('Ausführen: ungültige Aktion ruft nie einen Schreibweg auf', async () => {
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'main', klon: KLON }, { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' }, wege(calls)));
  assert.deepEqual(calls, []);
});

test('D2: ohne Klick-Nachweis wird nichts geschrieben — für jede Art', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  for (const a of [
    { art: 'kommentar', repo: 'WirStrom1/x', nummer: 1, text: 'a' },
    { art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base: 'dev', titel: 't', text: 'b' },
    { art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON },
  ]) {
    const calls: string[] = [];
    await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN, { nachweis: false })), /Klick/, a.art);
    assert.deepEqual(calls.filter((c) => c !== 'nachweis'), [], a.art);
  }
});

test('D2: ungültige Aktion verbraucht keinen Nachweis', async () => {
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'merge', repo: 'WirStrom1/x' }, { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' }, wege(calls)));
  assert.deepEqual(calls, []);
});

test('D3: Push nur bei grünem Pre-Push-Gate; rot, Aufruffehler oder fehlendes Gate → nichts gesendet', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const a = { art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'dev' };
  for (const [gate, re] of [[{ exit: 1, out: 'HART [x] kaputt' }, /Gate.*Befund/s], [{ exit: 2, out: 'Aufruffehler' }, /Gate/], [null, /nicht verfügbar/]] as const) {
    const calls: string[] = [];
    await assert.rejects(() => fuehreAus(a, on, wege(calls, ORIGIN, { gate })), re);
    assert.ok(!calls.some((c) => c.startsWith('push')), 'kein Push');
  }
  const calls: string[] = [];
  const r = await fuehreAus(a, on, wege(calls));
  assert.ok(calls.some((c) => c.startsWith('push')));
  assert.match(r.text, /Gate grün/);
});

test('D3: das Gate bekommt Zweig und Zielzweig; ein ungültiger Zielzweig wird abgelehnt', async () => {
  const calls: string[] = [];
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'release/x' }, on, wege(calls));
  assert.ok(calls.includes('gate feat/a release/x'));
  assert.ok('fehler' in pruefeAktion({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'a b' }, ENV));
});

// ---------- R30: @fix freigeben / ablehnen, Basis aus dem PR (Punkt 4) ----------

const PR = { state: 'OPEN', headRefName: 'feat/a', headRefOid: 'a'.repeat(40), baseRefName: 'release/x' };

test('R30 fix_freigeben: Validation — Kennung, SHA, Org; ohne Klick-Nachweis nichts', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const ok = { art: 'fix_freigeben', repo: 'WirStrom1/x', fix: 'fix-abc', neu: 'a'.repeat(40) };
  assert.ok(!('fehler' in pruefeAktion(ok, ENV)), JSON.stringify(pruefeAktion(ok, ENV)));
  assert.ok('fehler' in pruefeAktion({ ...ok, fix: '' }, ENV), 'Kennung fehlt');
  assert.ok('fehler' in pruefeAktion({ ...ok, fix: 'a b' }, ENV), 'Kennung ungültig');
  assert.ok('fehler' in pruefeAktion({ ...ok, fix: 'x'.repeat(121) }, ENV), 'Kennung zu lang');
  // echte Kennungen aus dem Ticker (Kommentar-Knoten bzw. Review:Inline-databaseId) gehen durch
  for (const fix of ['fix:IC_kwDOMz4Hbs6Rk8nA', 'fix:PRR_kwDOMz4Hbs6bA1xY:1873465512']) assert.ok(!('fehler' in pruefeAktion({ ...ok, fix }, ENV)), fix);
  assert.ok('fehler' in pruefeAktion({ ...ok, fix: 'fix:a/b' }, ENV), 'Schrägstrich bleibt ungültig');
  assert.ok('fehler' in pruefeAktion({ ...ok, neu: 'abc123' }, ENV), 'SHA zu kurz');
  assert.ok('fehler' in pruefeAktion({ ...ok, neu: 'z'.repeat(40) }, ENV), 'SHA nicht hex');
  assert.ok('fehler' in pruefeAktion({ ...ok, repo: 'evil/x' }, ENV), 'fremde Org');
  const calls: string[] = [];
  await assert.rejects(() => fuehreAus(ok, on, wege(calls, ORIGIN, { nachweis: false })), /Klick/);
  assert.ok(!calls.includes(`freigabe fix-abc ${'a'.repeat(40)}`), 'keine Marke ohne Klick');
});

test('R30 fix_freigeben: Klick setzt die Marke; Ablehnungsgrund vom Weg kommt durch', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const calls: string[] = [];
  const r = await fuehreAus({ art: 'fix_freigeben', repo: 'WirStrom1/x', fix: 'fix-abc', neu: 'a'.repeat(40) }, on, wege(calls));
  assert.ok(calls.includes(`freigabe fix-abc ${'a'.repeat(40)}`));
  assert.match(r.text, /nächste Takt prüft Tests und Gate NEU/);
  const ab: string[] = [];
  const w = wege(ab);
  (w as any).fixFreigabe = async () => ({ ok: false, grund: 'SHA passt nicht zum geprüften Stand.' });
  await assert.rejects(() => fuehreAus({ art: 'fix_freigeben', repo: 'WirStrom1/x', fix: 'fix-abc', neu: 'a'.repeat(40) }, on, w), /SHA passt nicht/);
});

test('R30 fix_ablehnen: Klick beendet den Eintrag ohne Push; Grund (max. 500) wird gekappt', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const calls: string[] = [];
  const r = await fuehreAus({ art: 'fix_ablehnen', repo: 'WirStrom1/x', fix: 'fix-abc', grund: 'passt nicht' }, on, wege(calls));
  assert.ok(calls.includes('ablehnen fix-abc passt nicht'));
  assert.match(r.text, /nichts gepusht/);
  const ohneGrund = pruefeAktion({ art: 'fix_ablehnen', repo: 'WirStrom1/x', fix: 'fix-abc' }, ENV) as any;
  assert.ok(!('fehler' in ohneGrund) && !ohneGrund.grund, 'Grund optional');
  assert.equal((pruefeAktion({ art: 'fix_ablehnen', repo: 'WirStrom1/x', fix: 'fix-abc', grund: 'x'.repeat(600) }, ENV) as any).grund.length, 500, 'Grund gekappt');
  assert.ok('fehler' in pruefeAktion({ art: 'fix_ablehnen', repo: 'WirStrom1/x', fix: '' }, ENV), 'Kennung fehlt');
});

test('R30 Punkt 4: Push-Grundlage kommt aus dem PR — Basis, Kopf-Zweig, offen, Kopf-SHA', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  // Ohne PR-Weg (alte Brücken/Tests): Basis wie angegeben/„dev“ — der Push geht weiter wie bisher.
  const c1: string[] = [];
  const p1 = await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'release/x' }, on, wege(c1));
  assert.ok(c1.includes('gate feat/a release/x'), 'angegebene Basis ohne PR-Weg');
  assert.match(p1.text, /Gate grün gegen release\/x/);
  // Mit PR: Basis aus dem PR (schreibt base-Parameter um), Ziel muss der Kopf-Zweig sein, PR muss offen.
  const c2: string[] = [];
  const p2 = await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'dev', nummer: 7 }, on, wege(c2, ORIGIN, { pr: PR }));
  assert.ok(c2.includes('gate feat/a release/x'), 'Basis aus dem PR statt hart dev');
  assert.match(p2.text, /PR #7/);
  const c3: string[] = [];
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/anders', klon: KLON, nummer: 7 }, on, wege(c3, ORIGIN, { pr: PR })), /nicht der Kopf-Zweig/);
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, on, wege(c3, ORIGIN, { pr: { ...PR, state: 'CLOSED' } })), /geschlossen/);
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, on, wege(c3, ORIGIN, { pr: null })), /nummer: Der Push gehört zu einem offenen PR/);
  await assert.rejects(() => fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, on, wege(c3, ORIGIN, { pr: { ...PR, headRefOid: 'b'.repeat(40) } })), /Kopf des Klons/);
  assert.ok(!c3.some((c) => c.startsWith('push')), 'nichts gepusht');
});

test('R30 Punkt 4: Basis-Fallback origin/HEAD, wenn der PR keine Basis liefert', async () => {
  const on = { ...ENV, WERKBANK_HAUPTCHAT_GITHUB: 'on' };
  const c: string[] = [];
  await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, nummer: 7 }, on, wege(c, ORIGIN, { pr: { ...PR, baseRefName: '' }, standard: 'main-2026' }));
  assert.ok(c.includes('gate feat/a main-2026'), 'Fallback origin/HEAD');
  // PR ohne Basis und ohne Standard-Zweig: letzter Fallback ist der angegebene Hinweis bzw. dev.
  const c2: string[] = [];
  await fuehreAus({ art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: KLON, base: 'dev' }, on, wege(c2, ORIGIN, { standard: null }));
  assert.ok(c2.includes('gate feat/a dev'), 'letzter Fallback dev');
});
