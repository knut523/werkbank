// Freigabe je Funktion fürs Team (web/server/features.ts): Admins alles; das Team nur WERKBANK_TEAM_FEATURES (Vorgabe:
// nichts); gesperrte API-Pfade → 403; Anmeldung, Einrichtung, Konfiguration bleiben offen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresFor, blockedFeature, featureOfPath, teamFeatures, FEATURES } from '../server/features.ts';

const admin = { role: 'ADMIN' }, user = { role: 'USER' };

test('Vorgabe: Team sieht nichts, Admin alles', () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.ok(Object.values(featuresFor(admin, env)).every(Boolean));
  assert.ok(Object.values(featuresFor(user, env)).every((v) => !v));
  assert.equal(Object.keys(featuresFor(user, env)).length, FEATURES.length);
});

test('WERKBANK_TEAM_FEATURES schaltet einzeln frei, Unbekanntes wird ignoriert', () => {
  const env = { WERKBANK_TEAM_FEATURES: ' heute, wissen ,quatsch' } as NodeJS.ProcessEnv;
  assert.deepEqual([...teamFeatures(env)].sort(), ['heute', 'wissen']);
  const f = featuresFor(user, env);
  assert.equal(f.heute, true); assert.equal(f.wissen, true); assert.equal(f.board, false);
});

test('API: gesperrte Pfade für das Team, offene Pfade immer, Admin nie gesperrt', () => {
  const env = { WERKBANK_TEAM_FEATURES: 'heute' } as NodeJS.ProcessEnv;
  assert.equal(blockedFeature(user, '/api/today', env), null);
  assert.equal(blockedFeature(user, '/api/board/issues', env), 'board');
  assert.equal(blockedFeature(user, '/api/roadmap/ansetzen', env), 'ansetzen');
  assert.equal(blockedFeature(user, '/api/roadmap', env), 'roadmap');
  assert.equal(blockedFeature(user, '/api/orchestrator/questions', env), 'orchestrator');
  for (const p of ['/api/config', '/api/setup/status', '/api/login', '/api/events', '/api/prefs', '/api/hygiene']) assert.equal(blockedFeature(user, p, env), null, p);
  assert.equal(blockedFeature(admin, '/api/board/issues', {} as NodeJS.ProcessEnv), null);
  assert.equal(featureOfPath('/api/boardx'), null, 'nur ganze Pfadstücke');
});
