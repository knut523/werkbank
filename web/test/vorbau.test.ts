// G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md): Fixtures A–G als lokale Git-Repos (origin = Bare-Repo unter
// …/WirStrom1/<repo>.git) und eine nachgebaute GitHub-GraphQL-API. Kein Aufruf geht an GitHub; der Credential-Helper
// ist ein Prüfling, der jeden Aufruf mitschreibt. Fixture E spielt den Fall Kohorte (Plan 090, Branch
// feat/kohorte-stand-heute, Spec deutsch) mit den echten SHAs aus den lokalen Klonen nach (olaf-admin #269 = 3b17596d,
// olaf-docs #49 = 578e8433).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pruefe, decide, parsePlan, ganzesWort, slugProblem, bilanz, protokolliere, g0Optionen, type Fakten } from '../server/vorbau.ts';

const T = mkdtempSync(join(tmpdir(), 'vorbau-'));
const ME = { GIT_AUTHOR_NAME: 'knut523', GIT_AUTHOR_EMAIL: 'knut.peters@maxenergy.at', GIT_COMMITTER_NAME: 'knut523', GIT_COMMITTER_EMAIL: 'knut.peters@maxenergy.at' };
const CHRIS = { GIT_AUTHOR_NAME: 'bizarrochris', GIT_AUTHOR_EMAIL: 'chris@example.org', GIT_COMMITTER_NAME: 'bizarrochris', GIT_COMMITTER_EMAIL: 'chris@example.org' };
const git = (cwd: string, args: string[], who: Record<string, string> = ME) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...who, GIT_CONFIG_GLOBAL: GLOBAL, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
const GLOBAL = join(T, 'gitconfig');
const HELPER_LOG = join(T, 'helper.log');
const PUSH_LOG = join(T, 'push-helper.log');
const TOKEN_OK = join(T, 'token-ok');

function commit(dir: string, files: Record<string, string>, msg: string, who = ME) {
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); }
  git(dir, ['add', '-A'], who); git(dir, ['commit', '-q', '-m', msg], who);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** Seed (alle Commits) → Bare-origin unter WirStrom1/<name>.git → Arbeitsklon (origin/HEAD = Integrationszweig). */
function repo(name: string, integ: string, build: (seed: string) => void): string {
  const seed = join(T, 'seed', name);
  mkdirSync(seed, { recursive: true });
  git(seed, ['init', '-q', '-b', integ]);
  commit(seed, { 'README.md': `# ${name}\n` }, 'init');
  build(seed);
  git(seed, ['checkout', '-q', integ]);
  const origin = join(T, 'gh', 'WirStrom1', `${name}.git`);
  mkdirSync(join(T, 'gh', 'WirStrom1'), { recursive: true });
  git(T, ['clone', '-q', '--bare', seed, origin]);
  const work = join(T, 'work', name);
  git(T, ['clone', '-q', origin, work]);
  return work;
}

// ---------- nachgebaute GitHub-API ----------
const API: Record<string, { offen: any[]; gemergt: any[] }> = {};
let apiStatus = 200;
const apiAuth: string[] = [];
let srv: Server;
const pr = (repo: string, n: number, o: Partial<{ title: string; body: string; head: string; oid: string; author: string; files: string[]; merge: string }>) => ({
  number: n, title: o.title ?? `PR ${n}`, body: o.body ?? '', url: `https://github.com/WirStrom1/${repo}/pull/${n}`, headRefName: o.head ?? `feat/x-${n}`, headRefOid: o.oid ?? 'f'.repeat(40),
  author: { login: o.author ?? 'bizarrochris' }, files: { nodes: (o.files ?? ['src/a.ts']).map((path) => ({ path })) }, ...(o.merge ? { mergeCommit: { oid: o.merge } } : {}),
});

