// R29 D / S4: Profil „leser“ mit Web, Skills und lesenden Teilagenten — nur mit BRIDGE_LESER_ERWEITERT=on und nur auf Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leserErweitert, leserOptionen, leserAgents, LESER_BASIS } from '../src/profil.ts';

test('Vorgabe aus: Schalter nur bei „on“', () => {
  assert.equal(leserErweitert({}), false);
  assert.equal(leserErweitert({ BRIDGE_LESER_ERWEITERT: 'off' }), false);
  assert.equal(leserErweitert({ BRIDGE_LESER_ERWEITERT: 'on' }), true);
});

test('aus: Leser bleibt wie bisher', () => {
  const o = leserOptionen({ erweitert: false, melious: false });
  assert.deepEqual(o.tools, LESER_BASIS);
  assert.equal(o.skills, false);
  assert.equal(o.agents, false);
  assert.deepEqual(o.settingSources, []);
});

test('an, Claude: Web, Skill und Teilagenten dazu, Schreibwerkzeuge nie', () => {
  const o = leserOptionen({ erweitert: true, melious: false });
  for (const t of ['WebSearch', 'WebFetch', 'Skill', 'Agent']) assert.ok(o.tools.includes(t), t);
  for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.ok(!o.tools.includes(t), t);
  assert.equal(o.skills, true);
  assert.equal(o.agents, true);
  assert.deepEqual(o.settingSources, ['user']);
});

test('an, Melious (--bare): unverändert', () => {
  assert.deepEqual(leserOptionen({ erweitert: true, melious: true }), leserOptionen({ erweitert: false, melious: true }));
});

test('Teilagenten des erweiterten Lesers sind nur lesende Rollen', () => {
  assert.deepEqual(Object.keys(leserAgents()).sort(), ['leser', 'ticket-pruefer']);
});
