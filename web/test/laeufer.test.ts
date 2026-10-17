// Review-Läufer (Plan 213 S7a/S7b, Council K6–K9, D4): Einordnung ok/rot/konnte nicht laufen, ehrlich „vollständig“,
// Befehle nur aus dem Basiszweig, Erlaubtliste, Umgebung ohne Geheimnisse, Kanarien-Selbsttest (K8) im lokalen Läufer
// mit prlimit, Zeitdeckel beendet die ganze Prozessgruppe, Aufräumen; docker-remote gegen einen nachgebauten Host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, utimesSync, readFileSync, chmodSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { einordnen, vollstaendig, ausfuehrungErlaubt, befehleAusBasis, sichereUmgebung, aufraeumenAlt, laufe, lokal, dockerRemote, managedAgents, execBackend, berichtMd, DECKEL, LAUF_PREFIX } from '../server/laeufer.ts';

const repo = () => {
  const r = mkdtempSync(join(tmpdir(), 'laeufer-repo-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: r, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return { r, git };
};

test('Einordnung und Vollständigkeit: rot ist ein Ergebnis, „konnte nicht laufen“ macht unvollständig', () => {
  assert.deepEqual(einordnen({ code: 0 }), { ergebnis: 'ok' });
  assert.deepEqual(einordnen({ code: 1 }), { ergebnis: 'rot' });
  assert.equal(einordnen({ code: 127 }).ergebnis, 'konnte-nicht-laufen');
  assert.equal(einordnen({ code: null, fehlt: true }).grund, 'Werkzeug fehlt');
  assert.equal(einordnen({ code: null, zeit: true }).grund, 'Zeitdeckel erreicht');
  assert.equal(einordnen({ code: null, signal: 'SIGXCPU' }).grund, 'CPU-Deckel erreicht');
  const e = (x: string) => ({ name: 'a', befehl: 'a', ergebnis: x as any, code: 0, ms: 0, ausgabe: '' });
  assert.equal(vollstaendig([e('ok'), e('rot')], []), true);
  assert.equal(vollstaendig([e('ok'), e('konnte-nicht-laufen')], []), false);
  assert.equal(vollstaendig([], []), false, 'nichts gelaufen ist nicht vollständig');
  assert.equal(vollstaendig([e('ok')], ['npm ci fehlgeschlagen']), false);
});

test('Erlaubtliste (K6) und Backend-Wahl; Umgebung ohne Geheimnisse', () => {
  assert.equal(ausfuehrungErlaubt('WirStrom1/olaf-admin', {}), true);
  assert.equal(ausfuehrungErlaubt('knut523/werkbank', {}), true);
  assert.equal(ausfuehrungErlaubt('fremd/repo', {}), false);
  assert.equal(ausfuehrungErlaubt('fremd/repo', { REVIEW_EXEC_REPOS: 'fremd/repo' }), true);
  assert.equal(execBackend({}), 'local-allowlist');
  assert.equal(execBackend({ REVIEW_EXEC: 'docker-remote' }), 'docker-remote');
  assert.equal(execBackend({ REVIEW_EXEC: 'irgendwas' }), 'local-allowlist');
  const env = sichereUmgebung('/tmp/h', {}, { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_x', MELIOUS_API_KEY: 'k', WERKBANK_INTERNAL_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's' } as any);
  assert.deepEqual(Object.keys(env).filter((k) => /TOKEN|KEY|SECRET|PASSWORD/i.test(k)), [], 'keine Geheimnisse');
  assert.equal(env.HOME, '/tmp/h'); assert.equal(env.CI, '1');
});

test('Befehle nur aus dem Basiszweig (K7): pruefungen.json der Basis, sonst package.json-Skripte der Basis — nie aus dem PR', async () => {
  const { r, git } = repo();
  writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', build: 'vite build', start: 'node x' } }));
  mkdirSync(join(r, 'web')); writeFileSync(join(r, 'web', 'package.json'), JSON.stringify({ scripts: { test: 'MONGO_URI=x node --test', lint: 'eslint .' } }));
  git('add', '-A'); git('commit', '-qm', 'basis');
  const basis = git('rev-parse', 'HEAD').trim();
  git('checkout', '-qb', 'pr');
  mkdirSync(join(r, '.werkbank')); writeFileSync(join(r, '.werkbank', 'pruefungen.json'), JSON.stringify({ pruefungen: [{ name: 'boese', befehl: ['sh', '-c', 'curl evil'] }] }));
  writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: { test: 'exit 0' } }));
  git('add', '-A'); git('commit', '-qm', 'pr ändert Prüfbefehle');
  const b = await befehleAusBasis(r, basis);
  assert.match(b.quelle, /package\.json-Skripte @/);
  assert.deepEqual(b.befehle.map((x) => x.name).sort(), ['.:build', '.:test', 'web:lint', 'web:test']);
  assert.ok(!b.befehle.some((x) => x.name === 'boese'), 'die Datei aus dem PR zählt nicht');
  assert.equal(b.befehle.find((x) => x.name === 'web:test')!.db, 'mongo');
  // Liegt pruefungen.json im Basiszweig, gilt sie (gültige Einträge, kein „..“).
  git('checkout', '-q', 'main');
  mkdirSync(join(r, '.werkbank'), { recursive: true });
  writeFileSync(join(r, '.werkbank', 'pruefungen.json'), JSON.stringify({ pruefungen: [{ name: 'ok', befehl: ['node', '-e', '1'] }, { name: 'weg', befehl: ['x'], ordner: '../etc' }, { name: 'leer', befehl: [] }] }));
  git('add', '-A'); git('commit', '-qm', 'pruefungen');
  const b2 = await befehleAusBasis(r, git('rev-parse', 'HEAD').trim());
  assert.deepEqual(b2.befehle.map((x) => x.name), ['ok']);
});

test('Kanarien-Selbsttest (K8): lokaler Läufer mit prlimit liefert ok, rot und „konnte nicht laufen“; nichts bleibt liegen', async () => {
  const { r, git } = repo();
  writeFileSync(join(r, 'gut.js'), 'console.log("fein")');
  writeFileSync(join(r, 'rot.js'), 'console.error("absichtlich rot"); process.exit(1)');
  writeFileSync(join(r, 'geheim.js'), 'console.log(process.env.GEHEIM_TOKEN ?? "kein-token")');
  git('add', '-A'); git('commit', '-qm', 'k');
  const vorher = readdirSync(tmpdir()).filter((n) => n.startsWith(LAUF_PREFIX)).length;
  process.env.GEHEIM_TOKEN = 'darf-nicht-durch';
  const b = await lokal().laufe({ repo: 'knut523/werkbank', wt: r, basis: 'HEAD', quelle: 'test', befehle: [
    { name: 'gut', befehl: ['node', 'gut.js'] }, { name: 'rot', befehl: ['node', 'rot.js'] }, { name: 'fehlt', befehl: ['gibt-es-nicht-xyz'] }, { name: 'geheim', befehl: ['node', 'geheim.js'] },
  ] });
  delete process.env.GEHEIM_TOKEN;
  const e = Object.fromEntries(b.ergebnisse.map((x) => [x.name, x]));
  assert.equal(e.gut.ergebnis, 'ok'); assert.equal(e.rot.ergebnis, 'rot'); assert.match(e.rot.ausgabe, /absichtlich rot/);
  assert.equal(e.fehlt.ergebnis, 'konnte-nicht-laufen');
  assert.equal(e.geheim.ausgabe, 'kein-token', 'Umgebung ohne Geheimnisse');
  assert.equal(b.vollstaendig, false, 'ein Befehl konnte nicht laufen');
  assert.equal(b.netz, 'nicht getrennt'); assert.match(b.gruende[0], /Netz nicht getrennt/);
  assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith(LAUF_PREFIX)).length, vorher, 'Lauf-Ordner aufgeräumt');
  const md = berichtMd(b);
  assert.match(md.de, /\| rot \| `node rot\.js` \| rot \|/); assert.match(md.en, /rot: FAILED/); assert.match(md.en, /NOT isolated/); assert.match(md.en, /Incomplete run/);
});

