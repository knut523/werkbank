// Teil C (docs/plan-leitstand.md): Bericht-Kopf, Spalten, Diagramme als Text, DoD-Häkchen, Vorlage im Brief, Freigabe-Verfall auf
// der Karte, Kopf-Pflege im Status-Takt (fertige Stränge, tote Vorschau). Rein bzw. mit Dateien in tmp — keine Datenbank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'bericht-c-')));
const DIR = join(base, 'review-pakete');
mkdirSync(join(DIR, '901-teil-c'), { recursive: true });
process.env.WERKBANK_REVIEW_DIR = DIR;
const { berichtKopf, ersterMermaid, spalte, offeneFragen, commitPasst } = await import('../server/berichtkopf.ts');
const { renderPaketMd } = await import('../server/reviewpakete.ts');
const { orchBrief, BERICHT_PFLICHT } = await import('../server/orchestrator.ts');
const { kopfFelder } = await import('../server/leitstand.ts');
const { kopfPflege } = await import('../server/berichtstand.ts');

const KOPF = `---
status: wartet_auf_knut
offen:
  - Vorlage in Brevo umbauen
review:
  - titel: Admin
    url: https://3064--main--dev--knut.ws.konekto.energy/x
    login: https://3064--main--dev--knut.ws.konekto.energy/login
  - screenshot: screenshots/a.png
fragen:
  - id: D1
    frage: Jetzt umbauen?
    empfehlung: ja
    antwort: ""
github:
  - repo: WirStrom1/olaf-admin
    zweig: feat/x
    commit: E05EA35C
---
# Bericht

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

test('C-1: Kopf lesen — Schema, Grenzen, Fremdes raus', () => {
  const k: any = berichtKopf(KOPF);
  assert.equal(k.status, 'wartet_auf_knut');
  assert.deepEqual(k.offen, ['Vorlage in Brevo umbauen']);
  assert.equal(k.review[0].login, 'https://3064--main--dev--knut.ws.konekto.energy/login');
  assert.equal(k.review[1].screenshot, 'screenshots/a.png');
  assert.deepEqual(k.fragen[0], { id: 'D1', frage: 'Jetzt umbauen?', empfehlung: 'ja', antwort: '' });
  assert.equal(k.github[0].commit, 'e05ea35c', 'SHA klein');
  assert.equal(berichtKopf('# ohne Kopf'), null);
  assert.match((berichtKopf('---\nstatus: fertig\n---\n') as any).fehler, /status muss/);
  assert.match((berichtKopf('---\nstatus: [\n---\n') as any).fehler, /YAML unlesbar/);
  const böse: any = berichtKopf(`---\nstatus: blockiert\noffen: [a, b, c, d, e, f, g]\nreview:\n  - titel: x\n    url: "javascript:alert(1)"\n  - screenshot: ../../etc/passwd\n  - screenshot: /etc/passwd\n  - pr_text: ~/x.md\ngithub:\n  - repo: "evil repo"\n    commit: zz\n  - repo: a/b\n    commit: "1234"\n    pr: https://evil.example/pull/1\n---\n`);
  assert.equal(böse.offen.length, 5, 'höchstens 5');
  assert.deepEqual(böse.review, [], 'javascript:, .., absolute und ~-Pfade verworfen');
  assert.deepEqual(böse.github, [{ repo: 'a/b', zweig: '', commit: '' }], 'kaputtes Repo raus, zu kurzer SHA leer, fremder PR-Link raus');
  assert.equal(ersterMermaid(KOPF), 'flowchart LR\n  A --> B');
});

