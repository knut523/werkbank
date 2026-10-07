// Projekte je Workstream (Plan 81, Schnitt 6; Knut 07.10.2026): zuordnen vor anlegen, Workstream = eigener Bereich
// im Vault, die Werkbank schreibt dort nur zwischen ihren Markern.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VAULT = mkdtempSync(join(tmpdir(), 'vault-projects-'));
mkdirSync(join(VAULT, 'olaf', '2-Areas', 'Product', 'Produkt-OLAF'), { recursive: true });
process.env.WERKBANK_VAULT_DIR = VAULT;
const MONGO = process.env.MONGO_URI_WERKBANK;
if (MONGO) process.env.WERKBANK_DB = `werkbank_projects_${process.pid}`;

let p: typeof import('../server/projects.ts');
let db: typeof import('../server/db.ts') | null = null;

before(async () => {
  p = await import('../server/projects.ts');
  if (MONGO) {
    db = await import('../server/db.ts');
    await db.connect();
  }
});
after(async () => { if (db) { await db.wb().dropDatabase().catch(() => {}); await db.closeDb(); } });

test('Begriffe: ohne Key, Füllwörter und kurze Wörter', () => {
  assert.deepEqual([...p.terms('PM-321 · BLZ-Liste für die Bankberater prüfen')].sort(), ['bankberater', 'liste']);
});

test('passt: zwei gemeinsame Begriffe oder ein langer', () => {
  assert.ok(p.matches('BLZ-Liste Bankberater', 'Bankberater: BLZ-Liste nachziehen'));
  assert.ok(p.matches('Sammelanmeldung', 'Sammelanmeldung für Gemeinden'), 'ein langer Begriff reicht');
  assert.ok(!p.matches('Cockpit Report', 'Report an MAXENERGY'), 'ein kurzer gemeinsamer Begriff reicht nicht');
});

test('Projektname: Titel ohne führenden Key', () => {
  assert.equal(p.projectNameFor({ summary: 'PM-12 · Tarifrechner Feedback' }), 'Tarifrechner Feedback');
  assert.equal(p.projectNameFor({ summary: '' }), 'Projekt');
});

test('Workstream-Slug wie die vorhandenen Ordner', () => {
  assert.equal(p.workstreamSlug('Vermarktung & GTM OLAF'), 'Vermarktung-GTM-OLAF');
  assert.equal(p.workstreamSlug('Telefonagent Partnerschaft & Venture Evaluierung'), 'Telefonagent-Partnerschaft-Venture-Evaluierung');
  assert.equal(p.workstreamSlug('Laufender Betrieb'), 'Laufender-Betrieb');
});

test('Workstream-Bereich: vorhandener Ordner wird genommen, sonst Domäne nach Titel, sonst Workstreams', () => {
  assert.equal(p.workstreamArea({ key: 'PM-70', summary: 'Produkt OLAF' }).dir, 'olaf/2-Areas/Product/Produkt-OLAF');
  assert.equal(p.workstreamArea({ key: 'PM-153', summary: 'Laufender Betrieb' }).dir, 'olaf/2-Areas/Operations/Laufender-Betrieb');
  assert.equal(p.workstreamArea({ key: 'PM-71', summary: 'Vermarktung & GTM OLAF' }).dir, 'olaf/2-Areas/Marketing/Vermarktung-GTM-OLAF');
  assert.equal(p.workstreamArea({ key: 'PM-155', summary: 'Telefonagent Partnerschaft & Venture Evaluierung' }).dir, 'olaf/2-Areas/Workstreams/Telefonagent-Partnerschaft-Venture-Evaluierung');
  assert.equal(p.workstreamArea({ key: 'PM-70', summary: 'Produkt OLAF' }).overview, 'olaf/2-Areas/Product/Produkt-OLAF/0-produkt-olaf-uebersicht.md');
});

test('Werkbank-Block: ersetzt nur zwischen den Markern, hängt sonst an', () => {
  const human = '# Bereich\n\nText der Menschen.\n';
  const once = p.spliceBlock(human, '- A');
  assert.ok(once.startsWith(human.trimEnd()), 'menschlicher Text bleibt vorn');
  assert.match(once, /<!-- werkbank:projekte -->\n- A\n<!-- \/werkbank:projekte -->/);
  const twice = p.spliceBlock(once + '\nNachtrag der Menschen.\n', '- B');
  assert.match(twice, /- B/);
  assert.doesNotMatch(twice, /- A/);
  assert.match(twice, /Nachtrag der Menschen\./, 'Text nach dem Block bleibt');
  assert.equal((twice.match(/<!-- werkbank:projekte -->/g) ?? []).length, 1, "ein Block, nicht zwei");
});

const user = { id: 'u1', name: 'Knut', email: 'knut@example.test' } as any;
const issue = (key: string, summary: string, ws: string | null, parent: string | null = null) =>
  ({ key, summary, workstream: ws, parent, type: 'Task', status: 'To Do', assignee: null, duedate: null, priority: null, updated: '', description: '', comments: 0 }) as any;

test('zuordnen vor anlegen: gleiches Ticket, passendes im Workstream, sonst neu; Workstream-Ticket bekommt keins', { skip: !MONGO }, async () => {
  const a = await p.assignProject(user, issue('PM-1', 'BLZ-Liste für Bankberater', 'PM-70'));
  assert.ok(a);
  assert.equal((await p.assignProject(user, issue('PM-1', 'BLZ-Liste für Bankberater', 'PM-70')))!._id, a!._id, 'gleiches Ticket');
  assert.equal((await p.assignProject(user, issue('PM-2', 'Bankberater sehen die BLZ-Liste', 'PM-70')))!._id, a!._id, 'passender Titel im Workstream');
  assert.notEqual((await p.assignProject(user, issue('PM-3', 'Bankberater sehen die BLZ-Liste', 'PM-71')))!._id, a!._id, 'anderer Workstream → eigenes Projekt');
  assert.equal((await p.assignProject(user, issue('PM-4', 'Sub-task ohne gemeinsame Wörter', 'PM-70', 'PM-1')))!._id, a!._id, 'Sub-task folgt dem Projekt seines Parents');
  assert.notEqual((await p.assignProject(user, issue('PM-5', 'Etwas ganz anderes', 'PM-70')))!._id, a!._id);
  assert.equal(await p.assignProject(user, { ...issue('PM-70', 'Produkt OLAF', null), type: 'Workstream' }), null);
});

test('Übersicht: legt den Bereich an, listet Projekte und Tickets, bleibt beim zweiten Mal stabil', { skip: !MONGO }, async () => {
  const ws = { key: 'PM-153', summary: 'Laufender Betrieb' };
  await p.assignProject(user, issue('PM-9', 'Service-Mails prüfen', 'PM-153'));
  const im = new Map([['PM-9', issue('PM-9', 'Service-Mails prüfen', 'PM-153')]]);
  const rel = await p.syncWorkstreamOverview(ws, im);
  const abs = join(VAULT, rel);
  assert.ok(existsSync(abs));
  const first = readFileSync(abs, 'utf8');
  assert.match(first, /^---\njira: PM-153/);
  assert.match(first, /### Service-Mails prüfen\n- \[PM-9\]/);
  writeFileSync(abs, first.replace('# Laufender Betrieb', '# Laufender Betrieb\n\nNotiz von Daniela.'));
  await p.syncWorkstreamOverview(ws, im);
  const second = readFileSync(abs, 'utf8');
  assert.match(second, /Notiz von Daniela\./, 'menschlicher Text bleibt');
  assert.equal((second.match(/### Service-Mails prüfen/g) ?? []).length, 1);
});
