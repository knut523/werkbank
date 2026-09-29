// Parser: Vault-Notizen (Frontmatter, Wikilinks, Backlinks, Darstellung), Sprint-Antwortzeilen und
// Anker, Sprint-Ziel/Ergebnisse, Sync-Plan-Vorschläge. Läuft nur auf Fixtures (und liest den echten
// Vault höchstens, falls vorhanden — nie schreibend).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { parseFrontmatter, extractWikilinks, buildIndex, renderNote, roadmap, teams, tree } from '../server/vault.ts';
import { parseQuestions, syncPlanRows, applyAnswer, hashText, parseGoal, parseOutcomes, splitSpeaker, newCycleFiles, listCycles } from '../server/sprint.ts';
import { parseDue, proposalsFor, parseTsv } from '../server/syncplan.ts';

const FIX = new URL('./fixtures/vault', import.meta.url).pathname;
const SPRINT = join(FIX, 'olaf/1-Projects/sprint-2026-09-28');
const REVIEW = readFileSync(join(SPRINT, 'sprint-2026-09-28-review.md'), 'utf8');
const PLANNING = readFileSync(join(SPRINT, 'sprint-2026-09-28-planning.md'), 'utf8');
const SCRIPTS = join(homedir(), '.claude/skills/maxenergy-jira/scripts');

