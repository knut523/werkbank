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
const { berichtKopf, ersterMermaid, spalte, offeneFragen, commitPasst, kopfMaengel, prTabelle, execSummary } = await import('../server/berichtkopf.ts');
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
  const deps = { pruefe: async (v: any) => { calls.push(v.port); return { ...v, status: null, ergebnis: 'antwortet nicht' as const, at: 0 }; }, repo: () => ({ head: 'e05ea35c' + '0'.repeat(32) }), freigabePrs: async () => [] };
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

// ── C.7 Exec Summary (Nachtrag Knut 14.10.) ──────────────────────────────────────────────────────────────────────────────────
const EXEC = `---
status: wartet_auf_knut
titel: Die Leasing-Mail trägt jetzt Text und Ansprechperson
worum: Bisher kam bei der Leasing-Abteilung nur das nackte Angebot an. Jetzt mit Erklärung und Person.
anders: [Standardtext, Nachricht je Versand, Ansprechperson, mehrere Adressen, fünfter Punkt fliegt raus]
offen: [Vorlage 85 in Brevo umbauen]
github:
  - repo: WirStrom1/olaf-admin
    zweig: feat/leasing
    commit: e5e29fb5
    was: "Code: Einstellungen, Versand, Mail"
    pr: https://github.com/WirStrom1/olaf-admin/pull/337
    stand: gemergt
  - repo: WirStrom1/olaf-docs
    zweig: docs/118
    was: Plan 118
    pr: https://github.com/WirStrom1/olaf-docs/pull/9999
  - repo: knut523/werkbank
    zweig: feat/lokal
    was: nur lokal
---
# Bericht
`;

test('S-1/S-2: Exec Summary im Kopf — titel, worum, anders (≤ 4), was je PR; Mängel als Hinweis', () => {
  const k: any = berichtKopf(EXEC);
  assert.equal(k.titel, 'Die Leasing-Mail trägt jetzt Text und Ansprechperson');
  assert.match(k.worum, /^Bisher kam/);
  assert.equal(k.anders.length, 4);
  assert.equal(k.github[0].was, 'Code: Einstellungen, Versand, Mail');
  assert.equal('stand' in k.github[0], false, 'Stand aus dem Bericht wird nicht übernommen');
  assert.deepEqual(kopfMaengel(k, 'flowchart LR\n A-->B'), []);
  assert.deepEqual(kopfMaengel(berichtKopf('---\nstatus: blockiert\ngithub:\n  - repo: a/b\n    zweig: x\n---\n') as any, null), ['titel', 'worum', 'anders', 'github.was', 'Mermaid-Diagramm']);
  assert.deepEqual(kopfMaengel(null, null), [], 'ohne Kopf keine Mängel-Zeile');
});

test('S-4/B2/B3: PR-Tabelle und Spalte nur aus dem GitHub-Stand — fehlt ohne Link, lokal ohne Link, ungeprüft = unbekannt', () => {
  const k: any = berichtKopf(EXEC);
  const checks = [
    { url: 'https://github.com/WirStrom1/olaf-admin/pull/337', stand: 'offen' as const },
    { url: 'https://github.com/WirStrom1/olaf-docs/pull/9999', stand: 'fehlt' as const },
  ];
  const z = prTabelle(k, checks);
  assert.deepEqual(z.map((x) => [x.label, x.url !== null, x.stand]), [['olaf-admin#337', true, 'offen'], ['olaf-docs#9999', false, 'fehlt'], ['werkbank · feat/lokal', false, 'lokal']]);
  assert.equal(z[0].text, 'offen', 'GitHub sagt offen — der Bericht sagte „gemergt“');
  assert.match(z[1].text, /gibt es auf GitHub nicht/);
  assert.equal(z[2].text, 'lokal, nicht auf GitHub');
  assert.equal(prTabelle(k, [])[0].stand, 'unbekannt');
  // Freigabe-PR zählt für die erste Zeile, wenn der Bericht keinen nennt.
  const ohnePr: any = { ...k, github: [{ ...k.github[2] }] };
  assert.equal(prTabelle(ohnePr, [{ url: 'https://github.com/knut523/werkbank/pull/5', stand: 'gemergt' }], 'https://github.com/knut523/werkbank/pull/5')[0].stand, 'gemergt');
  // Spalte: ohne Fragen; PR-Link im Bericht allein (ungeprüft oder fehlt) → Ansehen, offen/gemergt → Auf GitHub.
  const base = { _id: 's9', berichtKopf: k, berichtHash: 'h', berichtDiagramm: 'flowchart LR' };
  assert.equal(kopfFelder({ ...base, prCheck: [] }, []).spalte, 'ansehen');
  assert.equal(kopfFelder({ ...base, prCheck: [{ ...checks[0], stand: 'fehlt' }] }, []).spalte, 'ansehen');
  assert.equal(kopfFelder({ ...base, prCheck: checks }, []).spalte, 'github');
  const s = execSummary({ ...base, prCheck: checks });
  assert.equal(s.kopf!.titel, k.titel); assert.equal(s.prs.length, 3); assert.deepEqual(s.maengel, []);
});

