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
import { parseQuestions, syncPlanRows, applyAnswer, hashText, parseGoal, parseOutcomes, splitSpeaker, newCycleFiles, listCycles, parsePackages, reviewDraftVars, carryList, currentCycle } from '../server/sprint.ts';
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
  assert.equal(idx.notes.size, 15);
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
  assert.equal(tree(idx).count, 15);
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

// ---------- Paket 143: Review-Entwurf, Mitnahme, aktueller Zyklus (docs/plan-sprint-werkbank.md, DoD D1–D3, D7, D10) ----------

const iss = (key: string, o: Partial<Record<string, any>> = {}) => ({
  key, summary: `Titel ${key}`, status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Knut Peters', parent: null,
  duedate: null, priority: null, updated: '2026-10-01', created: '2026-09-01', description: '', comments: 0, statusSince: '2026-09-01', ...o,
}) as any;
const TPL = new URL('../../templates/sprint', import.meta.url).pathname;

test('Pakete der Review-Notiz: Domäne → Paket → Anker, freier Text ohne Antwortzeile', () => {
  const p = parsePackages(REVIEW);
  assert.deepEqual(p.map((x) => [x.domain, x.name, x.tickets]), [['Product', 'Hardware-Flow', ['PM-321', 'PM-322']]]);
  assert.ok(p[0].end > p[0].line);
  const t = parsePackages('## Die Updates\n\n### Marketing\n\n#### Preisblatt\n\n> - [PM-1](x) A <!--k:PM-1-->\n\nOCR ist done, Robert noch\n\n## Auffälligkeiten\n- PM-9 <!--k:PM-9-->');
  assert.deepEqual(t[0].freeText, ['OCR ist done, Robert noch']);
  assert.deepEqual(t[0].tickets, ['PM-1'], 'Anker außerhalb von „Die Updates“ zählen nicht');
});

test('Review-Entwurf: S-Zeilen wörtlich ohne Bewertung, nur Ankerzeilen, Antwortfeld je Owner, kein Sync-Eintrag (D1–D3)', () => {
  const issues = new Map([
    ['PM-321', iss('PM-321', { duedate: '2026-10-01' })],
    ['PM-322', iss('PM-322', { status: 'Done', statusCategory: 'done', statusSince: '2026-10-03' })],
    ['PM-500', iss('PM-500', { created: '2026-10-02', assignee: 'Daniela Martinez Alfaro' })],
    ['PM-501', iss('PM-501', { status: 'Done', statusCategory: 'done', statusSince: '2026-09-02' })],
    ['PM-70', iss('PM-70', { type: 'Workstream', created: '2026-10-01' })],
  ]);
  const { vars, stats } = reviewDraftVars({ date: '2026-10-12', prevId: 'sprint-2026-09-28', prevReview: REVIEW, prevPlanning: PLANNING, issues, today: '2026-10-12' });
  const draft = newCycleFiles(TPL, '2026-10-12', 'sprint-2026-09-28', vars)[1].content;
  assert.doesNotMatch(draft, /\{\{/);
  // D1: S-Zeilen wörtlich, keine Bewertung
  const o = parseOutcomes(draft);
  assert.deepEqual(o.map((x) => [x.id, x.title, x.rating]), parseOutcomes(PLANNING).map((x) => [x.id, x.title, undefined]));
  assert.equal(stats.fallback, false);
  // D2: Paket übernommen, keine alten Antworten/Mitnahmen/✓, Done im Zyklus als Board-Stand, Waise in Auffälligkeiten
  assert.deepEqual(parsePackages(draft).map((p) => [p.name, p.tickets]), [['Hardware-Flow', ['PM-321', 'PM-322']]]);
  assert.doesNotMatch(draft, /ist durch|bereit für Prod|✓ 2026/);
  assert.match(draft, /PM-321\) Titel PM-321 · \*\*Knut\*\* · `To Do` · \*\*11 Tage über\*\* <!--k:PM-321-->\n>   - Knut:\n/);
  assert.match(draft, /PM-322\) Titel PM-322 · \*\*Knut\*\* · `Done` · Board: Done seit 03\.10\. <!--k:PM-322-->/);
  assert.match(draft, /> \[!note\]- 2 Tickets · Knut · 1 überfällig — hier kommentieren/);
  const auff = draft.slice(draft.indexOf('## Auffälligkeiten'), draft.indexOf('## Unklar geblieben'));
  assert.match(auff, /Keinem Paket zugeordnet.*\(1, Board-Stand\)/);
  assert.match(auff, /PM-500\) Titel PM-500 · Daniela/);
  assert.doesNotMatch(auff, /PM-501|PM-70\b/, 'vorher erledigt und Workstreams nicht');
  assert.match(draft, /Board-Stand, nicht Arbeitsstand/);
  // D3: nichts geht ungewollt nach Jira, das Antwortfeld wird als solches erkannt
  assert.equal(syncPlanRows(parseQuestions(draft)).length, 0);
  const q = parseQuestions(draft).find((x) => x.key === 'PM-321')!;
  assert.deepEqual(q.answers.map((a) => [a.speaker, a.kind]), [['Knut', 'empty']]);
  const filled = applyAnswer(draft, q.line, 'Knut', 'läuft');
  assert.deepEqual(syncPlanRows(parseQuestions(filled.text)).map((r) => [r.key, r.speaker, r.payload]), [['PM-321', 'Knut', 'läuft']]);
});

