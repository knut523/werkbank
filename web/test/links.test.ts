// Verknüpfung Vault ↔ Tickets: Keys in Frontmatter/Text/Jira-Links, PRs in derselben Zeile,
// Vorschläge für Seiten ohne Key, jira:-Frontmatter setzen (ohne den Rest der Notiz anzufassen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTicketRefs, addJiraFrontmatter, suggestTickets, tokens } from '../server/links.ts';
import { buildIndex } from '../server/vault.ts';

test('Ticket-Keys aus Frontmatter, Text und Jira-Links; PRs in derselben Zeile; Code zählt nicht', () => {
  const r = extractTicketRefs({ jira: ['PM-12', 'PM-13'], ticket: 'PM-14' }, [
    'Stand siehe PM-20 und https://maxenergy.atlassian.net/browse/PM-21.',
    'PR https://github.com/WirStrom1/olaf-admin/pull/171 gehört zu PM-20.',
    '`PM-99` im Code zählt nicht, OLAF-5 ist ein anderes Projekt.',
  ].join('\n'));
  assert.deepEqual(r.map((x) => `${x.key}:${x.via}`).sort(), ['PM-12:frontmatter', 'PM-13:frontmatter', 'PM-14:frontmatter', 'PM-20:text', 'PM-21:link']);
  assert.deepEqual(r.find((x) => x.key === 'PM-20')!.prs, ['https://github.com/WirStrom1/olaf-admin/pull/171']);
});

test('jira:-Frontmatter setzen: neu, Skalar → Liste, Blockliste, ohne Frontmatter, schon da', () => {
  assert.equal(addJiraFrontmatter('---\ntitle: A\n---\n# A\n', 'PM-1'), '---\ntitle: A\njira: PM-1\n---\n# A\n');
  assert.equal(addJiraFrontmatter('---\njira: PM-1\ntitle: A\n---\nx', 'PM-2'), '---\njira: [PM-1, PM-2]\ntitle: A\n---\nx');
  assert.equal(addJiraFrontmatter('---\njira:\n  - PM-1\ntitle: A\n---\nx', 'PM-2'), '---\njira:\n  - PM-1\n  - PM-2\ntitle: A\n---\nx');
  assert.equal(addJiraFrontmatter('---\njira: [PM-1]\n---\nx', 'PM-2'), '---\njira: [PM-1, PM-2]\n---\nx');
  assert.equal(addJiraFrontmatter('# Ohne\n', 'PM-3'), '---\njira: PM-3\n---\n# Ohne\n');
  assert.equal(addJiraFrontmatter('---\njira: PM-1\n---\nx', 'PM-1'), null, 'schon verknüpft');
});

test('Vorschläge: nur Seiten ohne Key, über Titel/Tags/Name, mit Grund', () => {
  assert.deepEqual(tokens('Service View: Kundenakte (Plan)'), ['service', 'view', 'kundenakte', 'plan']);
  const notes = [
    { path: 'a/service-view-kundenakte.md', name: 'service-view-kundenakte', title: 'Service View: Kundenakte', fm: { tags: ['service'] }, tickets: [] },
    { path: 'a/ocr.md', name: 'ocr', title: 'Bill-OCR Notizen', fm: {}, tickets: [] },
    { path: 'a/schon.md', name: 'schon', title: 'Service View Kundenakte alt', fm: {}, tickets: ['PM-9'] },
  ];
  const issues = [{ key: 'PM-401', summary: 'Service View Kundenakte bauen', status: 'To Do' }, { key: 'PM-267', summary: 'Bill-OCR Phase 1', status: 'Ongoing' }];
  const s = suggestTickets(notes as any, issues as any);
  assert.deepEqual(s.get('PM-401')!.map((x) => x.path), ['a/service-view-kundenakte.md']);
  assert.match(s.get('PM-401')![0].why, /kundenakte/);
  assert.deepEqual(s.get('PM-267')!.map((x) => x.path), ['a/ocr.md']);
});

test('Index: Tickets je Notiz und Notizen je Ticket (Fixture-Vault)', () => {
  const idx = buildIndex(new URL('./fixtures/vault', import.meta.url).pathname);
  const refs = idx.tickets.get('PM-321') ?? [];
  assert.ok(refs.length >= 1, 'PM-321 ist im Fixture-Vault erwähnt');
  const one = idx.notes.get(refs[0].path)!;
  assert.ok(one.tickets.includes('PM-321'));
});