test('Frontmatter: flaches YAML, Rumpf danach', () => {
  const { fm, body } = parseFrontmatter('---\ntitle: "X"\ntags: [a, b]\n---\n\n# X\nText');
  assert.equal(fm.title, 'X');
  assert.deepEqual(fm.tags, ['a', 'b']);
  assert.match(body, /^\n# X/);
  assert.deepEqual(parseFrontmatter('# ohne').fm, {});
  assert.deepEqual(parseFrontmatter('---\n: kaputt: [\n---\nx').fm, {});
});

test('Wikilinks: Alias, Überschrift, Tabellen-Escape, Code wird ignoriert', () => {
  const l = extractWikilinks('[[a]] [[b|B]] [[c#H]] ![[bild.png]] `[[nicht]]` [[d\\|D]]\n```\n[[auch nicht]]\n```');
  assert.deepEqual(l.map((x) => x.target), ['a', 'b', 'c', 'bild.png', 'd']);
  assert.equal(l[1].alias, 'B');
  assert.equal(l[2].heading, 'H');
  assert.equal(l[3].embed, true);
  assert.equal(l[4].alias, 'D');
});

test('Index: Basename-Auflösung, Backlinks, nicht aufgelöste Links, Team', () => {
  const idx = buildIndex(FIX);
  assert.equal(idx.notes.size, 13);
  const home = idx.notes.get('olaf/olaf-Home.md')!;
  assert.equal(home.team, 'olaf');
  assert.ok(home.links.includes('olaf/MOCs/Olaf-Sprint-MOC.md'));
  assert.deepEqual(home.unresolved, ['gibt-es-nicht']);
  const bl = idx.backlinks.get('olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md');
  assert.ok(bl?.has('olaf/Timeline/2026-09-olaf.md'));
});

test('Struktur: Teams, Roadmap Thema × Zustand, Baum', () => {
  const idx = buildIndex(FIX);
  const t = teams(idx);
  assert.equal(t.olaf.home, 'olaf/olaf-Home.md');
  assert.deepEqual(t.olaf.mocs, ['olaf/MOCs/Olaf-Sprint-MOC.md']);
  assert.ok(t.olaf.para.includes('1-Projects') && t.olaf.para.includes('2-Areas'));
  const rm = roadmap(idx);
  assert.deepEqual(rm.states, ['1-Backlog', '3-Plan']);
  assert.equal(rm.topics[0].name, 'Service-View');
  assert.equal(rm.topics[0].states['3-Plan'][0].title, 'Service View: Kundenakte');
  assert.ok(rm.topics[0].overview?.endsWith('0-service-view-uebersicht.md'));
  assert.equal(tree(idx).count, 13);
});

test('Darstellung: Callout → details, Anker weg, Wikilinks klickbar, kein Roh-HTML', () => {
  const idx = buildIndex(FIX);
  const html = renderNote(idx, REVIEW, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md');
  assert.match(html, /<details class="callout callout-note"><summary>2 Tickets · Knut · 1 überfällig — hier kommentieren<\/summary>/);
  assert.match(html, /<details class="callout callout-tip" open>/);
  assert.doesNotMatch(html, /<!--k:PM-321-->/);
  assert.match(html, /href="#\/wissen\/olaf\/1-Projects\/sprint-2026-09-28\/sprint-2026-09-28-planning.md"/);
  assert.match(html, /target="_blank"/);
  const evil = renderNote(idx, 'Hallo <script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [[gibt-es-nicht]]');
  assert.doesNotMatch(evil, /<script|<img|href="javascript/);
  assert.match(evil, /gibt-es-nicht ⚠︎/);
  const table = renderNote(idx, '| a | b |\n|---|---|\n| [[0-roadmap-produkt-olaf\\|Roadmap]] | x |');
  assert.match(table, /<td><a href="#\/wissen\/olaf\/2-Areas\/Product\/Produkt-OLAF\/1-Roadmap\/0-Overview\/0-roadmap-produkt-olaf.md">Roadmap<\/a><\/td>/);
});

test('Sprint: Fragen, Anker, Antwortzeilen (auch im Callout), Code-Span-Anker zählt nicht', () => {
  const qs = parseQuestions(REVIEW);
  assert.deepEqual(qs.map((q) => q.key), ['PM-321', 'PM-322', 'PM-331']);
  const [a, b, c] = qs;
  assert.equal(a.inCallout, true);
  assert.equal(a.section, 'Hardware-Flow');
  assert.deepEqual(a.answers.map((x) => [x.kind, x.speaker, x.text]), [['note', 'Knut', 'ist durch, Prod-Push 24.09. — auf Done setzen']]);
  assert.deepEqual(b.answers.map((x) => x.kind), ['carry', 'empty']);
  assert.equal(c.answers[0].kind, 'empty');
  assert.equal(c.answers[0].speaker, 'Christoph');
  assert.equal(c.answers[1].kind, 'synced');
  const pl = parseQuestions(PLANNING);
  assert.equal(pl.length, 2);
  assert.equal(pl[0].key, 'ZIEL:PM-70');
  assert.equal(pl[0].ticket, 'PM-70');
  assert.match(pl[0].context.join(' '), /Sicherheit vor Features/);
  assert.equal(pl[1].ticket, 'PM-267');
});

test('Sprecher-Erkennung wie jira-sync-plan.sh', () => {
  assert.deepEqual(splitSpeaker('Knut: ist durch'), { speaker: 'Knut', text: 'ist durch' });
  assert.deepEqual(splitSpeaker('Update: läuft'), { speaker: '', text: 'Update: läuft' });
  assert.deepEqual(splitSpeaker('Datum auf in 2 Wochen aktualisieren: bitte'), { speaker: '', text: 'Datum auf in 2 Wochen aktualisieren: bitte' });
  assert.deepEqual(splitSpeaker('Knut Peters:'), { speaker: 'Knut Peters', text: '' });
});

test('Sync-Zeilen stimmen mit jira-sync-plan.sh überein (Fixture und, falls da, echter Vault)', { skip: !existsSync(join(SCRIPTS, 'jira-sync-plan.sh')) }, () => {
  const dirs = [SPRINT];
  // Echter Vault: nur lesen.
  for (const id of ['2026-09-28', '2026-09-14']) if (existsSync(`/vault/olaf/1-Projects/sprint-${id}`)) dirs.push(`/vault/olaf/1-Projects/sprint-${id}`);
  for (const dir of dirs) {
    const id = dir.split('/').pop()!;
    const files = [`${dir}/${id}-review.md`, `${dir}/${id}-planning.md`].filter(existsSync);
    const mine = files.flatMap((f) => syncPlanRows(parseQuestions(readFileSync(f, 'utf8'), f)))
      .map((r) => [r.kind, r.key, r.speaker, r.payload, r.line, r.file].join('\t')).sort();
    const theirs = execFileSync(join(SCRIPTS, 'jira-sync-plan.sh'), ['--sprint', dir], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    assert.deepEqual(mine, theirs, `Abweichung in ${dir}`);
  }
});

test('Antwort einfügen: leeres Feld füllen, neue Zeile im Callout, Hash-Schutz', () => {
  const h = hashText(REVIEW);
  const q322 = parseQuestions(REVIEW).find((q) => q.key === 'PM-322')!;
  const e1 = applyAnswer(REVIEW, q322.line, 'Knut', 'Status kommt ins Planning', h);
  assert.equal(e1.mode, 'filled');
  assert.equal(e1.after, '>   - Knut: Status kommt ins Planning');
  assert.equal(e1.before, '>   - Knut:');
  const q321 = parseQuestions(REVIEW).find((q) => q.key === 'PM-321')!;
  const e2 = applyAnswer(REVIEW, q321.line, 'Daniela', 'bestätigt\nmehrzeilig <!--x-->');
  assert.equal(e2.mode, 'inserted');
  assert.equal(e2.after, '>   - Daniela: bestätigt mehrzeilig x-->');
  assert.equal(e2.text.split('\n')[e2.line - 1], e2.after);
  // Die neue Zeile gehört zur Frage und wird vom Sync-Parser genauso gelesen.
  const again = parseQuestions(e2.text).find((q) => q.key === 'PM-321')!;
  assert.equal(again.answers.at(-1)!.speaker, 'Daniela');
  const q331 = parseQuestions(REVIEW).find((q) => q.key === 'PM-331')!;
  const e3 = applyAnswer(REVIEW, q331.line, 'Christoph', 'Slot war belegt');
  assert.equal(e3.after, '  - Christoph: Slot war belegt');
  const pq = parseQuestions(PLANNING)[0];
  const e4 = applyAnswer(PLANNING, pq.line, 'Knut', 'ja');
  assert.equal(e4.after, '   - Knut: ja');
  assert.throws(() => applyAnswer(REVIEW, q321.line, 'Knut', 'x', 'falsch'), /geändert/);
  assert.throws(() => applyAnswer(REVIEW, 3, 'Knut', 'x'), /nicht gefunden/);
  assert.throws(() => applyAnswer(REVIEW, q321.line, 'Knut', '   '), /Leere/);
});

test('Sprint-Ziel und Ergebnisse S1–S4 (Planning) und Bewertung (Review)', () => {
  assert.equal(parseGoal(PLANNING).goal, 'Die Sicherheitsfixes laufen auf Prod und sind nachgeprüft, und das Vertragspaket ist unterschrieben.');
  const o = parseOutcomes(PLANNING);
  assert.deepEqual(o.map((x) => x.id), ['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual([o[0].title, o[0].owner, o[0].date], ['Sicherheitsfixes auf Prod', 'Knut', '02.10.']);
  assert.match(o[0].dod!, /Leak-Check/);
  const r = parseOutcomes(REVIEW);
  assert.deepEqual(r.map((x) => [x.id, x.rating]), [['S1', '✅'], ['S2', '❌']]);
  assert.equal(r[1].why, 'Owner fehlte, jetzt Bernd');
  assert.equal(r[1].evidence, 'keine Unterschrift');
  const list = parseOutcomes('- **S1** Ergebnis A · DoD: fertig · Owner: Knut · bis 02.10. 🟡');
  assert.deepEqual([list[0].id, list[0].title, list[0].owner, list[0].date, list[0].rating], ['S1', 'Ergebnis A', 'Knut', '02.10.', '🟡']);
});

test('Neuer Zyklus aus den Vorlagen (mit S1–S4, gültiges Frontmatter)', () => {
  const files = newCycleFiles(new URL('../../templates/sprint', import.meta.url).pathname, '2026-10-12', 'sprint-2026-09-28');
  assert.deepEqual(files.map((f) => f.name), ['sprint-2026-10-12-summary.md', 'sprint-2026-10-12-review.md', 'sprint-2026-10-12-planning.md']);
  for (const f of files) {
    const { fm } = parseFrontmatter(f.content);
    assert.equal(fm.team, 'olaf');
    assert.ok(fm.title && fm.type && fm.status && fm.created && fm['last-verified']);
    assert.doesNotMatch(f.content, /\{\{/);
  }
  assert.match(files[0].content, /target-date: 2026-10-26/);
  assert.match(files[1].content, /Soll-Ist zum Sprint-Ziel vom 28\.09\.2026/);
  assert.deepEqual(parseOutcomes(files[2].content).map((o) => o.id), ['S1', 'S2', 'S3', 'S4']);
  assert.throws(() => newCycleFiles('/x', '12.10.2026'), /Format/);
  const tmp = mkdtempSync(join(tmpdir(), 'zyklen-'));
  cpSync(FIX + '/olaf/1-Projects', tmp, { recursive: true });
  assert.equal(listCycles(tmp)[0].id, 'sprint-2026-09-28');
});

test('Sync-Plan: Vorschläge, Kommentarform, Mitnahme nie nach Jira, Widersprüche', () => {
  const rows = parseTsv([
    'note\tPM-321\tKnut\tist durch, Prod-Push 24.09. — auf Done setzen\t30\tr.md',
    'carry\tPM-322\t-\tStatus entscheiden\t32\tr.md',
    'status\tPM-331\t-\tDone\t40\tr.md',
    'note\tZIEL:PM-70\tKnut\tja, so machen\t12\tp.md',
    'note\tPM-267\t-\tneues Datum 25.10.\t15\tp.md',
    'note\tPM-340\t-\tneu setzen\t16\tp.md',
    'note\tS1\t-\tirgendwas\t17\tp.md',
  ].join('\n'));
  const issues = new Map<string, any>([
    ['PM-321', { key: 'PM-321', status: 'To Do', duedate: '2026-09-15' }],
    ['PM-331', { key: 'PM-331', status: 'Done', duedate: null }],
    ['PM-70', { key: 'PM-70', status: 'In Progress' }],
    ['PM-267', { key: 'PM-267', status: 'Ongoing', duedate: null }],
    ['PM-340', { key: 'PM-340', status: 'Backlog', duedate: null }],
  ]);
  const p = proposalsFor(rows, issues, '2026-09-28');
  assert.deepEqual(p[0].actions, [{ type: 'status', to: 'Done', from: 'To Do' }, { type: 'comment', text: 'Knut (Sprint Review, 28.09.2026): ist durch, Prod-Push 24.09. — auf Done setzen' }]);
  assert.equal(p[1].carry, true);
  assert.deepEqual(p[1].actions, []);
  assert.match(p[2].conflict!, /schon auf „Done“/);
  assert.equal(p[3].ticket, 'PM-70');
  assert.deepEqual(p[4].actions, [{ type: 'due', date: `${new Date().getFullYear()}-10-25`, from: null }]);
  assert.match(p[5].question!, /Datum fehlt/);
  assert.match(p[6].question!, /Kein Ticket/);
});

test('Fälligkeit aus Freitext', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  assert.deepEqual(parseDue('neues Datum 25.10.', now), { date: '2026-10-25' });
  assert.deepEqual(parseDue('bis 02.10.2026', now), { date: '2026-10-02' });
  assert.deepEqual(parseDue('Datum 2026-11-01', now), { date: '2026-11-01' });
  assert.deepEqual(parseDue('ohne Datum bitte', now), { date: null });
  assert.deepEqual(parseDue('fällig 05.01.', new Date('2026-12-20T12:00:00Z')), { date: '2027-01-05' });
  assert.equal(parseDue('Termin mit Rogue', now), undefined);
});

test('Fixture bleibt unverändert (Parser schreiben nie)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fix-'));
  writeFileSync(join(tmp, 'x.md'), REVIEW);
  parseQuestions(readFileSync(join(tmp, 'x.md'), 'utf8'));
  assert.equal(readFileSync(join(tmp, 'x.md'), 'utf8'), REVIEW);
});
