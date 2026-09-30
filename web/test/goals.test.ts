// Zielbaum aus olaf/1-Projects/ziele-olaf.md (festes Format), Lücken ‹…›, Labels ↔ IDs, Sprintziele alt/neu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoalsFile, goalTree, goalsOf, goalLabel, sprintGoalsFromOutcomes, normSprintGoalId, valueOf, hasGap } from '../server/goals.ts';
import { parseOutcomes } from '../server/sprint.ts';

const FILE = `---
title: "OLAF – Ziele"
---
# Ziele

## Ziele

| ID | Ebene | Ergebnis | Messgröße | Baseline | Ziel | Stichtag | Owner | Eltern-ID | Beleg |
|---|---|---|---|---|---|---|---|---|---|
| GATE-2701 | Gate | Am Stage Gate legt OLAF belegt vor. | alle KRs | – | Gate-Unterlage vorgelegt | ‹Mitte Januar 2027, genaues Datum fehlt – Quelle: Knut› | Knut | Gate-Kriterien [[innovation-process]] | Gate-Unterlage |
| KR1 | KR | Vertrieb liefert Kunden im Plan. | Zählpunkte | ‹Stand fehlt – Quelle: Cockpit› | ‹Jahresziel fehlt – Quelle: Knut› | 31.12.2026 | Knut | GATE-2701 | Cockpit |
| Z-SVC | Ziel | Service gut und skalierbar. | ‹fehlt› | ‹fehlt› | ‹fehlt› | ‹Gate› | Knut | GATE-2701 | ‹fehlt› |
| KR2 | KR | Partner überzeugt. | Stufen | kein Setup | alle drei | ‹fehlt – Quelle: Knut› | Knut | Z-SVC | Protokoll |
| KR3 | KR | Flex-Validierung. | Interviews | 0 | 15 | 31.12.2026 | Knut | GATE-2701 | PM-379 |
| M10-1 | Monat | Sicherheitslöcher zu. | offen = 0 | 3 | 0 | 31.10.2026 | Knut | KR2 | PM-402 |

Text danach.

## Bewertung

| ID | Datum | Ist | Bewertung | Beleg | Warum / was ändern wir |
|---|---|---|---|---|---|
| KR3 | 2026-10-15 | 4 Interviews | 🟡 | Protokolle | zu langsam |
| KR3 | 2026-10-01 | 0 | ❌ | – | Start |
`;

test('Ziele-Datei: feste Spalten, Eltern-ID, Lücken markiert und nicht als Wert, Tickets aus der Zeile, Bewertung', () => {
  const { goals, ratings } = parseGoalsFile(FILE);
  assert.deepEqual(goals.map((g) => g.id), ['GATE-2701', 'KR1', 'Z-SVC', 'KR2', 'KR3', 'M10-1']);
  const gate = goals[0];
  assert.equal(gate.parent, null, 'Gate ohne Eltern (Beleg-Text zählt nicht)');
  assert.deepEqual(gate.gaps, ['due']);
  assert.equal(valueOf(gate.due), null);
  assert.equal(goals.find((g) => g.id === 'KR2')!.parent, 'Z-SVC');
  assert.deepEqual(goals.find((g) => g.id === 'Z-SVC')!.gaps.sort(), ['baseline', 'due', 'evidence', 'metric', 'target']);
  assert.deepEqual(goals.find((g) => g.id === 'KR3')!.tickets, ['PM-379']);
  assert.equal(ratings.length, 2);
  assert.ok(hasGap('x ‹y›') && !hasGap('x'));
  assert.equal(valueOf('–'), null);
});