before(async () => {
  writeFileSync(TOKEN_OK, '1');
  // Prüfling-Helper: schreibt Umgebung je Aufruf mit; Token nur mit GIT_VW_READ=1 und wenn token-ok existiert.
  const helper = join(T, 'helper.sh');
  writeFileSync(helper, `#!/usr/bin/env bash\n[ "$1" = get ] || exit 0\ncat >/dev/null\necho "READ=\${GIT_VW_READ:-} ITEM=\${GIT_VW_ITEM:-}" >> ${HELPER_LOG}\n[ "\${GIT_VW_READ:-}" = 1 ] && [ -f ${TOKEN_OK} ] && { echo username=x-access-token; echo password=ghp_LESETOKENtest; }\nexit 0\n`);
  chmodSync(helper, 0o755);
  // Falle: ein geerbter Helper mit Push-Token darf nie gefragt werden.
  const trap = join(T, 'push-helper.sh');
  writeFileSync(trap, `#!/usr/bin/env bash\necho called >> ${PUSH_LOG}\necho username=x; echo password=ghp_PUSHTOKEN\n`);
  chmodSync(trap, 0o755);
  writeFileSync(GLOBAL, `[credential]\n\thelper = ${trap}\n[init]\n\tdefaultBranch = main\n`);
  process.env.GIT_CONFIG_GLOBAL = GLOBAL;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.VORBAU_CRED_HELPER = helper;
  process.env.GIT_VW_ITEM = 'Github TOken wirstrom push';   // wird von G0 entfernt
  process.env.VORBAU_ICH = 'knut523,knut.peters@maxenergy.at';
  process.env.VORBAU_PROTOKOLL = join(T, 'g0.jsonl');
  process.env.VORBAU_VAULT_ROADMAP = join(T, 'vault');
  mkdirSync(join(T, 'vault', 'Cockpit', '5-Live'), { recursive: true });
  srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      apiAuth.push(String(req.headers.authorization ?? ''));
      if (apiStatus !== 200) { res.writeHead(apiStatus); return res.end('{}'); }
      const { variables: v } = JSON.parse(b);
      const r = API[v.name];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { repository: r ? { offen: { nodes: r.offen }, gemergt: { nodes: r.gemergt } } : null } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as any).port}`;
});
after(() => { srv?.close(); delete process.env.GIT_VW_ITEM; rmSync(T, { recursive: true, force: true }); });

const planDatei = (name: string, text: string) => { const p = join(T, 'plaene', name); mkdirSync(join(T, 'plaene'), { recursive: true }); writeFileSync(p, text); return p; };
const run = (slug: string, repos: string[], o: { plan?: string; ohnePr?: boolean } = {}) => pruefe({ slug, repos, planDatei: o.plan ?? null, ohnePr: o.ohnePr, aufrufer: 'test' });

// ---------- reine Teile ----------

test('Slug: mindestens zwei Segmente; Teilstring ist kein ganzes Wort (DoD 5)', () => {
  assert.match(slugProblem('bank')!, /zwei Segmenten/);
  assert.equal(slugProblem('bank-partner'), null);
  assert.equal(ganzesWort('feat: cockpit-tab-bank-partner', 'bank-partner'), false);
  assert.equal(ganzesWort('feat: cockpit-tab-bank-partner', 'cockpit-tab-bank-partner'), true);
  assert.equal(ganzesWort('Bank-Partner im Cockpit', 'bank-partner'), true);
});

test('Plan-Identität: spec:/branch: im Frontmatter; Altplan: **Spec:** und Branch aus dem Fließtext (DoD 19)', () => {
  const p = parsePlan('---\nspec: cockpit-spec-kohorte\nbranch: feat/kohorte-heute\ncreated: 2026-10-01\n---\n# x', 'plans/095-kohorte-heute.md');
  assert.deepEqual([p.spec, p.branch, p.nummer, p.planSlug, p.created], ['cockpit-spec-kohorte', 'feat/kohorte-heute', '095', 'kohorte-heute', '2026-10-01']);
  const alt = parsePlan('# 090\n\n**Repo:** olaf-admin. Branch `feat/kohorte-stand-heute`, cut from x.\n**Spec:** [[cockpit-spec-kohorte-laufender-monat]]\n', 'plans/090-cohort-running-month.md');
  assert.deepEqual([alt.spec, alt.specHeader, alt.branch], [null, 'cockpit-spec-kohorte-laufender-monat', 'feat/kohorte-stand-heute']);
  assert.equal(parsePlan('**Spec:** no vault spec checked for this change.').specHeader, null);
});

const leer = (o: Partial<Fakten> = {}): Fakten => ({ ich: ['knut523'], plan: null, specZitiertePlaene: [], plaeneAufInteg: [], gemergt: [], offen: [], lokal: [], fremdeAenderung: null, autorKriterium: true, ...o });

test('Pläne ohne spec: und ohne **Spec:** → Hinweis „Identität unbekannt“, kein stilles frei (DoD 19)', () => {
  const r = decide('neue-sache', leer({ plan: parsePlan('# Plan ohne Kopf', 'plans/100-neue-sache.md') }));
  assert.equal(r.ergebnis, 'frei');
  assert.ok(r.hinweise.some((h) => /Identität unbekannt/.test(h)));
});

test('≥ 50 %-Regel nur als Hinweis, erst ab 3 Plandateien (DoD 6)', () => {
  assert.equal(decide('x-y', leer({ fremdeAenderung: { repo: 'r', geaendert: 2, von: 4 } })).hinweise.filter((h) => /Fremde Commits/.test(h)).length, 1);
  assert.equal(decide('x-y', leer({ fremdeAenderung: { repo: 'r', geaendert: 2, von: 4 } })).ergebnis, 'frei');
  assert.equal(decide('x-y', leer({ fremdeAenderung: { repo: 'r', geaendert: 2, von: 2 } })).hinweise.length, 0, 'unter 3 Dateien kein Hinweis');
  assert.equal(decide('x-y', leer({ fremdeAenderung: { repo: 'r', geaendert: 1, von: 3 } })).hinweise.length, 0, 'unter 50 %');
});

test('Knöpfe: Treffer drei; Stopp nur „trotzdem bauen“ (+ „ohne PR-Prüfung bauen“ tagsüber, wenn nur die API fehlt)', () => {
  assert.deepEqual(g0Optionen({ ergebnis: 'treffer', slug: 'a-b', belege: [], hinweise: [], kriterien: [] }).map((o) => o.label), ['trotzdem bauen', 'auf Vorhandenem aufsetzen', 'Spec nachziehen/abräumen']);
  const ohne = { ergebnis: 'stopp' as const, slug: 'a-b', belege: [], hinweise: [], kriterien: [], stopp: { grund: 'lesetoken' as const, text: '', knopf: null } };
  assert.deepEqual(g0Optionen(ohne).map((o) => o.label), ['trotzdem bauen', 'Spec nachziehen/abräumen']);
  const api = { ...ohne, stopp: { grund: 'pr-api' as const, text: '', knopf: 'ohne PR-Prüfung bauen' as const } };
  assert.ok(g0Optionen(api).some((o) => o.label === 'ohne PR-Prüfung bauen'));
  assert.ok(!g0Optionen(api, true).some((o) => o.label === 'ohne PR-Prüfung bauen'), 'nachts kein Knopf');
});

// ---------- Fixtures über git + Mock-API ----------

let admin: string, docs: string, fremdSha: string, eigenSha: string;
test('Aufbau der Fixture-Repos', () => {
  admin = repo('olaf-admin', 'develop', (s) => {
    // A: fremder Code-PR, per Merge-Commit auf develop.
    git(s, ['checkout', '-q', '-b', 'feat/bonus-zeitreihe'], CHRIS);
    fremdSha = commit(s, { 'src/coupons.ts': 'x' }, 'feat: bonus', CHRIS);
    git(s, ['checkout', '-q', 'develop'], CHRIS);
    git(s, ['merge', '-q', '--no-ff', 'feat/bonus-zeitreihe', '-m', 'Merge pull request #301 from WirStrom1/feat/bonus-zeitreihe', '-m', 'Bonuscode-Zeitreihe'], CHRIS);
    git(s, ['branch', '-q', '-D', 'feat/bonus-zeitreihe'], CHRIS);
    // E: der echte Squash-Titel von olaf-admin #269 (3b17596d).
    commit(s, { 'src/lib/cockpit/retention.ts': 'x' }, 'feat(cockpit): cohort heatmap — the running month as of today, and reconstructed cells before status recording began (plan 090) (#269)');
    // 6: Plandateien, später von Christoph geändert.
    commit(s, { 'src/a/one.ts': '1', 'src/a/two.ts': '2', 'src/a/three.ts': '3', 'src/a/four.ts': '4', 'package.json': '{}' }, 'base files');
    commit(s, { 'src/a/one.ts': '1b', 'src/a/two.ts': '2b', 'package.json': '{"a":1}' }, 'chris changes', CHRIS);
  });
  // D: eigener lokaler Branch mit Commit (Head-SHA eines eigenen PRs).
  git(admin, ['checkout', '-q', '-b', 'feat/akte-mehrere-vertraege']);
  eigenSha = commit(admin, { 'src/akte.ts': 'x' }, 'wip akte');
  git(admin, ['checkout', '-q', 'develop']);
  docs = repo('olaf-docs', 'main', (s) => {
    // E: Plan 090, echter Kopf (olaf-docs 578e8433, Autor knut523).
    commit(s, { 'plans/090-cohort-running-month-and-reconstruction.md': readFileSync(new URL('./fixtures/vorbau/090-kopf.md', import.meta.url), 'utf8') }, 'plans(090): cohort heatmap — the running month as of today, and the closest thing before recording began (#49)');
    // F: eigener gemergter Plan-PR (nur plans/) mit branch: feat/hardware-termine.
    commit(s, { 'plans/101-hardware-termine.md': '---\nspec: admin-spec-hardware-termine-kalender\nbranch: feat/hardware-termine\n---\n# 101\n' }, 'plans: 101 hardware termine (#60)');
    // F: fremder Plan mit fremdem branch:.
    commit(s, { 'plans/102-service-replay-spur.md': '---\nspec: service-spec-replay-spur\nbranch: feat/replay-chris\n---\n# 102\n' }, 'plans: 102 replay (#61)', CHRIS);
    // F2: fremder Plan, anderer Dateiname, passendes spec:.
    commit(s, { 'plans/103-anders-benannt.md': '---\nspec: cockpit-spec-aussenumsatz\nbranch: feat/umsatz-x\n---\n# 103\n' }, 'plans: 103 (#62)', CHRIS);
  });
  API['olaf-admin'] = {
    offen: [
      pr('olaf-admin', 310, { title: 'Leads: Einwilligung', head: 'feat/leads-einwilligung-neu', author: 'bizarrochris' }),            // B
      pr('olaf-admin', 311, { title: 'Akte: mehrere Verträge', head: 'feat/akte-mehrere-vertraege', author: 'knut523', oid: eigenSha }), // D
      pr('olaf-admin', 312, { title: 'cockpit-tab-bank-partner', head: 'feat/cockpit-tab-bank-partner', author: 'bizarrochris' }),      // 5
      pr('olaf-admin', 313, { title: 'Zählpunkte', head: 'feat/zaehlpunkte-filter', author: 'Kurama07a', oid: 'a'.repeat(40) }),         // G
    ],
    gemergt: [
      pr('olaf-admin', 301, { title: 'Bonuscode-Zeitreihe', head: 'feat/bonus-zeitreihe', author: 'bizarrochris', merge: 'MERGE301' }),
      pr('olaf-admin', 269, { title: 'feat(cockpit): cohort heatmap — the running month as of today, and reconstructed cells before status recording began (plan 090)', head: 'feat/kohorte-stand-heute', author: 'knut523', merge: '3b17596df211a0cdb4b935819d9121e49136322c', files: ['src/lib/cockpit/retention.ts', 'src/components/cockpit/cards/cohort.tsx'] }),
    ],
  };
  // Der API-Merge-SHA für #301 ist der echte Merge-Commit im Fixture.
  API['olaf-admin'].gemergt[0].mergeCommit.oid = git(admin, ['log', '--merges', '-1', '--format=%H', 'origin/develop']);
  API['olaf-docs'] = { offen: [], gemergt: [
    pr('olaf-docs', 49, { title: 'plans(090): cohort heatmap', head: 'docs/plan-090-kohorte', author: 'knut523', merge: '578e843343dc7dd7273bc4bc6c78eb336f168244', files: ['plans/090-cohort-running-month-and-reconstruction.md'] }),
    pr('olaf-docs', 60, { title: 'plans: 101 hardware termine', head: 'feat/hardware-termine', author: 'knut523', merge: 'b'.repeat(40), files: ['plans/101-hardware-termine.md'] }),
  ] };
});

test('Fixture A: gemergter fremder Code-PR mit Head-Branch = branch: des Plans → treffer mit SHA (DoD 1)', async () => {
  const plan = planDatei('120-bonuscode-zeitreihe.md', '---\nspec: cockpit-spec-bonuscode-zeitreihe\nbranch: feat/bonus-zeitreihe\n---\n# 120\n');
  const r = await run('cockpit-spec-bonuscode-zeitreihe', [admin], { plan });
  assert.equal(r.ergebnis, 'treffer');
  const b = r.belege.find((x) => x.art === 'gebaut')!;
  assert.equal(b.sha, API['olaf-admin'].gemergt[0].mergeCommit.oid);
  assert.match(b.pr!, /pull\/301$/);
});

test('Fixture B: Slug als Branch eines offenen fremden PRs → treffer mit PR-Link (DoD 2)', async () => {
  const r = await run('leads-einwilligung-neu', [admin]);
  assert.equal(r.ergebnis, 'treffer');
  assert.equal(r.belege[0].pr, 'https://github.com/WirStrom1/olaf-admin/pull/310');
});

test('Fixture C: frischer Slug → frei (DoD 3)', async () => {
  const r = await run('ganz-neue-sache', [admin, docs]);
  assert.equal(r.ergebnis, 'frei', JSON.stringify(r));
  assert.deepEqual(r.belege, []);
});

test('Fixture D: eigener Branch = branch: mit eigenem PR → fortsetzen, kein Treffer (DoD 4)', async () => {
  const plan = planDatei('121-akte.md', '---\nspec: service-spec-akte-mehrere-vertraege\nbranch: feat/akte-mehrere-vertraege\n---\n');
  const r = await run('service-spec-akte-mehrere-vertraege', [admin], { plan });
  assert.equal(r.ergebnis, 'fortsetzen', JSON.stringify(r.belege));
  assert.ok(r.belege.every((b) => b.wirkung === 'fortsetzen'));
  assert.ok(r.belege.some((b) => b.art === 'eigen') && r.belege.some((b) => b.art === 'lokal'));
});

test('Teilstring: „bank-partner“ trifft cockpit-tab-bank-partner nicht; „bank“ wird abgelehnt (DoD 5)', async () => {
  assert.equal((await run('bank-partner', [admin])).ergebnis, 'frei');
  const r = await run('bank', [admin]);
  assert.equal(r.ergebnis, 'stopp'); assert.equal(r.stopp!.grund, 'eingabe');
});

test('≥ 50 %-Regel über git: 2 von 4 Plandateien fremd geändert, Lockfile/package.json zählen nicht (DoD 6)', async () => {
  const plan = planDatei('122-a.md', '---\nspec: admin-spec-vier-dateien\nbranch: feat/vier-dateien\ncreated: 2026-01-01\n---\n`src/a/one.ts` `src/a/two.ts` `src/a/three.ts` `src/a/four.ts` `package.json`\n');
  const r = await run('admin-spec-vier-dateien', [admin], { plan });
  assert.equal(r.ergebnis, 'frei');
  assert.ok(r.hinweise.some((h) => /2 von 4 Plandateien/.test(h)), r.hinweise.join('|'));
});

test('Fixture E: Vorfall Kohorte mit echten SHAs — Spec-, Plan- und Branch-Slug verschieden, Treffer über **Spec:** (DoD 14)', async () => {
  writeFileSync(join(T, 'vault', 'Cockpit', '5-Live', 'cockpit-spec-kohorte-laufender-monat.md'), readFileSync(new URL('./fixtures/vorbau/cockpit-spec-kohorte-laufender-monat.md', import.meta.url), 'utf8'));
  // Ein zweiter Agent will dieselbe Spec bauen: eigener Plan-Slug, eigener Branch, nur die Kopfzeile **Spec:** verbindet.
  const plan = planDatei('096-kohorte-laufender-monat.md', '# 096 — Kohorte laufender Monat\n\n**Spec:** [[cockpit-spec-kohorte-laufender-monat]]\n**branch:** `feat/kohorte-laufend`\n');
  const r = await run('kohorte-laufend', [admin, docs], { plan });
  assert.equal(r.ergebnis, 'treffer');
  const gebaut = r.belege.find((b) => b.art === 'gebaut' && b.pr?.endsWith('/269'))!;
  assert.equal(gebaut.sha, '3b17596df211a0cdb4b935819d9121e49136322c');
  assert.equal(gebaut.branch, 'feat/kohorte-stand-heute');
  assert.ok(r.belege.some((b) => b.art === 'geplant' && b.pfad === 'plans/090-cohort-running-month-and-reconstruction.md'));
  assert.ok(!r.belege.some((b) => b.pr?.endsWith('/49') && b.art === 'gebaut'), 'Plan-PR #49 ist kein „schon gebaut“');
});

test('Fixture F: eigener gemergter Plan-PR ohne Code → fortsetzen; fremder branch: → treffer (geplant von anderem) (DoD 15)', async () => {
  const eigen = planDatei('101-hardware-termine.md', '---\nspec: admin-spec-hardware-termine-kalender\nbranch: feat/hardware-termine\n---\n');
  const r = await run('admin-spec-hardware-termine-kalender', [docs], { plan: eigen });
  assert.equal(r.ergebnis, 'fortsetzen', JSON.stringify(r.belege));
  const fremd = planDatei('104-replay.md', '---\nspec: service-spec-replay-spur\nbranch: feat/replay-knut\n---\n');
  const r2 = await run('service-spec-replay-spur', [docs], { plan: fremd });
  assert.equal(r2.ergebnis, 'treffer');
  assert.match(r2.belege[0].text, /geplant von anderem: olaf-docs:plans\/102-service-replay-spur\.md/);
});

test('Fixture F2: fremder Plan mit anderem Dateinamen und passendem spec: → treffer (DoD 20)', async () => {
  const r = await run('cockpit-spec-aussenumsatz', [docs]);
  assert.equal(r.ergebnis, 'treffer');
  assert.equal(r.belege[0].pfad, 'plans/103-anders-benannt.md');
});

test('Fixture G: fremder PR mit gleichem Branch-Namen (anderer Autor, Head-SHA nicht lokal) → treffer (DoD 16)', async () => {
  const plan = planDatei('123-zaehlpunkte.md', '---\nspec: admin-spec-zaehlpunkte-filter\nbranch: feat/zaehlpunkte-filter\n---\n');
  const r = await run('admin-spec-zaehlpunkte-filter', [admin], { plan });
  assert.equal(r.ergebnis, 'treffer');
  assert.equal(r.belege[0].art, 'autor');
  assert.deepEqual(r.kriterien, ['autor']);
});

test('Nur Lesetoken: Fetch und PR-API über GIT_VW_READ=1, geerbter Helper und GIT_VW_ITEM wirkungslos (DoD 8, 21)', async () => {
  writeFileSync(HELPER_LOG, ''); apiAuth.length = 0; rmSync(PUSH_LOG, { force: true });
  // Der Helper wird je Repo über `credential fill` gefragt (dasselbe Token für Fetch und PR-API).
  await run('ganz-neue-sache', [admin]);
  const log = readFileSync(HELPER_LOG, 'utf8').trim().split('\n');
  assert.ok(log.length >= 1);
  assert.ok(log.every((l) => l === 'READ=1 ITEM='), log.join('|'));
  assert.ok(!existsSync(PUSH_LOG), 'Push-Helper wurde nie gefragt');
  assert.ok(apiAuth.length > 0 && apiAuth.every((a) => a === 'bearer ghp_LESETOKENtest'));
});

test('Echter git-credential-vaultwarden: G0 fragt nur das Lese-Item, nie das Push-Item (DoD 8, 21)', { skip: !existsSync(join(homedir(), 'bin', 'git-credential-vaultwarden')) && 'Helper nicht installiert' }, () => {
  const fakeHome = join(T, 'home'); mkdirSync(join(fakeHome, '.config', 'vw'), { recursive: true }); mkdirSync(join(T, 'fbin'), { recursive: true });
  writeFileSync(join(fakeHome, '.config', 'vw', 'session'), 'TEST');
  const bwLog = join(T, 'bw.log');
  writeFileSync(join(T, 'fbin', 'bw'), `#!/usr/bin/env bash\necho "$3" >> ${bwLog}\necho '{"login":{"password":"ghp_READONLYfake"}}'\n`);
  chmodSync(join(T, 'fbin', 'bw'), 0o755);
  // Derselbe Aufruf wie in vorbau.ts (credential fill mit g0GitArgs/g0Env), nur mit dem echten Helper.
  const out = execFileSync('node', ['-e', `import('${new URL('../server/vorbau.ts', import.meta.url).pathname}').then(m => { process.stdout.write(String(m.lesetoken(process.cwd(), { owner: 'WirStrom1', name: 'olaf-docs' }))); })`], {
    cwd: docs, encoding: 'utf8', env: { ...process.env, HOME: fakeHome, PATH: `${join(T, 'fbin')}:${process.env.PATH}`, VORBAU_CRED_HELPER: join(homedir(), 'bin', 'git-credential-vaultwarden'), GIT_VW_ITEM: 'Github TOken wirstrom push', GIT_VW_READ: '' },
  });
  assert.equal(out, 'ghp_READONLYfake');
  const items = readFileSync(bwLog, 'utf8').trim().split('\n');
  assert.deepEqual([...new Set(items)], ['Github wirstrom read only']);
});

