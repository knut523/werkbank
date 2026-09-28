// Task-Hygiene (Regeln, Identität, "später", höchstens 3 Fragen) und Kontext-Paket (Inhalt, Obergrenze, Cache-Schlüssel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hygieneFor, resolveIdentity, pickQuestions, freshState, snooze, slotFor, touchedToday, vienna, MAX_PER_SESSION } from '../server/hygiene.ts';
import { buildPack, approxTokens, inputsHash, TOKEN_CAP, hygieneBlock, roadmapLine, questionsLine, prLine, vaultMap } from '../server/context.ts';
import { buildIndex } from '../server/vault.ts';
import { actionsFromText } from '../server/syncplan.ts';
import type { Issue } from '../server/jira.ts';

const NOW = new Date('2026-09-28T10:00:00Z');
const I = (key: string, o: Partial<Issue>): Issue => ({
  key, summary: `Aufgabe ${key}`, status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Knut Peters', assigneeId: 'acc-knut',
  parent: 'PM-70', duedate: '2026-10-10', priority: 'Medium', updated: '2026-09-27T10:00:00Z', description: '', comments: 0, lastComment: null, ...o,
} as Issue);

const ISSUES: Issue[] = [
  I('PM-70', { type: 'Workstream', parent: null, duedate: null }),
  I('PM-1', { duedate: '2026-09-23' }),                                                      // überfällig 5 Tage
  I('PM-2', { duedate: null, status: 'In Progress', statusCategory: 'indeterminate', updated: '2026-09-15T10:00:00Z' }), // ohne Datum + still
  I('PM-3', { duedate: null, status: 'Backlog' }),                                          // Backlog ohne Datum: kein Punkt
  I('PM-4', { lastComment: { author: 'Knut', created: '2026-09-27T09:00:00Z', text: 'Ist erledigt und live.' } }), // Widerspruch
  I('PM-5', { lastComment: { author: 'Knut', created: '2026-09-27T09:00:00Z', text: 'Noch nicht erledigt, wartet auf Rogue.' } }), // kein Widerspruch
  I('PM-6', { parent: null }),                                                               // ohne Workstream
  I('PM-7', { type: 'Sub-task', parent: 'PM-1', assignee: null, assigneeId: null }),       // Sub-task ohne Owner unter eigenem Ticket
  I('PM-8', { status: 'Done', statusCategory: 'done', duedate: '2026-09-01' }),            // erledigt: nie
  I('PM-9', { assignee: 'Lisa Probe', assigneeId: 'acc-lisa', duedate: '2026-09-01' }),    // fremd
  I('PM-10', { status: 'In Progress', statusCategory: 'indeterminate', updated: '2026-09-10T10:00:00Z', lastComment: { author: 'x', created: '2026-09-26T10:00:00Z', text: 'läuft' } }), // Kommentar frisch → nicht still
];

test('Hygiene-Regeln auf eigenen Tickets', () => {
  const h = hygieneFor(ISSUES, { accountId: 'acc-knut' }, { now: NOW });
  const got = h.map((x) => `${x.key}:${x.rule}`).sort();
  assert.deepEqual(got, ['PM-1:überfällig', 'PM-2:ohne Datum', 'PM-2:still', 'PM-4:Widerspruch', 'PM-6:ohne Workstream', 'PM-7:Sub-task ohne Owner'].sort());
  assert.equal(h[0].key, 'PM-1', 'Überfälliges zuerst');
  assert.match(h[0].question, /^PM-1 \(„Aufgabe PM-1“\) ist seit 5 Tagen überfällig — Stand\? Neues Datum, erledigt, oder weiter\?$/);
  assert.equal(h.find((x) => x.rule === 'still')!.days, 13);
  assert.equal(hygieneFor(ISSUES, { accountId: 'acc-knut' }, { now: NOW, staleDays: 20 }).some((x) => x.rule === 'still'), false);
});

test('Identität ohne accountId: voller Name oder eindeutiger Vorname', () => {
  assert.equal(resolveIdentity({ name: 'Knut' }, ISSUES).accountId, 'acc-knut');
  assert.equal(resolveIdentity({ name: 'Knut Peters' }, ISSUES).displayName, 'Knut Peters');
  assert.equal(resolveIdentity({ name: 'Nemo' }, ISSUES).accountId, undefined);
  const two = [...ISSUES, I('PM-99', { assignee: 'Knut Anders', assigneeId: 'acc-ka' })];
  assert.equal(resolveIdentity({ name: 'Knut' }, two).accountId, undefined, 'mehrdeutiger Vorname → keine Zuordnung');
  assert.equal(hygieneFor(ISSUES, { name: 'Knut' }, { now: NOW }).length, 6);
});