test('Baum: Eltern-ID, Fortschritt aus Labels + genannten Tickets, inkl. Unterziele, letzte Bewertung', () => {
  const { goals, ratings } = parseGoalsFile(FILE);
  const I = (key: string, status: string, labels: string[] = []) => ({ key, status, statusCategory: status === 'Done' ? 'done' : 'new', labels } as any);
  const issues = [I('PM-379', 'To Do'), I('PM-402', 'Done'), I('PM-500', 'Done', ['ziel-kr2']), I('PM-501', 'To Do', ['ziel-kr2', 'sprint-2026-09-28'])];
  const { roots, byId } = goalTree(goals, ratings, issues);
  assert.deepEqual(roots.map((r) => r.id), ['GATE-2701']);
  assert.deepEqual(byId.get('GATE-2701')!.children.map((c) => c.id), ['Z-SVC', 'KR1', 'KR3'], 'Ziel vor KR');
  assert.deepEqual(byId.get('Z-SVC')!.children.map((c) => c.id), ['KR2']);
  assert.deepEqual(byId.get('KR2')!.progress, { done: 1, total: 2 });
  assert.deepEqual(byId.get('KR2')!.subtree, { done: 2, total: 3 }, 'inkl. M10-1 (PM-402)');
  assert.deepEqual(byId.get('GATE-2701')!.subtree, { done: 2, total: 4 });
  assert.equal(byId.get('KR3')!.rating?.rating, '🟡');
});

test('Labels spiegeln die IDs (kleingeschrieben), Präfix konfigurierbar', () => {
  assert.equal(goalLabel('KR1'), 'ziel-kr1');
  assert.equal(goalLabel('S0928-1'), 'ziel-s0928-1');
  assert.deepEqual(goalsOf(['ziel-kr1', 'ziel-s0928-1', 'ziel-z-svc', 'sprint-2026-09-28', 'ziel-quatsch', 'Ziel-KR2']), ['KR1', 'S0928-1', 'Z-SVC', 'KR2']);
  process.env.WERKBANK_GOAL_LABEL_PREFIX = 'goal_';
  assert.equal(goalLabel('KR1'), 'goal_kr1');
  assert.deepEqual(goalsOf(['goal_kr1', 'ziel-kr2']), ['KR1']);
  delete process.env.WERKBANK_GOAL_LABEL_PREFIX;
});

test('Sprintziele: altes S1–S4 und neues S<MMTT>-<n> mit Eltern-ID, Anker bleibt', () => {
  const alt = `## Ergebnisse\n\n| # | Ergebnis | DoD | Owner | Datum |\n|---|---|---|---|---|\n| S1 <!--k:PM-331--> | Sicherheitsfixes | live | Knut | 02.10. |\n| S2 | Vertrag | PM-377 gezeichnet | Bernd | 09.10. |\n`;
  const o = parseOutcomes(alt);
  assert.equal(o[0].anchor, 'PM-331');
  assert.deepEqual(o[0].tickets, ['PM-331']);
  assert.equal(o[0].title, 'Sicherheitsfixes');
  assert.deepEqual(o[1].tickets, ['PM-377']);
  const g = sprintGoalsFromOutcomes(o, '2026-09-28');
  assert.deepEqual(g.map((x) => x.id), ['S0928-1', 'S0928-2']);
  const neu = `| ID | Ergebnis | DoD | Owner | Stichtag | Eltern-ID |\n|---|---|---|---|---|---|\n| S0928-1 | Löcher zu | 0 offen | Knut | 10.10. | M10-1 |\n- **S0928-2** Interviews gestartet · Owner: Lisa · Eltern-ID: KR3 <!--k:PM-379-->\n`;
  const n = parseOutcomes(neu);
  assert.deepEqual(n.map((x) => [x.id, x.parent, x.date ?? null]), [['S0928-1', 'M10-1', '10.10.'], ['S0928-2', 'KR3', null]]);
  assert.equal(n[1].anchor, 'PM-379');
  assert.equal(normSprintGoalId('S3', '2026-10-12'), 'S1012-3');
});

