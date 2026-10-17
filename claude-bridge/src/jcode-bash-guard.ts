// Wächter für die Shell des jcode-Workers (Live-Fund 15.10., Pilot 183): jcode hat keine Sandbox und keine Pfadgrenze, ruft
// aber „bash“ über PATH auf. Die Brücke legt shim/ vorn in PATH; hier läuft nur, was readOnlyBash erlaubt (dieselbe Liste wie
// beim Claude-Leser: lesende Befehle, git nur lesend, keine Umleitung/Befehlsersetzung). Alles andere: Exit 126 mit Begründung.
// ponytail: Muster statt Sandbox — echte Isolation (bubblewrap) braucht sudo; bis dahin ist das die Grenze.
import { spawnSync } from 'node:child_process';
import { readOnlyBash } from './tools.ts';

const args = process.argv.slice(2);
const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
// jcode 0.98 übergibt den Befehl nicht direkt, sondern über eine feste Hülle, die eine Umgebungsvariable per eval ausführt.
// Nur genau diese Hülle wird ausgepackt; geprüft wird dann der Inhalt der Variable (dieselbe Umgebung läuft unten weiter).
const JCODE_HUELLE = 'eval "$JCODE_RELOAD_DETACH_COMMAND"; status=$?; printf \'\\n--- Command finished with exit code: %s ---\\n\' "$status"; exit "$status"';
const roh = i >= 0 ? args[i + 1] ?? '' : '';
const cmd = roh === JCODE_HUELLE ? process.env.JCODE_RELOAD_DETACH_COMMAND ?? '' : roh;
// 17c (Gegenprüfung): der Melious-Schlüssel steht in der Umgebung von jcode — Umgebung und /proc nicht lesbar machen.
const UMGEBUNG = /(^|[\s;|&(])(env|printenv|export|set|declare|compgen)(\s|$)|\/proc\/|\benviron\b/;
if (!cmd || !readOnlyBash(cmd) || UMGEBUNG.test(cmd)) {
  process.stderr.write('Abgelehnt (Werkbank-Wächter): Im Melious-Worker sind nur lesende Shell-Befehle erlaubt (rg, grep, cat, head, tail, git log/show/diff …; kein sed), ohne Umleitung oder Befehlsersetzung. Dateien änderst du mit write/edit.\n');
  process.exit(126);
}
// Der Shell (und allem darunter) den Schlüssel gar nicht erst mitgeben.
const env = { ...process.env };
delete env.JCODE_PROVIDER_MELIOUS_API_KEY;
const r = spawnSync('/bin/bash', args, { stdio: 'inherit', env });
process.exit(r.status ?? 1);