test('S-3/B1: PR-Prüfung gegen GitHub-Nachbau — offen, gemergt, geschlossen, fehlt; Variablen statt Text; Fehler → unbekannt', async () => {
  const { createServer } = await import('node:http');
  const seen: any[] = [];
  let mode = 'ok';
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const j = JSON.parse(b); seen.push(j);
    if (mode === 'kaputt') { res.writeHead(502); return res.end('x'); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      data: { p0: { pullRequest: { state: 'OPEN', merged: false, title: 'Leasing' } }, p1: { pullRequest: { state: 'MERGED', merged: true, title: 'Doku' } }, p2: { pullRequest: { state: 'CLOSED', merged: false, title: 'Alt' } }, p3: { pullRequest: null }, p4: null },
      errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a PullRequest' }, { type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }],
    }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const alt = process.env.WERKBANK_GITHUB_API;
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as any).port}`;
  try {
    const { prStaende } = await import('../server/github.ts');
    const urls = [337, 80, 12, 9999].map((n) => `https://github.com/WirStrom1/olaf-admin/pull/${n}`).concat('https://github.com/x/y"){ evil }/pull/1', 'https://github.com/fremd/repo/pull/3');
    const r = await prStaende('t', urls);
    assert.deepEqual(r.map((x) => x.stand), ['offen', 'gemergt', 'geschlossen', 'fehlt', 'fehlt']);
    assert.equal(r.length, 5, 'ungültige URL gar nicht abgefragt');
    assert.doesNotMatch(seen[0].query, /mutation|olaf-admin|337/, 'Besitzer, Repo, Nummer nur als Variablen');
    assert.deepEqual([seen[0].variables.o0, seen[0].variables.r0, seen[0].variables.n0], ['WirStrom1', 'olaf-admin', 337]);
    mode = 'kaputt';
    await assert.rejects(prStaende('t', urls.slice(0, 1)));
    // Kopf-Pflege: alle PR-Links (Kopf + Freigabe) gefragt; innerhalb von 10 min nicht erneut.
    const p = join(DIR, '901-teil-c', 'bericht.md');
    writeFileSync(p, EXEC);
    const s: any = await kopfPflege({ _id: 's7', bericht: p, paket: '901-teil-c' }, 5_000_000, { pruefe: async (v: any) => ({ ...v, status: 200, ergebnis: 'läuft' as const, at: 0 }), repo: () => ({ head: 'e5e29fb5' }), freigabePrs: async () => ['https://github.com/knut523/werkbank/pull/5'], prs: async (u: string[]) => u.map((url) => ({ url, stand: 'unbekannt' as const })) });
    assert.deepEqual(s.prCheck.map((c: any) => c.url.split('/').slice(-3).join('/')), ['olaf-admin/pull/337', 'olaf-docs/pull/9999', 'werkbank/pull/5']);
    const s2: any = await kopfPflege({ _id: 's7', bericht: p, paket: '901-teil-c', ...s }, 5_000_000 + 5 * 60_000, { freigabePrs: async () => [], prs: async () => { throw new Error('nicht nochmal'); } });
    assert.equal('prCheck' in s2, false, 'innerhalb von 10 min nicht erneut gefragt');
  } finally {
    if (alt === undefined) delete process.env.WERKBANK_GITHUB_API; else process.env.WERKBANK_GITHUB_API = alt;
    srv.close();
  }
});

test('S-6: Vorlage verlangt die Exec Summary und erklärt die PR-Regel', () => {
  for (const w of ['Exec Summary', 'titel:', 'worum:', 'anders:', 'was:', 'lokal, nicht auf GitHub', 'holt der Leitstand selbst von GitHub']) assert.ok(BERICHT_PFLICHT.includes(w), w);
  const v = readFileSync(new URL('../../docs/bericht-vorlage.md', import.meta.url), 'utf8');
  const k: any = berichtKopf(v);
  assert.ok(k.titel && k.worum && k.anders.length && k.github.every((g: any) => g.was));
  const f = readFileSync(new URL('../../docs/bericht-folien-vorlage.html', import.meta.url), 'utf8');
  for (const w of ['Exec Summary', 'Worum es geht', 'Was jetzt anders ist', 'Was du tun musst', 'Pull Requests', 'lokal, nicht auf GitHub']) assert.ok(f.includes(w), w);
});