test('Jedes Ticket ein Ziel: eigenes Label oder vom Parent geerbt, Ausnahme ziel-keins, nur offene', async () => {
  const { effectiveGoals, needsGoal, sameLevelRemovals, goalLevel, exemptLabel } = await import('../server/goals.ts');
  const I = (key: string, o: any = {}) => ({ key, type: 'Task', status: 'To Do', statusCategory: 'new', parent: 'PM-70', labels: [], ...o });
  const xs = [
    I('PM-70', { type: 'Workstream', parent: null }),
    I('PM-1', { labels: ['ziel-kr1'] }),
    I('PM-2', { type: 'Sub-task', parent: 'PM-1' }),                   // erbt KR1
    I('PM-3'),                                                          // ohne Ziel
    I('PM-4', { labels: ['ziel-keins'] }),                              // Ausnahme
    I('PM-5', { type: 'Sub-task', parent: 'PM-4' }),                    // erbt Ausnahme
    I('PM-6', { status: 'Done', statusCategory: 'done' }),              // erledigt: egal
    I('PM-7', { labels: ['ziel-quatsch'] }),                            // kein gültiges Ziel
  ];
  const by = new Map(xs.map((x) => [x.key, x]));
  assert.deepEqual(effectiveGoals(xs[2] as any, by as any), { goals: ['KR1'], inherited: 'PM-1', exempt: false });
  assert.deepEqual(xs.filter((x) => needsGoal(x as any, by as any)).map((x) => x.key), ['PM-3', 'PM-7']);
  assert.equal(exemptLabel(), 'ziel-keins');
  assert.equal(goalLevel('S0928-1'), 'Sprint');
  assert.equal(goalLevel('KR2'), 'KR');
  assert.deepEqual(sameLevelRemovals(['ziel-kr1', 'ziel-s0928-1', 'ziel-keins', 'ziel-quatsch', 'sprint-2026-09-28'], 'KR3'), ['ziel-kr1', 'ziel-keins']);
  assert.deepEqual(sameLevelRemovals(['ziel-kr1', 'ziel-s0928-1'], 'S0928-2'), ['ziel-s0928-1', ]);
});

test('Runde 7: lokale Zuordnung gewinnt vor Jira-Label, ziel-keins lokal, gelöscht = kein Ziel, Sub-task erbt lokal; Sprint lokal', async () => {
  const { ownGoals, effectiveGoals, needsGoal, inSprint } = await import('../server/goals.ts');
  const I = (key: string, o: any = {}) => ({ key, type: 'Task', status: 'To Do', statusCategory: 'new', parent: 'PM-70', labels: [], ...o });
  const xs = [
    I('PM-70', { type: 'Workstream', parent: null }),
    I('PM-1', { labels: ['ziel-kr1'], localGoal: 'KR2' }),           // lokal gewinnt
    I('PM-2', { type: 'Sub-task', parent: 'PM-1' }),                  // erbt lokal KR2
    I('PM-3', { localGoal: 'KEINS' }),                                // Ausnahme lokal
    I('PM-4', { labels: ['ziel-kr1'], localGoal: null }),             // lokal entfernt → Label zählt nicht
    I('PM-5', { labels: ['ziel-kr1'] }),                              // nur Label (Fallback)
  ];
  const by = new Map(xs.map((x) => [x.key, x]));
  assert.deepEqual(ownGoals(xs[1] as any), ['KR2']);
  assert.deepEqual(effectiveGoals(xs[2] as any, by as any).goals, ['KR2']);
  assert.equal(effectiveGoals(xs[3] as any, by as any).exempt, true);
  assert.deepEqual(xs.filter((x) => needsGoal(x as any, by as any)).map((x) => x.key), ['PM-4']);
  assert.deepEqual(ownGoals(xs[5] as any), ['KR1']);
  assert.equal(inSprint({ labels: ['sprint-2026-09-28'] } as any, '2026-09-28'), true, 'Label als Fallback');
  assert.equal(inSprint({ labels: ['sprint-2026-09-28'], localSprints: { '2026-09-28': false } } as any, '2026-09-28'), false, 'lokal rausgenommen');
  assert.equal(inSprint({ labels: [], localSprints: { '2026-09-28': true } } as any, '2026-09-28'), true);
});

test('Runde 7: lokales Ziel ersetzt nur Label-Ziele derselben Ebene', async () => {
  const { ownGoals } = await import('../server/goals.ts');
  assert.deepEqual(ownGoals({ labels: ['ziel-kr1'], localGoal: 'S0928-1' } as any), ['S0928-1', 'KR1']);
  assert.deepEqual(ownGoals({ labels: ['ziel-kr1'], localGoal: 'KR2' } as any), ['KR2']);
  assert.deepEqual(ownGoals({ labels: ['ziel-kr1'], localGoal: 'KEINS' } as any), []);
});