test('Ohne Lesetoken → Stopp ohne Knopf (DoD 17); Fetch scheitert → Stopp (DoD 7)', async () => {
  rmSync(TOKEN_OK);
  try {
    const r = await run('ganz-neue-sache', [admin]);
    assert.equal(r.ergebnis, 'stopp'); assert.equal(r.stopp!.grund, 'lesetoken'); assert.equal(r.stopp!.knopf, null);
    assert.deepEqual(g0Optionen(r).map((o) => o.label), ['trotzdem bauen', 'Spec nachziehen/abräumen']);
  } finally { writeFileSync(TOKEN_OK, '1'); }
  const kaputt = join(T, 'work', 'kaputt');
  git(T, ['clone', '-q', join(T, 'gh', 'WirStrom1', 'olaf-docs.git'), kaputt]);
  git(kaputt, ['remote', 'set-url', 'origin', join(T, 'gh', 'WirStrom1', 'gibtsnicht.git')]);
  const r = await run('ganz-neue-sache', [kaputt]);
  assert.equal(r.ergebnis, 'stopp'); assert.equal(r.stopp!.grund, 'fetch'); assert.equal(r.stopp!.knopf, null);
});

test('Nur die PR-API fehlt → Stopp mit Knopf „ohne PR-Prüfung bauen“; mit Knopf weiter, Hinweis (DoD 7)', async () => {
  apiStatus = 502;
  try {
    const r = await run('ganz-neue-sache', [admin]);
    assert.equal(r.ergebnis, 'stopp'); assert.equal(r.stopp!.grund, 'pr-api'); assert.equal(r.stopp!.knopf, 'ohne PR-Prüfung bauen');
    const ohne = await run('ganz-neue-sache', [admin], { ohnePr: true });
    assert.equal(ohne.ergebnis, 'frei');
    assert.ok(ohne.hinweise.some((h) => /Ohne PR-Prüfung/.test(h)));
  } finally { apiStatus = 200; }
  apiStatus = 401;
  try { const r = await run('ganz-neue-sache', [admin]); assert.equal(r.stopp!.grund, 'lesetoken'); assert.equal(r.stopp!.knopf, null); }
  finally { apiStatus = 200; }
});

