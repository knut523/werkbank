// R31 S3: werkbank_betrieb (Schalter aus Positivliste, .env.local-Zeile, Neustart-Art) und werkbank_stand (Soll/Ist ohne Werte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeWert, pruefeBetrieb, envSetzen, envWert, neustartFuer, liveAus, schalterStand, standText, wertKlasse, betriebAn, SCHALTER } from '../server/betrieb.ts';

test('Schalter aus: ohne WERKBANK_HAUPTCHAT_BETRIEB=on nichts', () => {
  assert.equal(betriebAn({}), false);
  assert.equal(betriebAn({ WERKBANK_HAUPTCHAT_BETRIEB: '1' }), false);
  assert.equal(betriebAn({ WERKBANK_HAUPTCHAT_BETRIEB: 'on' }), true);
});

test('Positivliste: nur bekannte Namen, nur aufgezählte Werte', () => {
  assert.deepEqual(pruefeWert('WERKBANK_HAUPTCHAT_GITHUB', 'on'), { wert: 'on' });
  assert.ok('fehler' in pruefeWert('WERKBANK_HAUPTCHAT_GITHUB', 'yes'));
  assert.ok('fehler' in pruefeWert('WERKBANK_HAUPTCHAT_GITHUB', 'on\nWERKBANK_INTERNAL_TOKEN=x'), 'kein Zeilenumbruch');
  assert.ok('fehler' in pruefeWert('PATH', '/tmp'));
  assert.deepEqual(pruefeWert('WERKBANK_KONTINGENT_SCHWELLE', ' 35 '), { wert: '35' });
  assert.ok('fehler' in pruefeWert('WERKBANK_KONTINGENT_SCHWELLE', '101'));
  assert.deepEqual(pruefeWert('WERKBANK_REGULAR_MODELL', 'melious:glm-5.3-flash'), { wert: 'melious:glm-5.3-flash' });
  assert.ok('fehler' in pruefeWert('WERKBANK_REGULAR_MODELL', 'melious:gpt-9'), 'nur Abo-Modelle');
});

test('Der Hauptchat kann sich keine Rechte freischalten', () => {
  for (const n of ['WERKBANK_HAUPTCHAT_BETRIEB', 'WERKBANK_GEHEIMNIS', 'WERKBANK_GEHEIMNIS_ZWECKE', 'WERKBANK_COOLIFY', 'WERKBANK_COOLIFY_APPS', 'WERKBANK_INTERNAL_TOKEN', 'WERKBANK_CREDS_KEY', 'BRIDGE_AUTO_EMAILS'])
    assert.ok('fehler' in pruefeWert(n, 'on'), n);
  assert.ok(SCHALTER.every((s) => !/BETRIEB|GEHEIMNIS|COOLIFY|TOKEN|KEY|SECRET/.test(s.name)));
});

test('pruefeBetrieb: Arten, 1–8 Schalter, Neustart vorgabemäßig an', () => {
  assert.deepEqual(pruefeBetrieb({ art: 'neustart' }), { art: 'neustart' });
  assert.deepEqual(pruefeBetrieb({ art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'auto' } }), { art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'auto' }, neustart: true });
  assert.equal((pruefeBetrieb({ art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'auto' }, neustart: false }) as any).neustart, false);
  assert.ok('fehler' in pruefeBetrieb({ art: 'schalter_setzen', schalter: {} }));
  assert.ok('fehler' in pruefeBetrieb({ art: 'loeschen' }));
  assert.ok('fehler' in pruefeBetrieb({ art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'auto', WERKBANK_COOLIFY: 'on' } }), 'ein verbotener Name kippt den ganzen Aufruf');
});

test('.env.local: eine Zeile ersetzen/anhängen, Doppelte zusammenführen, Rest unberührt', () => {
  const t = 'A=1\n# Kommentar\nWERKBANK_ZUARBEIT=melious\nB="x y"\nexport WERKBANK_ZUARBEIT=claude\n';
  const n = envSetzen(t, 'WERKBANK_ZUARBEIT', 'auto');
  assert.equal(n, 'A=1\n# Kommentar\nWERKBANK_ZUARBEIT=auto\nB="x y"\n');
  assert.equal(envSetzen('A=1', 'X_Y', 'on'), 'A=1\nX_Y=on\n');
  assert.equal(envSetzen('', 'X_Y', 'on'), 'X_Y=on\n');
  assert.equal(envSetzen('X_YZ=1\n', 'X_Y', 'on'), 'X_YZ=1\nX_Y=on\n', 'Präfix-Namen bleiben');
  assert.equal(envWert(t, 'WERKBANK_ZUARBEIT'), 'claude', 'letzte gewinnt');
  assert.equal(envWert(t, 'B'), 'x y');
  assert.equal(envWert(t, 'C'), null);
  assert.equal(envWert('S=on # an\n', 'S'), 'on');
});

