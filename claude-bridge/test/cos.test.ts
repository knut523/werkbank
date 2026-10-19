// Chief of Staff (Plan 209, K17): Einstufung der Register-Werkzeuge — lesen frei, schreiben erst nach „ja“, im Strang gesperrt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, orchestratorBlock, confirmQuestion } from '../src/tools.ts';

test('zusagen ist read, die schreibenden Werkzeuge sind confirm — auch im Auto-Modus', () => {
  assert.equal(classify('mcp__werkbank__zusagen', {}).cls, 'read');
  for (const t of ['zusage_eintragen', 'zusage_aendern', 'thema_setzen']) {
    assert.equal(classify(`mcp__werkbank__${t}`, {}).cls, 'confirm', t);
    for (const ctx of [{ workDir: '/tmp' }, { workDir: '/tmp', scope: 'voll' as const }]) assert.equal(classify(`mcp__werkbank__${t}`, {}, ctx).cls, 'confirm', t);
  }
});

test('im Orchestrator-Strang sind die schreibenden Werkzeuge gesperrt, Lesen nicht', () => {
  for (const t of ['zusage_eintragen', 'zusage_aendern', 'thema_setzen']) assert.match(String(orchestratorBlock(`mcp__werkbank__${t}`, {})), /Register schreiben/, t);
  assert.equal(orchestratorBlock('mcp__werkbank__zusagen', {}), null);
});

test('Rückfrage nennt Wer → Wem: Was und bis wann', () => {
  const q = confirmQuestion('mcp__werkbank__zusage_eintragen', { zusagen: [{ wer: 'Christoph', was: 'PR prüfen', bis: '2026-10-30' }, { was: 'Ohne Namen', fristUnklar: true }] });
  assert.match(q, /2 Zusagen ins Zusagen-Register/);
  assert.match(q, /- Christoph → Knut: PR prüfen · bis 2026-10-30/);
  assert.match(q, /- Wer: offen → Knut: Ohne Namen · Frist unklar/);
});
