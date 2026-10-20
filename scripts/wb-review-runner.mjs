// Im Wegwerf-Container (Plan 213 S7b, docker-remote): führt die Prüfbefehle aus spec.json aus und schreibt je Befehl eine
// JSON-Zeile auf stdout ({ name, befehl, code, signal, zeit, fehlt, ms, ausgabe }). Kein Netz (der Container hat keins),
// Zeitdeckel je Befehl, ganze Prozessgruppe wird beendet. Pfade: RUNNER_SPEC (Vorgabe /spec.json), RUNNER_SRC (/src).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const spec = JSON.parse(readFileSync(process.env.RUNNER_SPEC || '/spec.json', 'utf8'));
const src = process.env.RUNNER_SRC || '/src';
const deckel = spec.deckel ?? { befehlS: 600, gesamtS: 1800 };
const ende = Date.now() + deckel.gesamtS * 1000;
const zeile = (o) => process.stdout.write(JSON.stringify(o) + '\n');

const laufe = (argv, cwd, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  let out = '', zeit = false, fertig = false;
  const p = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const add = (b) => { out = (out + b.toString('utf8')).slice(-8000); };
  p.stdout.on('data', add); p.stderr.on('data', add);
  const t = setTimeout(() => { zeit = true; try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, ms);
  const fin = (code, signal, fehlt = false) => { if (fertig) return; fertig = true; clearTimeout(t); try { process.kill(-p.pid, 'SIGKILL'); } catch {} resolve({ code, signal, zeit, fehlt, ms: Date.now() - t0, ausgabe: out.trim().slice(-2000) }); };
  p.on('error', (e) => fin(null, null, e?.code === 'ENOENT'));
  p.on('close', (code, signal) => fin(code, signal));
});

for (const b of spec.befehle ?? []) {
  const befehl = (b.befehl ?? []).join(' ');
  const cwd = join(src, b.ordner || '.');
  if (!Array.isArray(b.befehl) || !b.befehl.length || String(b.ordner ?? '').split('/').includes('..')) { zeile({ name: b.name, befehl, code: null, fehlt: true, ms: 0, ausgabe: 'ungültiger Befehl' }); continue; }
  if (!existsSync(cwd)) { zeile({ name: b.name, befehl, code: null, fehlt: true, ms: 0, ausgabe: `Ordner ${b.ordner} fehlt` }); continue; }
  const rest = ende - Date.now();
  if (rest < 10_000) { zeile({ name: b.name, befehl, code: null, zeit: true, ms: 0, ausgabe: 'Gesamtzeit aufgebraucht' }); continue; }
  const r = await laufe(b.befehl, cwd, Math.min(rest, Math.min(deckel.befehlS, b.zeitS ?? deckel.befehlS) * 1000));
  zeile({ name: b.name, befehl, ...r });
}
