// „Agent ansetzen“: reine Funktionen, Schalter, simuliertes Jira, Sperre gegen Doppelklick (docs/plan-agent-ansetzen.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const DB = `werkbank_ansetzen_${randomBytes(4).toString('hex')}`;
process.env.WERKBANK_DB = DB;
process.env.MONGO_URI_WERKBANK ||= 'mongodb://127.0.0.1:27017';

const A = await import('../server/ansetzen.ts');
const { connect, wb, closeDb } = await import('../server/db.ts');

before(async () => { await connect(); });
after(async () => { await wb().dropDatabase(); await closeDb(); });

const spec = (over: Partial<any> = {}) => ({
  path: 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Service-View/3-Plan/service-spec-zaehler.md', name: 'service-spec-zaehler',
  title: 'olaf — Spec: Zählerstand-Erinnerung', topic: 'Service-View', state: '3-Plan', fm: {},
  text: '# Zählerstand\n\n**Ziel:** Erinnerung rechtzeitig.\n\n## Definition of Done\n\n- Mail 3 Tage vorher\n- ‹prüfbarer Satz›\n\n## Offene Punkte\n\n- Kanal?\n  - Knut: Mail\n', ...over,
});

test('Schalter: Vorgabe aus, unbekannte Werte aus, sim nur mit Vault-Kopie', () => {
  assert.deepEqual(A.ansetzenMode({}), { mode: 'aus', problem: null });
  assert.equal(A.ansetzenMode({ WERKBANK_ANSETZEN: 'live' }).mode, 'live');
  const typo = A.ansetzenMode({ WERKBANK_ANSETZEN: 'Live' });
  assert.equal(typo.mode, 'aus'); assert.match(typo.problem!, /Unbekannter Wert/);
  const sim = A.ansetzenMode({ WERKBANK_ANSETZEN: 'sim' });
  assert.equal(sim.mode, 'aus'); assert.match(sim.problem!, /Vault-Kopie/);
  assert.equal(A.ansetzenMode({ WERKBANK_ANSETZEN: 'sim', WERKBANK_VAULT_IS_COPY: '1' }).mode, 'sim');
});

