// Knut 07.11. (council-tempo-0711.md, „Knut's decision“ und „I want more than 8“): Bauer auf GLM, Claude-Worker für Bauer 0,
// Leads standardmäßig Sonnet, Zulassung nach Kapazität (Kontingent, Energie, PR-Stau) mit sichtbarem „wartet: …“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bauerModell, leadModellVorgabe, workerClaudeMaxFuer, lockFor } from '../src/sessions.ts';
import { kapazitaetGrund, prDeckel, type Kapazitaet } from '../src/kapazitaet.ts';

test('Bauer-Modell: Code auf glm-5.3, Mechanik und Tests auf glm-5.3-flash; Schalter überstimmen', () => {
  assert.equal(bauerModell('Implementiere die Zulassung in sessions.ts'), 'glm-5.3');
  assert.equal(bauerModell('Schreibe Unit-Tests für kapazitaet.ts'), 'glm-5.3-flash');
  assert.equal(bauerModell('Umbenennung von foo nach bar, rein mechanisch'), 'glm-5.3-flash');
  assert.equal(bauerModell('Contest-Logik bauen'), 'glm-5.3', '„Contest“ ist kein Test');
  assert.equal(bauerModell('Code', { BRIDGE_BAUER_MODELL: 'glm-5.2' }), 'glm-5.2');
  assert.equal(bauerModell('tests', { BRIDGE_BAUER_MECHANIK_MODELL: 'deepseek-v4.1-flash-1017' }), 'deepseek-v4.1-flash-1017');
  assert.equal(bauerModell('Code', { BRIDGE_BAUER_MODELL: 'kaputt modell!' }), 'glm-5.3', 'ungültiger Name → Vorgabe');
});

test('Claude-Worker: Bauer 0 (BRIDGE_WORKER_CLAUDE_MAX_BAUER), andere Rollen wie bisher', () => {
  const vorher = { b: process.env.BRIDGE_WORKER_CLAUDE_MAX_BAUER, a: process.env.BRIDGE_WORKER_CLAUDE_MAX };
  delete process.env.BRIDGE_WORKER_CLAUDE_MAX_BAUER; delete process.env.BRIDGE_WORKER_CLAUDE_MAX;
  try {
    assert.equal(workerClaudeMaxFuer('bauer'), 0);
    assert.equal(workerClaudeMaxFuer('leser'), 1);
    process.env.BRIDGE_WORKER_CLAUDE_MAX_BAUER = '1';
    assert.equal(workerClaudeMaxFuer('bauer'), 1);
  } finally {
    if (vorher.b === undefined) delete process.env.BRIDGE_WORKER_CLAUDE_MAX_BAUER; else process.env.BRIDGE_WORKER_CLAUDE_MAX_BAUER = vorher.b;
    if (vorher.a === undefined) delete process.env.BRIDGE_WORKER_CLAUDE_MAX; else process.env.BRIDGE_WORKER_CLAUDE_MAX = vorher.a;
  }
});

test('Lead-Modell: Sonnet als Vorgabe, tief → Opus, ORCH_LEAD_MODELL überstimmt, „aus“ = Brücken-Vorgabe', () => {
  assert.equal(leadModellVorgabe('regular', {}), 'sonnet');
  assert.equal(leadModellVorgabe(undefined, {}), 'sonnet');
  assert.equal(leadModellVorgabe('deep', {}), 'opus');
  assert.equal(leadModellVorgabe('regular', { ORCH_LEAD_MODELL: 'opus' }), 'opus');
  assert.equal(leadModellVorgabe('regular', { ORCH_LEAD_MODELL: 'aus' }), undefined);
  assert.equal(leadModellVorgabe('regular', { ORCH_LEAD_MODELL: 'gpt' }), 'sonnet');
});

const k = (o: Partial<Kapazitaet> = {}): Kapazitaet => ({ meliousProzent: 60, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 2, ...o });