test('Review-Entwurf ohne S-Zeilen im Vorzyklus: eine Zeile „Ziel“ mit dem Ziel-Satz (D1, echte Notiz 28.09. falls vorhanden)', () => {
  const noS = PLANNING.replace(/## Ergebnisse[\s\S]*?(?=## 7)/, '');
  const { vars, stats } = reviewDraftVars({ date: '2026-10-12', prevId: 'sprint-2026-09-28', prevPlanning: noS, issues: new Map(), today: '2026-10-12' });
  assert.equal(stats.fallback, true);
  assert.match(vars.SOLL_IST, /keine Ergebniszeilen S1–S4/);
  assert.match(vars.SOLL_IST, /\| Ziel \| Die Sicherheitsfixes laufen auf Prod und sind nachgeprüft, und das Vertragspaket ist unterschrieben\. \| … \|/);
  assert.match(reviewDraftVars({ date: '2026-10-12', issues: new Map(), today: '2026-10-12' }).vars.SOLL_IST, /nichts zu bewerten/);
  const real = '/vault/olaf/1-Projects/sprint-2026-09-28';
  if (existsSync(real)) {
    const r = reviewDraftVars({ date: '2026-10-12', prevId: 'sprint-2026-09-28', prevReview: readFileSync(`${real}/sprint-2026-09-28-review.md`, 'utf8'), prevPlanning: readFileSync(`${real}/sprint-2026-09-28-planning.md`, 'utf8'), issues: new Map(), today: '2026-10-12' });
    assert.equal(r.stats.fallback, true);
    assert.ok(r.stats.packages >= 20);
    const d = newCycleFiles(TPL, '2026-10-12', 'sprint-2026-09-28', r.vars)[1].content;
    assert.equal(syncPlanRows(parseQuestions(d)).length, 0, 'echter Entwurf erzeugt keinen Jira-Eintrag');
    const upd = d.slice(d.indexOf('## Die Updates'), d.indexOf('## Auffälligkeiten'));
    const keys = [...upd.matchAll(/<!--k:([^>]+)-->/g)].map((m) => m[1]);
    assert.equal(keys.length, new Set(keys).size, 'jedes Ticket genau einmal in „Die Updates“');
  }
});

test('Mitnahme aus der Kopie: Gleichlauf mit jira-sprint-carry.sh (D10)', () => {
  const text = REVIEW.replace('## Pointers', '## Mitnahme in den nächsten Sprint\n\n- [PM-777](x) alt\n\n## Pointers')
    .replace('Fertig und getestet.', 'Fertig und getestet, siehe [PM-400](x).')
    .replace('  - → mitnehmen: Status', '  - ✓ 2026-09-29 → Planning: → mitnehmen: Status');
  const issues = new Map([
    ['PM-321', iss('PM-321', { duedate: '2026-10-01' })],
    ['PM-322', iss('PM-322', { status: 'Done', statusCategory: 'done' })],
    ['PM-400', iss('PM-400', { duedate: '2026-10-20' })],
    ['PM-777', iss('PM-777')],
    ['PM-900', iss('PM-900')],
  ]);
  const r = carryList(text, 'sprint-2026-09-28-review.md', issues, '2026-10-12');
  assert.deepEqual(r.groups, { overdue: ['PM-321'], dated: ['PM-400'], undated: [] }, 'Prosa-Link zählt, Done nicht, eigener Abschnitt nicht');
  assert.deepEqual(r.missing, ['PM-1', 'PM-331'], 'nicht in der Kopie wird genannt, nicht verschluckt (wie das Skript: jeder PM-Key im Text)');
  assert.equal(r.carry, 1, 'gestempelte Mitnahme-Zeile bleibt');
  assert.match(r.markdown, /^## Mitnahme in den nächsten Sprint\n/);
  assert.match(r.markdown, /### Überfällig \(1\)\n\n- \[PM-321\]\(.*\) \*\*Titel PM-321\*\* · Knut Peters · `To Do` · \*\*11 Tage über\*\* \(2026-10-01\)/);
  assert.match(r.markdown, /Status „bereit für Prod“ entscheiden — \[PM-322\]/);
  assert.match(r.markdown, /Board: 4 Tickets offen, davon 2 in dieser Liste/);
});

test('Aktueller Zyklus: neuester mit Datum ≤ heute, ein vorab angelegter Ordner zählt noch nicht (D7)', () => {
  const cs = [{ id: 'c', date: '2026-10-26', archived: false }, { id: 'b', date: '2026-10-12', archived: false }, { id: 'a', date: '2026-09-28', archived: true }];
  assert.equal(currentCycle(cs, '2026-10-24')!.id, 'b');
  assert.equal(currentCycle(cs, '2026-10-26')!.id, 'c');
  assert.equal(currentCycle([{ id: 'z', date: '2099-01-01', archived: false }], '2026-10-12')!.id, 'z', 'nur zukünftige → der nächste');
  assert.equal(currentCycle([], '2026-10-12'), undefined);
});

test('Review-Entwurf nach Knuts Rückmeldung 12.10.: To Do / Backlog mit Mitnahme-Frage / Ongoing getrennt, keine lokale Arbeit, keine Werkbank', () => {
  const prev = [
    '## Die Updates', '', '### Product', '',
    '#### Rechner', '', '> - [PM-1](x) a <!--k:PM-1-->', '> - [PM-2](x) b <!--k:PM-2-->', '> - [PM-3](x) c <!--k:PM-3-->', '> - [PM-4](x) d <!--k:PM-4-->', '',
    '#### Werkbank & lokale Stränge (nicht auf GitHub)', '', '> - [PM-9](x) lokal <!--k:PM-9-->', '',
    '#### Backlog Product: in diesen Sprint mitnehmen?', '', '- [PM-5](x) e <!--k:PM-5-->', '  - Knut: ja, fällig 20.10.', '',
    '### Laufende Aufgaben (Ongoing)', '', '> [!note] 1 Aufgabe', '> **Operations**', '> - [PM-6](x) f <!--k:PM-6-->', '',
    '## Auffälligkeiten', '',
  ].join('\n');
  const issues = new Map([
    ['PM-1', iss('PM-1', { status: 'In Progress', statusCategory: 'indeterminate' })],
    ['PM-2', iss('PM-2', { duedate: '2026-10-20' })],                              // fällig im Sprint → To Do
    ['PM-3', iss('PM-3', { status: 'Backlog', duedate: '2026-11-30' })],            // nach Sprintende → Backlog
    ['PM-4', iss('PM-4', { assignee: null })],                                    // ohne Datum, ohne Owner → Backlog
    ['PM-5', iss('PM-5', { duedate: '2026-10-20' })],                              // aus dem Backlog übernommen
    ['PM-6', iss('PM-6', { status: 'Ongoing', statusCategory: 'indeterminate', assignee: 'Daniela Martinez Alfaro' })],
    ['PM-7', iss('PM-7', { status: 'Ongoing', statusCategory: 'indeterminate', duedate: '2026-10-10' })],
    ['PM-9', iss('PM-9', { status: 'In Progress', statusCategory: 'indeterminate', created: '2026-10-01' })],
  ]);
  const { vars, stats } = reviewDraftVars({ date: '2026-10-12', prevId: 'sprint-2026-09-28', prevReview: prev, issues, today: '2026-10-12' });
  const d = newCycleFiles(TPL, '2026-10-12', 'sprint-2026-09-28', vars)[1].content;
  assert.doesNotMatch(d, /werkbank/i, 'Sprint-Notizen nennen die Werkbank nie');
  assert.doesNotMatch(d, /PM-9\b/, 'lokale Arbeit wird nicht übernommen, auch nicht als Waise');
  assert.deepEqual(stats.skipped, ['Werkbank & lokale Stränge (nicht auf GitHub)']);
  assert.match(d, /To Do heißt: in\nArbeit, fällig bis zum Ende des neuen Sprints \(26\.10\.2026\)/);
  assert.match(d, /Fertig heißt: getestet, auf Dev, dann auf Prod/);
  const pk = parsePackages(d);
  assert.deepEqual(pk.map((p) => [p.name, p.tickets]), [
    ['Rechner', ['PM-1', 'PM-2']],
    ['Aus dem Backlog übernommen', ['PM-5']],
    ['Backlog Product: in diesen Sprint mitnehmen?', ['PM-3', 'PM-4']],
  ]);
  assert.match(d, /PM-3\) Titel PM-3 · \*\*Knut\*\* · `Backlog` · fällig 30\.11\. — ❓ \*In diesen Sprint mitnehmen\?\* <!--k:PM-3-->\n  - Knut:\n/);
  assert.match(d, /PM-4\) Titel PM-4 · \*\*—\*\* · `To Do` · kein Datum — ❓ \*In diesen Sprint mitnehmen\? Ohne Owner\.\* <!--k:PM-4-->\n  - Knut:/);
  assert.doesNotMatch(d, /ja, fällig 20\.10\./, 'alte Antworten wandern nicht mit');
  const ong = d.slice(d.indexOf('### Laufende Aufgaben (Ongoing)'), d.indexOf('## Auffälligkeiten'));
  assert.match(ong, /> \[!note\] 2 Aufgaben · Daniela, Knut — hier kommentieren/);
  assert.match(ong, /> \*\*Operations\*\*\n> - \[PM-6\]/, 'Domäne aus dem Ongoing-Abschnitt des Vorzyklus');
  assert.match(ong, /> \*\*Weitere\*\*\n> - \[PM-7\].*Wirklich eine Daueraufgabe\?\* <!--k:PM-7-->\n>   - Knut:/);
  assert.equal(stats.backlog, 2); assert.equal(stats.ongoing, 2);
  // Backlog-Antwort „ja, fällig 23.10.“ wird beim Write-back zur Fälligkeit, nicht zum Kommentar.
  const q = parseQuestions(d).find((x) => x.key === 'PM-3')!;
  const rows = syncPlanRows(parseQuestions(applyAnswer(d, q.line, 'Knut', 'ja, fällig 23.10.').text));
  assert.deepEqual(rows.map((r) => [r.key, r.payload]), [['PM-3', 'ja, fällig 23.10.']]);
  assert.equal(syncPlanRows(parseQuestions(d)).length, 0);
});