test('C-5/H1/H3: Spalte nach Kopf — offene Frage/blockiert → Entscheiden; Freigabe → Auf GitHub; bereit ohne Freigabe → Ansehen; beantwortet → Ansehen', () => {
  const k: any = berichtKopf(KOPF);
  assert.equal(offeneFragen(k, null, 'h1').length, 1);
  assert.equal(spalte(k, { offeneFragen: 1, freigabe: false }), 'entscheiden');
  assert.equal(offeneFragen(k, { berichtHash: 'h1', ids: ['D1'] }, 'h1').length, 0, 'für diesen Bericht beantwortet');
  assert.equal(offeneFragen(k, { berichtHash: 'alt', ids: ['D1'] }, 'h1').length, 1, 'Antwort galt einem älteren Bericht');
  assert.equal(spalte(k, { offeneFragen: 0, freigabe: false }), 'ansehen');
  const bereit: any = { ...k, status: 'bereit_fuer_github', fragen: [] };
  assert.equal(spalte(bereit, { offeneFragen: 0, freigabe: false }), 'ansehen', 'Selbstauskunft allein reicht nicht');
  assert.equal(spalte(bereit, { offeneFragen: 0, freigabe: true }), 'github');
  assert.equal(spalte({ ...k, status: 'blockiert' }, { offeneFragen: 0, freigabe: true }), 'entscheiden');
  assert.equal(spalte(null, { offeneFragen: 0, freigabe: false }), 'ansehen', 'ohne Kopf');
  assert.equal(spalte(k, { offeneFragen: 0, freigabe: false, pr: true }), 'github', 'schon als PR auf GitHub');
  assert.equal(spalte(k, { offeneFragen: 1, freigabe: false, pr: true }), 'entscheiden', 'offene Frage geht vor');
  assert.equal(commitPasst('e05ea35', 'e05ea35c' + '0'.repeat(32)), true);
  assert.equal(commitPasst('e05ea35', 'abcdef0' + '0'.repeat(33)), false);
  assert.equal(commitPasst('e05', 'e05ea35c'), null, 'zu kurz: nichts zu vergleichen');
});

test('C-3/C-4: Diagramme als Text (nie ausführbar), DoD-Zellen als Häkchen, Kopf nicht sichtbar', () => {
  const html = renderPaketMd(`---\nstatus: blockiert\n---\n# T\n\n\`\`\`mermaid\nflowchart LR\n  A["<script>alert(1)</script>"] -->|click| B\n  click A "javascript:alert(2)"\n\`\`\`\n\n| # | Punkt | Stand |\n|---|---|---|\n| 1 | a | ja |\n| 2 | b | teilweise |\n| 3 | c | nein |\n| 4 | d ja | e |\n`, '901-teil-c', 'bericht.md');
  assert.doesNotMatch(html, /status: blockiert/, 'Kopf weggeschnitten');
  assert.match(html, /<pre class="mermaid-src">flowchart LR\n {2}A\[&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;\]/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /<td class="dod dod-ja" title="ja">✓ ja<\/td>/);
  assert.match(html, /<td class="dod dod-teilweise" title="teilweise">◐ teilweise<\/td>/);
  assert.match(html, /<td class="dod dod-nein" title="nein">✗ nein<\/td>/);
  assert.match(html, /<td>d ja<\/td>/, 'nur ganze Zellen');
});

test('C-2: Vorlage für alle Stränge — Kopf und Diagramm Pflicht, Verweis auf die Vorlagen', () => {
  const b = orchBrief({ title: 'X', prompt: 'Tu was', cwd: '/w/x', person: 'Knut' });
  assert.ok(b.includes(BERICHT_PFLICHT));
  for (const s of ['status: wartet_auf_knut', 'bereit_fuer_github', 'offen:', 'review:', 'fragen:', 'github:', '```mermaid', 'Ausroll-Reihenfolge', 'docs/bericht-folien-vorlage.html', 'antwort:']) assert.ok(BERICHT_PFLICHT.includes(s), s);
  assert.match(b, /Auftrag:\nTu was$/, 'Auftrag bleibt am Ende');
  // Das Muster in docs/bericht-vorlage.md ist selbst ein gültiger Kopf mit Diagramm.
  const vorlage = readFileSync(new URL('../../docs/bericht-vorlage.md', import.meta.url), 'utf8');
  assert.equal((berichtKopf(vorlage) as any).status, 'wartet_auf_knut');
  assert.ok(ersterMermaid(vorlage));
  assert.match(readFileSync(new URL('../../docs/bericht-folien-vorlage.html', import.meta.url), 'utf8'), /mermaid@10\.9\.8/);
});

