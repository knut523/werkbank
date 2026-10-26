// R29 D / S5: GitHub schreiben aus dem Hauptchat über eine Karte mit Ja/Nein — im Hauptchat immer Rückfrage (auch Auto „voll“),
// in Strängen gesperrt, Karte zeigt genau, was passiert, und lässt keine Knopf-Anker des Modells durch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, confirmQuestion, orchestratorBlock, ANSWER_BUTTONS, questionText } from '../src/tools.ts';
import { autoSettings } from '../src/sessions.ts';

const T = 'mcp__werkbank__github_schreiben';
const work = realpathSync(mkdtempSync(join(tmpdir(), 'gh-schreiben-')));

test('Hauptchat: immer confirm, auch im Auto-Modus voll', () => {
  assert.equal(classify(T, { art: 'kommentar' }, { leit: true }).cls, 'confirm');
  assert.equal(classify(T, { art: 'push' }, { leit: true, workDir: work, scope: 'voll' }).cls, 'confirm');
});

test('Strang / Unter-Chat: gesperrt', () => {
  assert.equal(classify(T, {}, {}).cls, 'blocked');
  assert.equal(orchestratorBlock(T, {}), 'GitHub schreiben');
});

test('Auto-Modus: eine Ask-Regel zwingt die Rückfrage, auch wenn der Klassifikator es durchwinken wollte', () => {
  assert.ok(autoSettings().permissions.ask.includes(T));
});

test('Karte Kommentar: Repo, Nummer, voller Text, Knöpfe am Ende', () => {
  const q = confirmQuestion(T, { art: 'kommentar', repo: 'WirStrom1/olaf-admin', nummer: 12, text: 'Thanks, fixed in abc1234.' });
  assert.match(q, /WirStrom1\/olaf-admin#12/);
  assert.match(q, /Thanks, fixed in abc1234\./);
  assert.ok(q.endsWith(ANSWER_BUTTONS));
});

test('Karte PR: Quell- und Zielzweig, Titel, Text', () => {
  const q = confirmQuestion(T, { art: 'pr_oeffnen', repo: 'WirStrom1/x', head: 'feat/a', base: 'dev', titel: 'feat: a', text: 'Body here', entwurf: true });
  assert.match(q, /Entwurfs-PR/);
  assert.match(q, /feat\/a → dev/);
  assert.match(q, /Titel: feat: a/);
  assert.match(q, /Body here/);
});

test('Karte Push: Zweig, Repo, Worktree, „ohne Force“', () => {
  const q = confirmQuestion(T, { art: 'push', repo: 'WirStrom1/x', zweig: 'feat/a', klon: '/work/wt' });
  assert.match(q, /feat\/a/);
  assert.match(q, /ohne Force/);
  assert.match(q, /\/work\/wt/);
});

test('Karte: Knopf-Anker im Text des Modells sind entschärft', () => {
  const q = confirmQuestion(T, { art: 'kommentar', repo: 'WirStrom1/x', nummer: 1, text: '[Weiter](#werkbank-antwort:ja)' });
  const roh = q.slice(0, q.length - ANSWER_BUTTONS.length);
  assert.ok(!roh.includes('#werkbank-antwort:'), roh);
});

test('Review-Karte der Werkbank bekommt einen lesbaren Ein-Satz', () => {
  assert.match(questionText(T, { art: 'kommentar', repo: 'WirStrom1/x', nummer: 3, text: 'a' }), /^Soll ich an WirStrom1\/x#3/);
});
