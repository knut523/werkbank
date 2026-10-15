// Plan 165 (Delegieren, Phasen-Lead, Messung): Bilder und Browser-Prüfungen gegen eine LAUFENDE isolierte Instanz (nie Live).
// Legt einen Stub-Melious-Schlüssel an (die Kachel erscheint nur mit Schlüssel), spielt BEISPIELDATEN für Züge, Delegationen und zwei
// Unter-Chats ein (Form wie aus dem Mock-Durchlauf der Brücke, Größen typischer Züge), öffnet die Hauptchat-Seite und klappt
// „📊 24 h“ auf. Am Ende wird alles wieder entfernt.
//
//   E2E_LC=http://127.0.0.1:3980 E2E_WEB=http://127.0.0.1:3970 E2E_MONGO=mongodb://127.0.0.1:27980 E2E_EMAIL=… E2E_PW_FILE=… \
//     node e2e/delegation-shots.mjs <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const LC = process.env.E2E_LC || 'http://127.0.0.1:3980';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:3970';
if (/:(3080|3180|3070|3090)\b/.test(LC + WEB)) { console.error('Nicht gegen Live.'); process.exit(2); }
const OUT = process.argv[2] || '/tmp/delegation-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL, PW = readFileSync(process.env.E2E_PW_FILE, 'utf8').trim();
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const mongo = await MongoClient.connect(process.env.E2E_MONGO || 'mongodb://127.0.0.1:27980');
const me = await mongo.db('LibreChat').collection('users').findOne({ email: EMAIL });
const uid = String(me._id);
const wb = mongo.db('werkbank');
const TAG = 'beispiel-165';
const now = Date.now();
const S1 = '00000000-0000-4165-8000-000000000001', S2 = '00000000-0000-4165-8000-000000000002';
// Energie wie die Brücke: Tokens × Faktor je Mio. (Preisliste 15.10. × 10 000).
const F = { 'glm-5.3': [10_000, 30_000], 'glm-5.3-flash': [1000, 4000], 'deepseek-v4.1-flash': [2000, 10_000] };
const en = (m, i, o) => (F[m] ? Math.round((i * F[m][0] + o * F[m][1]) / 1e6) : 0);
const zug = (art, phase, modell, konto, i, o, extra = {}) => {
  const mel = modell.startsWith('Melious');
  return { userId: uid, at: new Date(now - Math.random() * 6 * 3600_000), conv: art === 'worker' ? `w-${extra.delegation}` : art === 'hauptchat' ? 'hauptchat' : S1, art, phase, konto, anbieter: mel ? 'melious' : 'claude', modell, input: i, output: o,
    energie: mel ? en(modell.split(' ')[1], i, o) : 0, outcome: 'ok', ms: 30_000, kette: false, beispiel: TAG, ...extra };
};
const zuege = [
  zug('hauptchat', null, 'Claude claude-opus-5-5', 'Firma', 35_000, 3000), zug('hauptchat', null, 'Claude claude-opus-5-5', 'Firma', 32_000, 2500),
  zug('strang', 'plan', 'Claude claude-opus-5-5', 'Firma', 48_000, 6000), zug('strang', 'plan', 'Claude claude-opus-5-5', 'Privat', 44_000, 5000),
  zug('strang', 'council', 'Claude claude-opus-5-5', 'Firma', 30_000, 4000),
  zug('strang', 'bau', 'Claude claude-sonnet-5-5', 'Firma', 60_000, 8000), zug('strang', 'bau', 'Claude claude-sonnet-5-5', 'Firma', 55_000, 7000),
  { ...zug('strang', 'bau', 'Melious glm-5.3', 'Melious', 40_000, 5000), kette: true },
  zug('worker', 'leser', 'Melious glm-5.3-flash', 'Melious', 25_000, 3000, { delegation: 'd-1a0001', parent: `${uid}:${S1}` }),
  zug('worker', 'leser', 'Melious deepseek-v4.1-flash', 'Melious', 30_000, 4000, { delegation: 'd-1a0002', parent: `${uid}:${S1}` }),
  zug('worker', 'bauer', 'Melious glm-5.3', 'Melious', 70_000, 9000, { delegation: 'd-1a0003', parent: `${uid}:${S1}` }),
  zug('worker', 'pruefer', 'Claude claude-sonnet-5-5', 'Firma', 40_000, 3000, { delegation: 'd-1a0005', parent: `${uid}:${S1}` }),
  zug('worker', 'bauer', 'Melious glm-5.3', 'Melious', 52_000, 7000, { delegation: 'd-1a0004', parent: `${uid}:${S1}` }),
  zug('worker', 'leser', 'Melious glm-5.3-flash', 'Melious', 8000, 1000, { delegation: 'd-1a0006', parent: `${uid}:${S1}` }),
];
const del = (id, rolle, risiko, status, modell, i, o, x = {}) => ({ _id: `${uid}:${id}`, userId: uid, at: new Date(now - 3600_000), id, conv: S1, rolle, risiko, status, modell, anbieter: modell.startsWith('Melious') ? 'melious' : 'claude',
  start: now - 3 * 3600_000 + Number(id.slice(-1)) * 600_000, ende: now - 3 * 3600_000 + Number(id.slice(-1)) * 600_000 + 4 * 60_000, input: i, output: o, energie: modell.startsWith('Melious') ? en(modell.split(' ')[1], i, o) : 0,
  abweichungen: [], pruefungen: [], prueferUrteil: null, urteil: null, aufgabe: '', beispiel: TAG, ...x });