test('C-7 (Karte): Freigabe verfällt sichtbar, wenn der Kopf einen anderen Commit nennt oder der Zweig weiterging', () => {
  const k: any = berichtKopf(KOPF.replace('E05EA35C', 'aaaaaaaa'));
  const head = 'aaaaaaaa' + 'b'.repeat(32);
  const fg = [{ _id: 'f-1', strand: 's1', branch: 'feat/x', head, at: new Date(), pushedAt: null, pr: null }];
  const ok = kopfFelder({ _id: 's1', berichtKopf: k, berichtHash: 'h', repoHead: head }, fg);
  assert.equal(ok.freigabe!.veraltet, false); assert.equal(ok.spalte, 'entscheiden', 'offene Frage geht vor');
  const ohneFrage: any = { ...k, fragen: [] };
  assert.equal(kopfFelder({ _id: 's1', berichtKopf: ohneFrage, berichtHash: 'h', repoHead: head }, fg).spalte, 'github');
  const neuerCommit = kopfFelder({ _id: 's1', berichtKopf: { ...ohneFrage, github: [{ ...ohneFrage.github[0], commit: 'cccccccc' }] }, berichtHash: 'h', repoHead: 'c'.repeat(40) }, fg);
  assert.equal(neuerCommit.freigabe!.veraltet, true);
  assert.equal(neuerCommit.spalte, 'ansehen', 'veraltete Freigabe zählt nicht als „Auf GitHub“');
  const weiter = kopfFelder({ _id: 's1', berichtKopf: ohneFrage, berichtHash: 'h', repoHead: 'd'.repeat(40) }, fg);
  assert.equal(weiter.freigabe!.veraltet, true, 'Zweig steht woanders');
  assert.match(weiter.commitWarnung!, /Bericht nennt aaaaaaa, der Zweig steht auf ddddddd/);
  const gepusht = kopfFelder({ _id: 's1', berichtKopf: ohneFrage, berichtHash: 'h', repoHead: 'd'.repeat(40) }, [{ ...fg[0], pushedAt: new Date(), pr: 'https://github.com/WirStrom1/olaf-admin/pull/337' }]);
  assert.equal(gepusht.freigabe!.prNr, 337); assert.equal(gepusht.freigabe!.veraltet, false);
  const zwei = kopfFelder({ _id: 's1', berichtKopf: { ...ohneFrage, github: [...ohneFrage.github, { repo: 'WirStrom1/olaf-umbrella', zweig: 'x', commit: '' }] } }, []);
  assert.deepEqual(zwei.weitereRepos, ['WirStrom1/olaf-umbrella'], 'weitere Repos ausdrücklich nicht freigegeben');
});

test('C-12/C-8/H2/H5: Kopf-Pflege liest nur bei Änderung, auch fertige Stränge; tote Vorschau markiert; Commit-Abgleich', async () => {
  const p = join(DIR, '901-teil-c', 'bericht.md');
  writeFileSync(p, KOPF);
  const d: any = { _id: 's1', bericht: p, paket: '901-teil-c', lastStatus: 'done', doneAt: new Date() };
  const calls: number[] = [];
  const deps = { pruefe: async (v: any) => { calls.push(v.port); return { ...v, status: null, ergebnis: 'antwortet nicht' as const, at: 0 }; }, repo: () => ({ head: 'e05ea35c' + '0'.repeat(32) }) };
  const s1: any = await kopfPflege(d, 1_000_000, deps);
  assert.equal(s1.berichtKopf.status, 'wartet_auf_knut');
  assert.equal(s1.berichtDiagramm, 'flowchart LR\n  A --> B');
  assert.equal(s1.repoHead.slice(0, 8), 'e05ea35c');
  assert.deepEqual(s1.linkCheck.map((l: any) => [l.url.endsWith('/login'), l.tot]), [[true, true], [false, true]], 'Login-Link zuerst, beide tot');
  Object.assign(d, s1);
  // Unverändert, < 5 min: nichts.
  assert.deepEqual(await kopfPflege(d, 1_000_000 + 60_000, deps), {});
  // Bericht geändert (Strang aktualisiert ihn): neu gelesen, Antwort im Kopf → keine offene Frage mehr.
  writeFileSync(p, KOPF.replace('antwort: ""', 'antwort: "ja, heute"'));
  utimesSync(p, new Date(), new Date(Date.now() + 5000));
  const s2: any = await kopfPflege(d, 1_000_000 + 90_000, deps);
  assert.equal(s2.berichtKopf.fragen[0].antwort, 'ja, heute');
  assert.notEqual(s2.berichtHash, s1.berichtHash);
  // Lebende Vorschau → keine Warnung.
  Object.assign(d, s2);
  const live = await kopfPflege(d, 1_000_000 + 90_000 + 6 * 60_000, { ...deps, pruefe: async (v: any) => ({ ...v, status: 200, ergebnis: 'läuft' as const, at: 0 }) });
  assert.equal((live as any).linkCheck.every((l: any) => !l.tot), true);
  // Kein Bericht → nichts.
  assert.deepEqual(await kopfPflege({ _id: 's2' }, 0, deps), {});
});