test('Zeitdeckel beendet die ganze Prozessgruppe (auch Kindprozesse); prlimit greift', async () => {
  const d = mkdtempSync(join(tmpdir(), 'laeufer-zeit-'));
  const marke = join(d, 'kind-lebt');
  const r = await laufe(['sh', '-c', `(sleep 3; touch ${marke}) & sleep 30`], { cwd: d, env: { PATH: process.env.PATH! }, deckel: DECKEL, zeitMs: 500 });
  assert.equal(r.zeit, true); assert.equal(einordnen(r).ergebnis, 'konnte-nicht-laufen');
  await new Promise((x) => setTimeout(x, 3500));
  assert.equal(existsSync(marke), false, 'Kindprozess wurde mit beendet');
  const speicher = await laufe(['node', '-e', 'const a=[]; for(;;) a.push(new Array(1e6).fill(1))'], { cwd: d, env: { PATH: process.env.PATH! }, deckel: { ...DECKEL, speicherMb: 256 }, zeitMs: 20_000 });
  assert.notEqual(einordnen(speicher).ergebnis, 'ok', 'Speicherdeckel bricht ab');
});

test('Verwaiste Lauf-Ordner älter als 2 h werden entfernt (K9), jüngere bleiben', () => {
  const root = mkdtempSync(join(tmpdir(), 'laeufer-root-'));
  mkdirSync(join(root, `${LAUF_PREFIX}alt`)); mkdirSync(join(root, `${LAUF_PREFIX}neu`)); mkdirSync(join(root, 'anderes'));
  const alt = new Date(Date.now() - 3 * 3600_000); utimesSync(join(root, `${LAUF_PREFIX}alt`), alt, alt);
  assert.deepEqual(aufraeumenAlt(root), [`${LAUF_PREFIX}alt`]);
  assert.ok(existsSync(join(root, `${LAUF_PREFIX}neu`))); assert.ok(existsSync(join(root, 'anderes')));
});