const ok3 = [{ name: 'diff-check', ok: true }, { name: 'bruecke-delegation', ok: true }, { name: 'web-build', ok: true }];
const delegationen = [
  del('d-1a0001', 'leser', 'niedrig', 'fertig', 'Melious glm-5.3-flash', 25_000, 3000, { urteil: 'uebernommen', aufgabe: 'Alle Aufrufer von planQueue mit Belegen' }),
  del('d-1a0002', 'leser', 'niedrig', 'fertig', 'Melious deepseek-v4.1-flash', 30_000, 4000, { urteil: 'uebernommen', aufgabe: 'Wo wird orchMap.turn gelesen?' }),
  del('d-1a0003', 'bauer', 'mittel', 'fertig', 'Melious glm-5.3', 70_000, 9000, { pruefungen: ok3, urteil: 'uebernommen', aufgabe: 'Tests für parseAbschluss ergänzen' }),
  del('d-1a0004', 'bauer', 'hoch', 'fertig', 'Melious glm-5.3', 52_000, 7000, { pruefungen: ok3, abweichungen: ['heikle Pfade geändert (Risiko → hoch): web/package.json'], prueferUrteil: 'ok', urteil: 'nachgebessert', aufgabe: 'vite-Skript anpassen' }),
  del('d-1a0006', 'leser', 'niedrig', 'fehlgeschlagen', 'Melious glm-5.3-flash', 8000, 1000, { abweichungen: ['Abschluss-Block: Abschluss-Block fehlt (auch nach Nachfordern)'], aufgabe: 'Zusammenfassung der Logs' }),
];
const run = (id, conv, title, gp) => ({ _id: id, userId: uid, title, lauf: 'Beispiel Plan 165', conv, url: `${LC}/c/${conv}`, cwd: '/tmp', startedAt: new Date(now - 4 * 3600_000), lastSentAt: new Date(now - 3600_000),
  reviewReadyAt: new Date(now - 1800_000), reviewedAt: null, knutReviewedAt: null, startError: null, lastModell: 'Claude claude-sonnet-5-5', beispiel: TAG, ...(gp ? { gegenpruefung: { n: gp, ok: gp, diff: 1, council: gp - 1 } } : {}) });