test('Sperre (Bedingung 4), Ziel/DoD, Sprintende (E3), Entwurf nach OLAF-Konvention', () => {
  assert.equal(A.specGate(spec()).ok, true);
  assert.match(A.specGate(spec({ state: '2-Pre-Plan' })).why!, /nur für Specs in 3-Plan/);
  const open = A.specGate(spec({ text: '## Offene Punkte\n\n- Frage?\n  - Knut:\n' }));
  assert.equal(open.ok, false); assert.equal(open.open.length, 1);
  assert.equal(A.specGoal(spec().text), 'Erinnerung rechtzeitig.');
  assert.equal(A.specGoal('## Ziel\n\nDie Akte zeigt alles.\n\nZweiter Absatz.\n'), 'Die Akte zeigt alles.');
  assert.deepEqual(A.specDod(spec().text), ['Mail 3 Tage vorher'], 'Platzhalter fallen weg');
  assert.deepEqual(A.sprintEnd(['2026-09-28', '2026-10-12', '2026-10-26'], '2026-10-14'), { date: '2026-10-25', how: 'Sprintende (Sprint 2026-10-12)' });
  assert.equal(A.sprintEnd(['2026-10-12'], '2026-10-14').date, '2026-10-25');
  assert.match(A.sprintEnd([], '2026-10-14').how, /kein Sprintordner/);
  const d = A.ticketDraft(spec(), { mode: 'review', accountId: 'acc-k', ownerName: 'Knut', due: { date: '2026-10-25', how: 'x' } });
  assert.equal(d.summary, 'Zählerstand-Erinnerung'); assert.equal(d.parent, 'PM-70'); assert.equal(d.priority, 'Medium');
  assert.match(d.description, /^Ziel: Erinnerung rechtzeitig\.\nErgebnis: Plandatei, Umsetzung/);
  assert.match(d.description, /\nspec: service-spec-zaehler\n/);
  assert.match(A.ticketDraft(spec(), { mode: 'plan', accountId: 'a', ownerName: 'K', due: { date: 'x', how: 'x' }, parent: 'PM-73', summary: '  Eigener   Titel ' }).description, /Ergebnis: Plandatei \(Vault/);
});

test('Dubletten lokal und Suchanfrage; Schlüssel aus der MCP-Antwort streng lesen', () => {
  const issues = [
    { key: 'PM-1', summary: 'Zählerstand Erinnerung per Mail', status: 'To Do', description: '', type: 'Task' },
    { key: 'PM-2', summary: 'Ganz anderes', status: 'To Do', description: 'spec: service-spec-zaehler', type: 'Task' },
    { key: 'PM-3', summary: 'Anderes', status: 'Done', description: '', type: 'Task' },
    { key: 'PM-70', summary: 'Zählerstand Erinnerung', status: 'x', description: '', type: 'Workstream' },
  ];
  const dups = A.localDuplicates({ ...spec(), fm: { jira: 'PM-3' } }, issues as any);
  assert.deepEqual(dups.map((x) => x.key), ['PM-1', 'PM-2', 'PM-3'], 'Workstream nie');
  assert.deepEqual(dups.map((x) => x.why.slice(0, 8)), ['Titel: z', 'Spec-Ken', '`jira:` ']);
  const jql = A.dupJql(spec(), 'PM');
  assert.match(jql, /^project = PM AND \(summary ~ "Zählerstand-Erinnerung" OR .*text ~ "spec: service-spec-zaehler"\)/);
  assert.equal(A.parseCreatedKey('{"id":"10001","key":"PM-1001","self":"https://x/rest/api/3/issue/10001"}', 'PM-70', 'PM'), 'PM-1001');
  assert.equal(A.parseCreatedKey('Created issue PM-1002 under PM-70', 'PM-70', 'PM'), 'PM-1002');
  assert.equal(A.parseCreatedKey('Created PM-1 and PM-2', 'PM-70', 'PM'), null, 'mehrdeutig → unklar');
  assert.equal(A.parseCreatedKey('OK', 'PM-70', 'PM'), null);
  assert.equal(A.parseCreatedKey('{"key":"PM-70"}', 'PM-70', 'PM'), null, 'nie der Parent');
  const dev = A.deviations({ parent: 'PM-70', assigneeId: 'a', priority: 'Medium', duedate: '2026-10-25', ownerName: 'K' }, { key: 'PM-1', summary: '', parent: null, assigneeId: 'a', priority: 'Low', duedate: '2026-10-25', status: '', type: '' });
  assert.deepEqual(dev.map((d) => d.field), ['parent', 'priority']);
  assert.equal(A.addSimField('---\njira: PM-1\n---\nx', 'SIM-2'), '---\njira: PM-1\nsim-jira: SIM-2\n---\nx');
  assert.equal(A.addSimField('---\nsim-jira: SIM-2\n---\nx', 'SIM-2'), null);
});

test('Simuliertes Jira Ende-zu-Ende: ein Ticket, `sim-jira:` statt `jira:`, Doppelklick parallel = 1 Anlegen', async () => {
  const u = { id: 'u1', email: 'k@x', name: 'Knut Peters' };
  const sp = spec();
  const jira = A.simJira(u);
  let creates = 0;
  const counting = { ...jira, create: async (d: any) => { creates++; await new Promise((r) => setTimeout(r, 150)); return jira.create(d); } };
  const links: string[] = [];
  const agents: any[] = [];
  const deps = {
    jira: counting, mirror: async () => new Map(),
    linkSpec: async (_s: any, key: string, field: string) => { links.push(`${field}:${key}`); return 'ok'; },
    startAgent: async (issue: any, note: string, specPath: string) => { agents.push({ issue, note, specPath }); return { id: 'r1', conv: 'c1', url: 'https://chat/c/c1' }; },
  };
  const me = await jira.me();
  const draft = A.ticketDraft(sp, { mode: 'review', accountId: me.accountId, ownerName: me.displayName, due: { date: '2026-10-25', how: 'x' } });
  const [a, b] = await Promise.allSettled([A.runAnsetzen(u, sp, { mode: 'review', draft }, deps as any), A.runAnsetzen(u, sp, { mode: 'review', draft }, deps as any)]);
  const ok = [a, b].filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  const no = [a, b].filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1); assert.equal(no.length, 1);
  assert.equal(no[0].reason.status, 409, 'zweiter Klick während des Laufs: läuft schon');
  assert.equal(creates, 1);
  const r = ok[0].value;
  assert.match(r.key, /^SIM-\d+$/); assert.equal(r.ticket.url, null, 'kein Jira-Link für simulierte Tickets');
  assert.equal(r.readback.ok, true); assert.deepEqual(links, [`sim-jira:${r.key}`]);
  assert.equal(r.agent.state, 'gestartet'); assert.equal(agents[0].specPath, sp.path);
  assert.match(agents[0].issue.description, /^SIMULIERTES TICKET/);
  // Danach: weiterer Klick legt nichts an und startet keinen zweiten Agenten.
  const again = await A.runAnsetzen(u, sp, { mode: 'review', draft }, deps as any);
  assert.equal(again.key, r.key); assert.equal(creates, 1); assert.equal(agents.length, 1);
  assert.equal(await wb().collection('jira_issues').countDocuments({}), 0, 'simulierte Tickets nie in der Jira-Kopie');
});

test('Unklares Anlegen: nie automatisch ein zweites; erst nach ausdrücklicher Wahl', async () => {
  const u = { id: 'u2', email: 'k@x', name: 'Knut' };
  const sp = spec({ path: 'x/3-Plan/service-spec-unklar.md', title: 'olaf — Spec: Unklar' });
  const jira = A.simJira(u);
  let n = 0;
  const flaky = { ...jira, create: async (d: any) => { n++; if (n === 1) { await jira.create(d); throw new A.UnclearCreate('Zeit abgelaufen'); } return jira.create(d); }, search: async () => [] };
  const deps = { jira: flaky, mirror: async () => new Map(), linkSpec: async () => 'ok', startAgent: async () => ({ id: 'r', conv: 'c', url: 'u' }) };
  const draft = A.ticketDraft(sp, { mode: 'review', accountId: 'sim-u2', ownerName: 'Knut', due: { date: '2026-10-25', how: 'x' } });
  const r1 = await A.runAnsetzen(u, sp, { mode: 'review', draft }, deps as any);
  assert.equal(r1.needsChoice, 'unklar');
  const r2 = await A.runAnsetzen(u, sp, { mode: 'review', draft }, deps as any);
  assert.equal(r2.needsChoice, 'unklar'); assert.equal(n, 1);
  const r3 = await A.runAnsetzen(u, sp, { mode: 'review', draft, newTicket: true }, deps as any);
  assert.equal(n, 2); assert.match(r3.key, /^SIM-/);
});