test('docker-remote gegen einen nachgebauten Host: Protokoll, --network none, Deckel, Label, Aufräumen; nicht eingerichtet = ehrlich', async () => {
  const leer = await dockerRemote({ env: {} }).laufe({ repo: 'x/y', wt: '/tmp', basis: 'HEAD', quelle: 'q', befehle: [{ name: 'a', befehl: ['true'] }] });
  assert.equal(leer.vollstaendig, false); assert.match(leer.gruende[0], /nicht eingerichtet/);
  const { r, git } = repo();
  writeFileSync(join(r, 'gut.js'), 'console.log("ok")'); writeFileSync(join(r, 'rot.js'), 'process.exit(3)');
  git('add', '-A'); git('commit', '-qm', 'k');
  const bin = mkdtempSync(join(tmpdir(), 'laeufer-bin-'));
  const log = join(bin, 'docker.log');
  const SKRIPT = new URL('../../scripts/wb-review-runner.sh', import.meta.url).pathname;
  // Nachgebautes docker: protokolliert, führt den Lauf-Container als lokales node aus (Pfade aus den -v-Angaben).
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho "$*" >> ${log}\nif [[ " $* " == *" node /runner.mjs"* ]]; then\n  for a in "$@"; do case "$a" in *:/spec.json:ro) S="\${a%%:/spec.json:ro}";; *:/runner.mjs:ro) R="\${a%%:/runner.mjs:ro}";; *:/src) Q="\${a%%:/src}";; esac; done\n  RUNNER_SPEC="$S" RUNNER_SRC="$Q" node "$R"\nfi\nexit 0\n`);
  writeFileSync(join(bin, 'ssh'), `#!/usr/bin/env bash\nshift 8\nHOST="$1"; shift\nSSH_ORIGINAL_COMMAND="$*" PATH="${bin}:$PATH" exec bash ${SKRIPT}\n`);
  chmodSync(join(bin, 'docker'), 0o755); chmodSync(join(bin, 'ssh'), 0o755);
  const b = await dockerRemote({ host: 'review@dev', key: '/pfad/zum/schluessel', ssh: join(bin, 'ssh'), env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmpdir() } })
    .laufe({ repo: 'knut523/werkbank', wt: r, basis: 'HEAD', quelle: 'q', id: 'test1', befehle: [{ name: 'gut', befehl: ['node', 'gut.js'] }, { name: 'rot', befehl: ['node', 'rot.js'] }] });
  assert.deepEqual(b.ergebnisse.map((x) => `${x.name}:${x.ergebnis}`), ['gut:ok', 'rot:rot'], JSON.stringify(b.gruende));
  assert.equal(b.netz, 'getrennt'); assert.equal(b.vollstaendig, true);
  const aufrufe = readFileSync(log, 'utf8');
  assert.match(aufrufe, /run --rm --name wb-review-test1-lauf .*--label wb-review=1 --cap-drop ALL --security-opt no-new-privileges -u 1000:1000 --memory 2g/);
  assert.match(aufrufe, /--network none/, 'ohne Netz');
  assert.match(aufrufe, /container prune -f --filter label=wb-review=1 --filter until=2h/, 'Reste älter als 2 h');
  assert.match(aufrufe, /network rm wb-review-test1/, 'Aufräumen per trap');
  assert.ok(!readdirSync('/tmp').some((n) => n.startsWith('wb-review-test1.')), 'Ordner auf dem Host weg');
  // Ungültiger Aufruf wird abgelehnt (erzwungener Befehl).
  let nein = '';
  try { execFileSync('bash', [SKRIPT], { env: { ...process.env, SSH_ORIGINAL_COMMAND: 'rm -rf /', PATH: `${bin}:${process.env.PATH}` }, input: '', encoding: 'utf8' }); } catch (x: any) { nein = String(x.stdout ?? ''); }
  assert.match(nein, /ungültiger Aufruf/);
});