test('Gegenprüfung: Soll nur als Wertklasse; envSetzen prüft selbst', () => {
  const st = schalterStand('WERKBANK_QUICK_MODELL=postgres://u:geheim@h/db\n', {}, {});
  assert.equal(st.find((s) => s.name === 'WERKBANK_QUICK_MODELL')!.soll, 'gesetzt');
  assert.throws(() => envSetzen('', 'A\nB', 'on'));
  assert.throws(() => envSetzen('', 'A_B', 'on\nX=1'));
});

test('Neustart-Art: nur Web-Schalter → restart-web, sonst restart', () => {
  assert.equal(neustartFuer(['WERKBANK_ZUARBEIT']), 'restart-web');
  assert.equal(neustartFuer(['WERKBANK_ZUARBEIT', 'BRIDGE_LEIT_VAULT_COMMIT']), 'restart');
  assert.equal(neustartFuer(['WERKBANK_HAUPTCHAT_GITHUB']), 'restart');
});

test('Live-Betreff: neues und altes Format', () => {
  assert.deepEqual(liveAus('Live = Release 30 (release/werkbank-2026-11-02 fbd6091): R29 + A 413'), { release: 'release/werkbank-2026-11-02', sha: 'fbd6091', titel: 'Release 30' });
  assert.deepEqual(liveAus('Live = release/werkbank-2026-10-12 (werkbank-gh 1a2b3c4)'), { release: 'release/werkbank-2026-10-12', sha: '1a2b3c4', titel: 'release/werkbank-2026-10-12' });
  assert.equal(liveAus('fix: etwas'), null);
});

test('Stand: Wertklassen ohne Geheimnisse, Soll/Ist, Neustart nötig', () => {
  assert.equal(wertKlasse('sk-ant-geheim'), 'gesetzt');
  assert.equal(wertKlasse('on'), 'on');
  assert.equal(wertKlasse(undefined), '—');
  const env = 'WERKBANK_ZUARBEIT=auto\nBRIDGE_LEIT_VAULT_COMMIT=on\nWERKBANK_INTERNAL_TOKEN=supergeheim\n';
  const st = schalterStand(env, { WERKBANK_ZUARBEIT: 'melious' }, { BRIDGE_LEIT_VAULT_COMMIT: 'on' });
  const z = st.find((s) => s.name === 'WERKBANK_ZUARBEIT')!;
  assert.deepEqual([z.soll, z.ist, z.neustart], ['auto', 'melious', true]);
  const v = st.find((s) => s.name === 'BRIDGE_LEIT_VAULT_COMMIT')!;
  assert.deepEqual([v.soll, v.ist, v.neustart], ['on', 'on', false]);
  const t = st.find((s) => s.name === 'WERKBANK_PR_TICKER')!;
  assert.equal(t.neustart, false, 'nicht gesetzt + läuft ohne Wert = Vorgabe = kein Neustart');
  const text = standText({ live: { release: 'release/werkbank-2026-11-02', sha: 'fbd6091', titel: 'Release 30' }, instanzKopf: 'fbd6091aaaa', releaseKopf: 'fbd6091bbbb', releaseVoraus: 0, schmutzig: 0, schalter: st, web: { seitS: 600 }, bruecke: { erreichbar: true, laufend: 2, schlange: 0, seitS: 7200 } });
  assert.doesNotMatch(text, /supergeheim|INTERNAL_TOKEN/);
  assert.match(text, /live = Release-Kopf ✅/);
  assert.match(text, /Neustart nötig für: WERKBANK_ZUARBEIT → werkbank_betrieb art=neustart_web/);
  const alt = standText({ live: { release: 'r', sha: 'aaaaaaa', titel: 'R' }, instanzKopf: null, releaseKopf: 'bbbbbbb', releaseVoraus: 3, schmutzig: 2, schalter: [], web: { seitS: 60 }, bruecke: { erreichbar: false } });
  assert.match(alt, /3 Commit\(s\) noch nicht live/);
  assert.match(alt, /2 geänderte Datei/);
  assert.match(alt, /NICHT erreichbar/);
});
