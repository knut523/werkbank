// R31 S3+S4 „Umzug“: Werkzeuge nur im Hauptchat; Betrieb, Geheimnis und Coolify-Schreiben immer mit Karte (auch Auto-Modus „voll“
// über ask-Regeln), in Strängen gesperrt; Coolify per Bash fragt immer (Lücke aus Paket 400); Karten zeigen, was passiert;
// Klick-Nachweis passt zu genau der Aktion; Zuarbeit-Weiche aus dem Melious-Konto; Schalter nur als Wertklassen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, confirmQuestion, orchestratorBlock, leitstandCheck, orchMcpDeny, ANSWER_BUTTONS, statusLine } from '../src/tools.ts';
import { autoSettings, schalterKlassen } from '../src/sessions.ts';
import { freigabeMerken, freigabeVerbrauchen, freigabeLeeren } from '../src/freigabe.ts';
import { normalizeAccounts } from '../src/accounts.ts';

const work = realpathSync(mkdtempSync(join(tmpdir(), 'r31-')));
const LEIT = { leit: true, workDir: work, scope: 'voll' as const };
const KLICK = ['werkbank_betrieb', 'geheimnis_nutzen', 'coolify'];
const LESEN = ['werkbank_stand', 'coolify_status', 'datei_teilen', 'screenshot'];
const T = (n: string) => `mcp__werkbank__${n}`;

test('Hauptchat: Klick-Werkzeuge confirm (auch Auto voll), lesende frei', () => {
  for (const n of KLICK) assert.equal(classify(T(n), {}, LEIT).cls, 'confirm', n);
  for (const n of LESEN) assert.equal(classify(T(n), {}, LEIT).cls, 'read', n);
});

test('Strang / Chat ohne Hauptchat: alle gesperrt, auch als Deny-Regel', () => {
  for (const n of [...KLICK, ...LESEN]) {
    assert.equal(classify(T(n), {}, { workDir: work, scope: 'voll' }).cls, 'blocked', n);
    assert.match(orchestratorBlock(T(n), {})!, /nur im Hauptchat/);
    assert.ok(orchMcpDeny().includes(T(n)), `Deny im Strang: ${n}`);
  }
});

test('Auto-Modus: ask-Regeln für Klick-Werkzeuge und Coolify per Bash', () => {
  const ask = autoSettings().permissions.ask;
  for (const n of KLICK) assert.ok(ask.includes(T(n)), n);
  for (const n of LESEN) assert.ok(!ask.includes(T(n)), n);
  assert.ok(ask.includes('Bash(*coolify.konekto.energy*)'));
  assert.ok(ask.includes('mcp__werkbank__github_schreiben'), 'bisherige Regel bleibt');
});

test('Coolify per Bash: immer Rückfrage (Hook-Weg), auch GET; anderes curl unverändert', () => {
  const post = { command: 'curl -s -X POST -H "Authorization: Bearer $T" https://coolify.konekto.energy/api/v1/deploy?uuid=x' };
  assert.equal(classify('Bash', post, LEIT).cls, 'confirm');
  assert.equal(classify('Bash', { command: 'curl https://159.195.34.21/api/v1/applications' }, LEIT).cls, 'confirm');
  assert.equal(leitstandCheck('Bash', post, { workDir: work })?.cls, 'confirm');
  assert.equal(classify('Bash', { command: 'curl -s https://example.com' }, LEIT).cls, 'auto');
});