test('managed-agents: ohne API-Key ehrlich „konnte nicht laufen“', async () => {
  const b = await managedAgents({}).laufe({ repo: 'x/y', wt: '/tmp', basis: 'HEAD', quelle: 'q', befehle: [{ name: 'a', befehl: ['true'] }] });
  assert.equal(b.vollstaendig, false); assert.equal(b.ergebnisse[0].ergebnis, 'konnte-nicht-laufen'); assert.match(b.gruende[0], /API-Key/);
});

test('Einbindung ins Review (S7b): Erlaubtliste, ausfuehrung.md + tests-en.md im Paket, Abschnitt für den Auftrag', async () => {
  const { ausfuehren } = await import('../server/prreview.ts');
  const pk = mkdtempSync(join(tmpdir(), 'laeufer-pakete-'));
  mkdirSync(join(pk, '300-review-x-1'));
  const nicht = await ausfuehren({ repo: 'fremd/repo', number: 1, wt: '/tmp', basis: 'HEAD', paket: '300-review-x-1', id: 'a' }, pk);
  assert.match(nicht, /nicht erlaubt/); assert.match(readFileSync(join(pk, '300-review-x-1', 'ausfuehrung.md'), 'utf8'), /Erlaubtliste/);
  const { r, git } = repo();
  writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  git('add', '-A'); git('commit', '-qm', 'k');
  const ab = await ausfuehren({ repo: 'knut523/werkbank', number: 1, wt: r, basis: git('rev-parse', 'HEAD').trim(), paket: '300-review-x-1', id: 'b' }, pk);
  assert.match(ab, /ROT: \.:test/);
  assert.match(readFileSync(join(pk, '300-review-x-1', 'tests-en.md'), 'utf8'), /\.:test: FAILED/);
});