test('Fragen nur zu Tagesbeginn und Tagesabschluss, höchstens drei, "später" gilt für heute', () => {
  const items = hygieneFor(ISSUES, { accountId: 'acc-knut' }, { now: NOW });
  let st = freshState(null, '2026-09-28');
  // erste Sitzung des Tages → Tagesbeginn
  assert.equal(slotFor(st, 9), 'morgen');
  const a = pickQuestions(items, st, 'chat-a', slotFor(st, 9));
  assert.equal(a.picked.length, MAX_PER_SESSION);
  assert.equal(new Set(a.picked.map((i) => i.key)).size, 3, 'je Ticket höchstens eine Frage');
  st = a.state;
  assert.deepEqual(pickQuestions(items, st, 'chat-a', null).picked.map((i) => i.key), a.picked.map((i) => i.key), 'gleiche Sitzung → gleiche Fragen');
  // weitere Sitzungen am Vormittag → keine Fragen
  assert.equal(slotFor(st, 11), null);
  const b = pickQuestions(items, st, 'chat-b', slotFor(st, 11));
  assert.deepEqual(b.picked, []);
  st = snooze(b.state, 'PM-6');
  // erste Sitzung ab 16 Uhr → Tagesabschluss, ohne heute schon Gefragtes und ohne "später"
  assert.equal(slotFor(st, 16), 'abend');
  const c = pickQuestions(items, st, 'chat-c', 'abend');
  assert.ok(c.picked.length <= 3 && c.picked.every((i) => !a.picked.some((x) => x.key === i.key && x.rule === i.rule) && i.key !== 'PM-6'));
  st = c.state;
  assert.equal(slotFor(st, 17), null, 'Tagesabschluss nur einmal');
  assert.equal(slotFor(st, 17, true), 'abend', 'Vorlage „Tagesabschluss“ geht immer');
  assert.deepEqual(freshState(st, '2026-09-29'), { date: '2026-09-29', snoozed: [], sessions: {}, slots: {} }, 'neuer Tag, neues Glück');
});

test('Tagesabschluss: heute angefasste eigene Tickets zuerst; Wiener Datum', () => {
  const t = touchedToday([...ISSUES, I('PM-50', { updated: '2026-09-28T09:00:00Z' })], { accountId: 'acc-knut' }, '2026-09-28');
  assert.deepEqual(t.map((i) => i.key), ['PM-50']);
  assert.match(t[0].question, /^Tagesabschluss: PM-50 .* hast du heute angefasst — Stand\? Fällig 10\.10\. — passt das noch\?$/);
  assert.equal(vienna(new Date('2026-09-28T22:30:00Z')).date, '2026-09-29', '00:30 in Wien ist schon der nächste Tag');
  assert.equal(vienna(new Date('2026-09-28T14:00:00Z')).hour, 16);
});

test('Vault-Karte: Rang nach Verlinkung und Nähe, festes Budget', () => {
  const idx = buildIndex(FIX);
  const m = vaultMap(idx, ['olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-planning.md'], 120);
  assert.match(m, /^Vault-Karte/);
  assert.ok(approxTokens(m) <= 130);
  assert.match(m, /\[\[sprint-2026-09-28-planning\]\]/);
  assert.doesNotMatch(m, /for-claude/, '_meta nicht');
});

test('Antwort → Jira-Aktion', () => {
  assert.deepEqual(actionsFromText('erledigt', { status: 'To Do', duedate: null }, 'Knut').actions, [{ type: 'status', to: 'Done', from: 'To Do' }]);
  assert.deepEqual(actionsFromText('neues Datum 15.10.2026', { status: 'To Do', duedate: '2026-09-23' }, 'Knut').actions, [{ type: 'due', date: '2026-10-15', from: '2026-09-23' }]);
  const c = actionsFromText('läuft, warte auf Rogue bis zum Termin nächste Woche', { status: 'To Do', duedate: null }, 'Knut (Task-Pflege, 28.09.2026)');
  assert.deepEqual(c.actions, [{ type: 'comment', text: 'Knut (Task-Pflege, 28.09.2026): läuft, warte auf Rogue bis zum Termin nächste Woche' }]);
});

const FIX = new URL('./fixtures/vault', import.meta.url).pathname;

