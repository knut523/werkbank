import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopeCss } from '../src/altcss.ts';

test('scopeCss: jeder Selektor im Bereich, :root/body werden der Bereich, dunkles Thema und html/#root fallen weg', () => {
  const css = `/* x */ :root { --a: 1; } :root[data-theme='dark'] { --a: 2; } html, body, #root { height: 100%; } body { margin: 0; }
    .btn, a:hover { color: red; } body:has(.embedded) { x: y; }
    @media (max-width: 700px) { .row { gap: 0; } :root[data-theme='dark'] .x { c: d; } }
    @keyframes spin { from { a: b; } to { a: c; } }`;
  const aus = scopeCss(css, '.alt');
  assert.match(aus, /^\.alt\{ --a: 1; \}/m);
  assert.doesNotMatch(aus, /--a: 2|dark/);
  assert.match(aus, /^\.alt\{ height: 100%; \}/m, 'nur body bleibt von html, body, #root');
  assert.match(aus, /\.alt \.btn,\.alt a:hover\{ color: red; \}/);
  assert.match(aus, /\.alt:has\(\.embedded\)\{/);
  assert.match(aus, /@media \(max-width: 700px\)\{\.alt \.row\{ gap: 0; \}\n\}/);
  assert.match(aus, /@keyframes spin\{ from \{ a: b; \} to \{ a: c; \} \}/);
});

test('scopeCss: das echte alte Stylesheet — kein Selektor bleibt ohne Bereich', () => {
  const aus = scopeCss(readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8'), '.alt-seite');
  const ohne: string[] = [];
  let tiefe = 0, kopf = '', inKeyframes = 0;
  for (const z of aus.split(/([{}])/)) {
    if (z === '{') { const k = kopf.trim(); if (/^@keyframes/.test(k)) inKeyframes = tiefe + 1; if (!k.startsWith('@') && !inKeyframes) for (const s of k.split(',')) if (!s.trim().startsWith('.alt-seite')) ohne.push(s.trim()); tiefe++; kopf = ''; }
    else if (z === '}') { tiefe--; if (inKeyframes && tiefe < inKeyframes) inKeyframes = 0; kopf = ''; }
    else kopf = z;
  }
  assert.deepEqual(ohne, []);
});

test('ALT_SEITEN: jede eingehängte alte Seite gibt es im Router der alten Werkbank, jede 2.0-Adresse steht im Mehr-Menü', async () => {
  const { ALT_SEITEN, MEHR } = await import('../src/mehr.ts');
  const router = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  for (const s of ALT_SEITEN) {
    assert.ok(router.includes(`/^#\\/${s.hash.slice(2)}/.test(hash)`), `${s.hash} im alten Router`);
    assert.ok(MEHR.some((e) => e.url === s.pfad && e.alt === s.hash), `${s.pfad} im Mehr-Menü`);
  }
});