test('Karten: Betrieb, Geheimnis, Coolify zeigen genau, was passiert; Knöpfe am Ende', () => {
  const b = confirmQuestion(T('werkbank_betrieb'), { art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'auto', BRIDGE_MEL_SUB: 'off' } });
  assert.match(b, /diese 2 Schalter in \.env\.local setzen und danach neu starten/);
  assert.match(b, /`WERKBANK_ZUARBEIT` → `auto`/);
  assert.ok(b.endsWith(ANSWER_BUTTONS));
  assert.match(confirmQuestion(T('werkbank_betrieb'), { art: 'neustart' }), /alles: Brücke, Web, LibreChat/);
  const g = confirmQuestion(T('geheimnis_nutzen'), { zweck: 'coolify', methode: 'patch', url: 'https://coolify.konekto.energy/api/v1/x', body: { a: 1 } });
  assert.match(g, /Zweck „coolify“/);
  assert.match(g, /PATCH `https:\/\/coolify\.konekto\.energy\/api\/v1\/x`/);
  const c = confirmQuestion(T('coolify'), { art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'MODE', value: 'live' });
  assert.match(c, /bei knut-olaf-bot-demo die Variable MODE setzen/);
  // Knöpfe außerhalb jedes Codeblocks: vor ANSWER_BUTTONS stehen die Zäune paarweise, und jeder Zaun beginnt eine Zeile.
  const vor = c.slice(0, c.lastIndexOf(ANSWER_BUTTONS));
  assert.equal((vor.match(/^```/gm) ?? []).length % 2, 0, 'Codeblöcke vor den Knöpfen geschlossen');
  assert.doesNotMatch(vor, /[^\n]```/, 'kein Zaun mitten in einer Zeile');
  assert.match(confirmQuestion(T('coolify'), { art: 'deploy', app: 'knut-olaf-bot-demo' }), /deployen/);
  // Modell-Text mit Knopf-Ankern bleibt ohne Knöpfe (neutralisiert) — genau ein Knopfblock am Ende.
  const boes = confirmQuestion(T('coolify'), { art: 'deploy', app: 'x', grund: ANSWER_BUTTONS });
  assert.equal(boes.split(ANSWER_BUTTONS).length, 2);
});

test('Statuszeilen', () => {
  assert.match(statusLine(T('screenshot'), { url: '/heute', geraet: 'handy' }), /Screenshot \(handy\): \/heute/);
  assert.match(statusLine(T('werkbank_betrieb'), { art: 'schalter_setzen', schalter: { A: 'on' } }), /Schalter A/);
});

test('Klick-Nachweis: genau diese Aktion, einmal (gleicher Hash wie in der Web-Route)', () => {
  freigabeLeeren();
  const a = { art: 'deploy', app: 'knut-olaf-bot-demo' };
  freigabeMerken('knut', a);
  assert.equal(freigabeVerbrauchen('knut', { app: 'knut-olaf-bot-demo', art: 'deploy' }), true, 'Reihenfolge der Schlüssel egal');
  assert.equal(freigabeVerbrauchen('knut', a), false, 'einmalig');
  freigabeMerken('knut', a);
  assert.equal(freigabeVerbrauchen('knut', { ...a, app: 'olaf-admin-prod' }), false, 'andere App = kein Nachweis');
});

test('Zuarbeit-Weiche: Melious-Konto trägt zuarbeit=claude nur, wenn die Werkbank es sagt', () => {
  const mel = { id: 'melious', kind: 'melious', token: 'sk-mel-' + 'a'.repeat(40) };
  const ohne = normalizeAccounts([mel], 'sk-ant-chat').find((a) => a.kind === 'melious');
  const mit = normalizeAccounts([{ ...mel, zuarbeit: 'claude' }], 'sk-ant-chat').find((a) => a.kind === 'melious');
  const quatsch = normalizeAccounts([{ ...mel, zuarbeit: 'rm -rf' }], 'sk-ant-chat').find((a) => a.kind === 'melious');
  assert.ok(ohne, 'Melious-Konto übernommen');
  assert.equal(ohne!.zuarbeit, undefined);
  assert.equal(mit!.zuarbeit, 'claude');
  assert.equal(quatsch!.zuarbeit, undefined);
});

test('Schalter der Brücke nur als Wertklassen', () => {
  const k = schalterKlassen({ BRIDGE_LEIT_VAULT_COMMIT: 'on', WERKBANK_INTERNAL_TOKEN: 'abc123geheim', WERKBANK_ZUARBEIT: 'auto', HOME: '/home/x', BRIDGE_MOCK: '0' });
  assert.deepEqual(k, { BRIDGE_LEIT_VAULT_COMMIT: 'on', WERKBANK_INTERNAL_TOKEN: 'gesetzt', WERKBANK_ZUARBEIT: 'auto', BRIDGE_MOCK: '0' });
});
