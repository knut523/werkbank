// R31 S3: Coolify — nur Apps der Positivliste, Variablen nur mit Namen im Status, einzeilige Werte, POST/PATCH je nach Bestand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appMuster, appErlaubt, pruefeCoolify, fuehreAus, coolifyAn, type Api } from '../server/coolify.ts';

const M = appMuster({});

test('Schalter und Positivliste (Vorgabe knut-olaf-bot-demo*)', () => {
  assert.equal(coolifyAn({}), false);
  assert.equal(coolifyAn({ WERKBANK_COOLIFY: 'on' }), true);
  assert.ok(appErlaubt('knut-olaf-bot-demo', M));
  assert.ok(appErlaubt('knut-olaf-bot-demo-v5', M));
  assert.ok(!appErlaubt('olaf-admin-prod', M));
  assert.ok(!appErlaubt('xknut-olaf-bot-demo', M));
  const m2 = appMuster({ WERKBANK_COOLIFY_APPS: 'umfrage-test, a.b*, böse(.*)' });
  assert.ok(appErlaubt('umfrage-test', m2));
  assert.ok(!appErlaubt('umfrage-test2', m2));
  assert.ok(appErlaubt('a.bc', m2));
  assert.ok(!appErlaubt('axbc', m2), 'Punkt ist wörtlich');
  assert.equal(m2.length, 2, 'ungültige Muster fallen weg');
});

test('Aktion prüfen', () => {
  assert.deepEqual(pruefeCoolify({ art: 'deploy', app: 'knut-olaf-bot-demo' }, M), { art: 'deploy', app: 'knut-olaf-bot-demo' });
  assert.match((pruefeCoolify({ art: 'deploy', app: 'olaf-admin-prod' }, M) as any).fehler, /nicht freigegeben/);
  assert.match((pruefeCoolify({ art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'A B', value: 'x' }, M) as any).fehler, /key/);
  assert.match((pruefeCoolify({ art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'A', value: 'x\ny' }, M) as any).fehler, /einzeilig/);
  assert.match((pruefeCoolify({ art: 'loeschen', app: 'knut-olaf-bot-demo' }, M) as any).fehler, /art/);
});

function stubApi(envs: any[]): { api: Api; calls: string[] } {
  const calls: string[] = [];
  const api: Api = async (m, p, body) => {
    calls.push(`${m} ${p}${body ? ' ' + JSON.stringify(body) : ''}`);
    if (p === '/api/v1/applications') return { status: 200, json: [{ uuid: 'u1', name: 'knut-olaf-bot-demo', status: 'running:healthy', fqdn: 'https://bot.konekto.energy' }, { uuid: 'u2', name: 'andere' }], text: '' };
    if (p.endsWith('/envs') && m === 'GET') return { status: 200, json: envs, text: '' };
    if (p.startsWith('/api/v1/deployments/')) return { status: 200, json: [{ status: 'finished', created_at: '2026-11-02T10:00:00Z' }], text: '' };
    return { status: 200, json: {}, text: '{}' };
  };
  return { api, calls };
}

test('Status: Variablen nur mit Namen, nie Werte', async () => {
  const { api } = stubApi([{ key: 'OPENAI_KEY', value: 'sk-geheim-1234567' }, { key: 'MODE', value: 'demo' }]);
  const t = await fuehreAus({ art: 'status', app: 'knut-olaf-bot-demo' }, api);
  assert.match(t, /running:healthy/);
  assert.match(t, /MODE, OPENAI_KEY/);
  assert.doesNotMatch(t, /sk-geheim|demo,|value/);
  assert.match(t, /finished/);
});

test('Variable: neu → POST, vorhanden → PATCH; Neustart und Deploy rufen die richtigen Wege', async () => {
  const a = stubApi([{ key: 'MODE', value: 'x' }]);
  await fuehreAus({ art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'NEU', value: '1' }, a.api);
  assert.ok(a.calls.includes('POST /api/v1/applications/u1/envs {"key":"NEU","value":"1","is_preview":false}'));
  await fuehreAus({ art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'MODE', value: 'live' }, a.api);
  assert.ok(a.calls.some((c) => c.startsWith('PATCH /api/v1/applications/u1/envs')));
  await fuehreAus({ art: 'neustart', app: 'knut-olaf-bot-demo' }, a.api);
  assert.ok(a.calls.includes('GET /api/v1/applications/u1/restart'));
  await fuehreAus({ art: 'deploy', app: 'knut-olaf-bot-demo' }, a.api);
  assert.ok(a.calls.includes('POST /api/v1/deploy?uuid=u1'));
});

test('Unbekannte App oder HTTP-Fehler: klarer Fehler', async () => {
  const { api } = stubApi([]);
  await assert.rejects(fuehreAus({ art: 'deploy', app: 'knut-olaf-bot-demo-v9' }, api), /keine App/);
  const kaputt: Api = async () => ({ status: 401, json: null, text: 'Unauthenticated' });
  await assert.rejects(fuehreAus({ art: 'status', app: 'knut-olaf-bot-demo' }, kaputt), /HTTP 401/);
});