test('Protokoll und Bilanz: Fehlalarme, „anderer Autor“ gesondert, Fehltreffer; > 1 Autor-Fehlalarm → Kriterium entfällt (DoD 13, 25)', async () => {
  const p = join(T, 'bilanz.jsonl');
  protokolliere({ art: 'pruefung', slug: 'a-b', ergebnis: 'treffer', kriterien: ['autor'] }, p);
  protokolliere({ art: 'knopf', slug: 'a-b', knopf: 'trotzdem bauen', kriterien: ['autor'] }, p);
  protokolliere({ art: 'fehltreffer', slug: 'c-d', beleg: 'olaf-admin#400 doppelt' }, p);
  let b = bilanz(p);
  assert.deepEqual([b.fehlalarme, b.fehlalarmeAutor, b.fehltreffer.length, b.autorKriteriumAktiv], [1, 1, 1, true]);
  // Nach einem Stopp (kein Lesetoken) ist „trotzdem bauen“ kein Fehlalarm; „ohne PR-Prüfung bauen“ auch nicht.
  protokolliere({ art: 'knopf', slug: 'g-h', knopf: 'trotzdem bauen', ergebnis: 'stopp', kriterien: [] }, p);
  protokolliere({ art: 'knopf', slug: 'g-h', knopf: 'ohne PR-Prüfung bauen', kriterien: [] }, p);
  assert.equal(bilanz(p).fehlalarme, 1);
  protokolliere({ art: 'knopf', slug: 'e-f', knopf: 'trotzdem bauen', kriterien: ['autor'] }, p);
  b = bilanz(p);
  assert.equal(b.autorKriteriumAktiv, false);
  assert.equal(bilanz(p, 28, Date.now() + 40 * 86_400_000).fehlalarme, 0, 'nach 4 Wochen aus dem Fenster');
  // Mit abgeschaltetem Kriterium wird Fixture G zu „fortsetzen“.
  const plan = planDatei('123b.md', '---\nspec: admin-spec-zaehlpunkte-filter\nbranch: feat/zaehlpunkte-filter\n---\n');
  const r = await pruefe({ slug: 'admin-spec-zaehlpunkte-filter', repos: [admin], planDatei: plan, aufrufer: 'test', protokoll: p });
  assert.equal(r.ergebnis, 'fortsetzen');
  // Jede Prüfung steht im Protokoll.
  assert.ok(readFileSync(process.env.VORBAU_PROTOKOLL!, 'utf8').includes('"art":"pruefung"'));
});

test('CLI: Exit-Codes und JSON', async () => {
  const cli = new URL('../../scripts/vorbau-check', import.meta.url).pathname;
  // asynchron: die nachgebaute API läuft im selben Prozess.
  const call = (a: string[]) => new Promise<{ code: number; out: string }>((res) => execFile(cli, a, { encoding: 'utf8', env: process.env }, (e: any, out) => res({ code: e ? e.code : 0, out })));
  assert.equal((await call(['ganz-neue-sache', '--repos', admin, '--json'])).code, 0);
  const t = await call(['leads-einwilligung-neu', '--repos', admin, '--json']);
  assert.equal(t.code, 10); assert.equal(JSON.parse(t.out).ergebnis, 'treffer');
  assert.equal((await call(['bank', '--repos', admin])).code, 20);
  assert.equal((await call(['fehltreffer', 'a-b', '--beleg', 'x'])).code, 0);
});