test('Zulassung: Kontingent, Energie (nur bauend), PR-Stau (nur neuer Strang); ohne Lage oder abgeschaltet frei', () => {
  assert.equal(kapazitaetGrund(k(), { neu: true, bauend: true }, {}), '');
  assert.match(kapazitaetGrund(k({ claudeFrei: false, claudeFreiAb: Date.UTC(2026, 10, 7, 14) }), { neu: false, bauend: false }, {}), /^wartet: Kontingent — kein Claude-Konto frei \(wieder ab 15:00\)/);
  assert.match(kapazitaetGrund(k({ unterBoden: true, meliousProzent: 15 }), { neu: false, bauend: true }, {}), /^wartet: Energie — Melious bei 15 %/);
  assert.equal(kapazitaetGrund(k({ unterBoden: true }), { neu: false, bauend: false }, {}), '', 'lesende Stränge laufen auf Claude weiter');
  assert.match(kapazitaetGrund(k({ prWartend: 6 }), { neu: true, bauend: true }, {}), /^wartet: PR-Stau — 6 PRs warten auf Knuts Go \(Deckel 6\)/);
  assert.equal(kapazitaetGrund(k({ prWartend: 9 }), { neu: false, bauend: true }, {}), '', 'laufender Strang macht seinen PR fertig');
  assert.equal(kapazitaetGrund(k({ prWartend: 6 }), { neu: true, bauend: true }, { BRIDGE_PR_DECKEL: '8' }), '');
  assert.equal(kapazitaetGrund(null, { neu: true, bauend: true }, {}), '');
  assert.equal(kapazitaetGrund(k({ claudeFrei: false }), { neu: true, bauend: true }, { BRIDGE_KAPAZITAET: 'aus' }), '');
  assert.equal(prDeckel({}), 6); assert.equal(prDeckel({ BRIDGE_PR_DECKEL: '0' }), 0); assert.equal(prDeckel({ BRIDGE_PR_DECKEL: 'x' }), 6);
});

test('Bedingung 6: Routine-Baubefehle freigegeben, harte Sperren bleiben (Deny geht vor), abschaltbar', async () => {
  const { ROUTINE_ALLOW, routineAllowAn, ORCH_DENY } = await import('../src/tools.ts');
  for (const r of ['Bash(npm test:*)', 'Bash(node --test:*)', 'Bash(git commit:*)']) assert.ok(ROUTINE_ALLOW.includes(r), r);
  assert.ok(!ROUTINE_ALLOW.some((r) => /push|merge|reset|rebase|curl|ssh|env/i.test(r)), 'nichts Gefährliches in der Allowlist');
  assert.ok(ORCH_DENY.some((r) => /^Bash\(git (\* )?push/.test(r)), 'Push bleibt gesperrt');
  assert.equal(routineAllowAn({}), true); assert.equal(routineAllowAn({ BRIDGE_ROUTINE_ALLOW: 'aus' }), false);
});

test('Parität Punkt 11: im Auto-Modus fragt GitHub-Schreiben per Bash (Hook läuft dort nicht), PR anlegen per gh nie; Lesen frei', async () => {
  const { autoSettings } = await import('../src/sessions.ts');
  const p = autoSettings().permissions;
  for (const r of ['Bash(git push:*)', 'Bash(git * push*)', 'Bash(gh pr comment:*)', 'Bash(gh api * -X *)']) assert.ok(p.ask.includes(r), r);
  assert.ok(p.deny.includes('Bash(gh pr create:*)'));
  assert.ok(!p.ask.some((r) => r === 'Bash(gh api:*)' || r === 'Bash(gh pr view:*)'), 'GitHub lesen bleibt frei');
  assert.ok(p.deny.includes('Bash(git merge:*)'));
});

test('Harte Obergrenze BRIDGE_MAX_PARALLEL_CHATS gilt weiter neben der Schätzung', () => {
  const vorher = process.env.BRIDGE_MAX_PARALLEL_CHATS;
  process.env.BRIDGE_MAX_PARALLEL_CHATS = '12';
  try {
    const l = Array.from({ length: 12 }, () => ({ readonly: false, mode: 'auto' as any, pending: null }));
    assert.equal(lockFor(l.slice(0, 11), { readonly: false, mode: 'auto' as any }), 'ok');
    assert.equal(lockFor(l, { readonly: false, mode: 'auto' as any }), 'chat-busy');
  } finally { if (vorher === undefined) delete process.env.BRIDGE_MAX_PARALLEL_CHATS; else process.env.BRIDGE_MAX_PARALLEL_CHATS = vorher; }
});