test('Kontext-Paket: je Person, Zeiger, klein; Obergrenze greift', () => {
  const pack = buildPack({ vaultDir: FIX, projectsDir: join(FIX, 'olaf/1-Projects'), issues: ISSUES, who: { name: 'Knut' }, userName: 'Knut', now: NOW });
  assert.match(pack, /^## Werkbank-Kontext \(28\.09\.2026, für Knut\)/);
  assert.match(pack, /Deine PM-Tickets: 7 offen, 1 überfällig, 2 ohne Datum/);
  assert.match(pack, /Ziel „Die Sicherheitsfixes laufen auf Prod und sind nachgeprüft/);
  assert.match(pack, /Deine Ergebnisse: S1 Sicherheitsfixes auf Prod \(bis 02\.10\.\)/);
  assert.match(pack, /\[\[0-roadmap-produkt-olaf\]\]/);
  assert.match(pack, /vault-search/);
  assert.doesNotMatch(pack, /PM-9/, 'fremde Tickets nicht');
  assert.ok(approxTokens(pack) < 600, `klein: ${approxTokens(pack)}`);
  // Riesige Eingaben: Obergrenze
  const many = Array.from({ length: 3000 }, (_, k) => I(`PM-${1000 + k}`, { summary: 'x'.repeat(200), duedate: '2026-10-01' }));
  const big = buildPack({ vaultDir: FIX, projectsDir: join(FIX, 'olaf/1-Projects'), issues: many, who: { accountId: 'acc-knut' }, userName: 'Knut', now: NOW });
  assert.ok(approxTokens(big) <= TOKEN_CAP);
  assert.match(big, /3000 offen/, 'Zahlen statt Listen');
});

test('Kontext-Paket: Quellzeilen aus Roadmap, offenen Fragen, PR-Stand', () => {
  const road = '---\nlast-verified: 2026-09-26\n---\n# R\n## Woran wir gerade arbeiten\n\n**In Arbeit** — **Review und Merge durchbringen.** Rest\n\n**Als nächstes** — **neun Zweige als PR.**\n## Die acht Themen\n';
  assert.equal(roadmapLine(road), 'Roadmap Produkt OLAF (geprüft 26.09): In Arbeit: Review und Merge durchbringen · Als nächstes: neun Zweige als PR · acht Themen → [[0-roadmap-produkt-olaf]]');
  const q = '# Q\n## Die zehn Antworten, die am meisten freischalten\n\n1. ~~B1 · erledigt~~\n2. **B2 · Wer fährt die Prod-DB?** — Termin\n3. **B3 · Key rotieren** (Rang 1).\n## A\n- **A1 · x**\n';
  assert.match(questionsLine(q), /2 in der Top-Liste \(3 nummerierte insgesamt\); zuerst: B2 · Wer fährt die Prod-DB\? · B3 · Key rotieren/);
  assert.match(prLine('---\nlast-verified: 2026-09-28\n---\n## Heute eröffnet\n## Offen auf GitHub\n- #1 x\n- #2 y\n## Verlauf\n'), /PR-Stand \(geprüft 28\.09\): Heute eröffnet · Offen auf GitHub · 2 Einträge/);
});

test('Kontext-Paket: Cache-Schlüssel ändert sich nur, wenn sich Eingaben ändern', () => {
  const v = mkdtempSync(join(tmpdir(), 'ctx-'));
  cpSync(FIX, v, { recursive: true });
  const inp = { vaultDir: v, projectsDir: join(v, 'olaf/1-Projects'), issues: ISSUES, who: { name: 'Knut' }, userName: 'Knut', now: NOW };
  const h1 = inputsHash(inp, '2026-09-28T08:00:00Z');
  assert.equal(inputsHash(inp, '2026-09-28T08:00:00Z'), h1);
  assert.notEqual(inputsHash(inp, '2026-09-28T08:15:00Z'), h1, 'neuer Jira-Stand');
  const planning = join(v, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-planning.md');
  writeFileSync(planning, '---\ntitle: x\n---\n# neu\n');
  utimesSync(planning, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(inputsHash(inp, '2026-09-28T08:00:00Z'), h1, 'Planning geändert');
});

test('Hygiene-Block: Anweisung + höchstens die gewählten Fragen', () => {
  const items = hygieneFor(ISSUES, { accountId: 'acc-knut' }, { now: NOW }).slice(0, 3);
  const b = hygieneBlock(items, 6);
  assert.match(b, /Task-Hygiene zum Tagesbeginn \(6 offene Punkte, heute höchstens 3 fragen\)/);
  assert.match(hygieneBlock(items, 6, 'abend'), /^### Tagesabschluss/);
  assert.match(b, /eigentlichen Anfrage, die immer Vorrang hat/);
  assert.equal(b.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.equal(hygieneBlock([], 0), '');
});