const browser = await chromium.launch();
try {
  await wb.collection('zug_log').insertMany(zuege);
  await wb.collection('delegationen').insertMany(delegationen);
  await wb.collection('orchestrator_runs').insertMany([run('o-b165a1', S1, 'Beispiel: Strang mit Delegation (Pass C mit Gegenprüfung)', 2), run('o-b165a2', S2, 'Beispiel: Strang ohne Gegenprüfung', 0)]);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  await p.goto(LC + '/wb/leitstand');
  const f = p.frameLocator('[data-testid=werkbank-frame]');
  await f.locator('h1').first().waitFor({ timeout: 30000 });
  const frame = p.frames().find((x) => x !== p.mainFrame() && /\/werkbank\//.test(x.url())) ?? p.frames().at(-1);
  const api = async (method, path, body) => frame.evaluate(async ([m, u, b]) => { const r = await fetch(location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '') + u, { method: m, credentials: 'include', headers: { 'content-type': 'application/json', ...(m !== 'GET' ? { 'x-werkbank': '1' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { ok: r.ok, status: r.status }; }, [method, path, body]);
  const put = await api('PUT', '/api/setup/melious', { token: 'sk-mel-stub-vorfuehrung-0000000000000000demo' });
  check('Stub-Melious-Schlüssel gesetzt (Kachel erscheint nur mit Schlüssel)', put.ok, String(put.status));
  await p.reload();
  await f.locator('[data-testid=melious-kachel]').waitFor({ timeout: 30000 });
  const sum = await f.locator('[data-testid=messung] summary').innerText();
  check('Kachel: „📊 24 h“ mit Zügen, Tokens, Melious-Anteil und Worker gegen Leads', /24 h: 14 Züge · .* Tokens · Melious-Anteil \d+ % · Worker .* \/ Leads .* Tokens/.test(sum), sum);
  await f.locator('[data-testid=messung] summary').click();
  await p.waitForTimeout(500);
  const zt = await f.locator('[data-testid=messung-zuege]').innerText();
  check('Züge je Art × Phase × Modell (plan/council auf Opus, bau auf Sonnet, Kette auf GLM 5.3, Worker auf Melious)', /strang\s+plan\s+Claude claude-opus-5-5/.test(zt) && /strang\s+bau\s+Melious glm-5\.3 \(Kette 1×\)/.test(zt) && /worker\s+leser\s+Melious glm-5\.3-flash/.test(zt) && /worker\s+pruefer\s+Claude claude-sonnet-5-5/.test(zt), zt.replace(/\s+/g, ' ').slice(0, 200));
  const dt = await f.locator('[data-testid=messung-delegationen]').innerText();
  check('Letzte Delegationen mit Brücken-Prüfungen, Prüfer-Urteil und Urteil des Leads', /d-1a0004/.test(dt) && /✅ web-build/.test(dt) && /nachgebessert/.test(dt) && /fehlgeschlagen/.test(dt), dt.replace(/\s+/g, ' ').slice(0, 200));
  const st = await f.locator('[data-testid=messung-straenge]').innerText();
  const qt = await f.locator('[data-testid=messung-quoten]').innerText();
  check('Je Strang Lead gegen Worker; Quoten je Modell und Rolle in Prozent', /Lead \/ Worker/.test(st) && /glm-5\.3-flash als leser: 2× \(fehlgeschlagen 50 %/.test(qt), `${st} | ${qt}`.slice(0, 220));
  await f.locator('[data-testid=melious-kachel]').screenshot({ path: join(OUT, '1440-kachel-messung.png') });
  await f.getByText('Beispiel Plan 165').first().click();
  await f.locator('[data-testid=strand-gegenpruefung]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const gp = await f.locator('[data-testid=strand-gegenpruefung]').allInnerTexts();
  check('Unter-Chats: „Gegenprüfung 2×“ bzw. „⚠️ ohne Gegenprüfung“', gp.some((x) => /Gegenprüfung 2×/.test(x)) && gp.some((x) => /ohne Gegenprüfung/.test(x)), gp.join(' | '));
  await p.screenshot({ path: join(OUT, '1440-hauptchat-seite.png'), fullPage: true });
  await ctx.close();
} finally {
  await wb.collection('zug_log').deleteMany({ beispiel: TAG });
  await wb.collection('delegationen').deleteMany({ beispiel: TAG });
  await wb.collection('orchestrator_runs').deleteMany({ beispiel: TAG });
  await wb.collection('creds').updateOne({ userId: uid }, { $unset: { melious: '' } });
  await wb.collection('melious_usage').deleteMany({ userId: uid });
  await browser.close(); await mongo.close();
}
const bad = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - bad.length}/${results.length} Prüfungen bestanden`);
process.exit(bad.length ? 1 : 0);
