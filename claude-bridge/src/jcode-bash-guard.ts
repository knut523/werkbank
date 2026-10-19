// Wächter für die Shell des jcode-Workers (Live-Fund 15.10., Pilot 183): jcode hat keine Sandbox und keine Pfadgrenze, ruft
// aber „bash“ über PATH auf. Die Brücke legt shim/ vorn in PATH; hier läuft nur, was readOnlyBash erlaubt (dieselbe Liste wie
// beim Claude-Leser: lesende Befehle, git nur lesend, keine Umleitung/Befehlsersetzung). Alles andere: Exit 126 mit Begründung.
// ponytail: Muster statt Sandbox — echte Isolation (bubblewrap) braucht sudo; bis dahin ist das die Grenze.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readOnlyBash } from './tools.ts';

const args = process.argv.slice(2);
const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
// jcode 0.98 übergibt den Befehl nicht direkt, sondern über eine feste Hülle, die eine Umgebungsvariable per eval ausführt.
// Nur genau diese Hülle wird ausgepackt; geprüft wird dann der Inhalt der Variable (dieselbe Umgebung läuft unten weiter).
const JCODE_HUELLE = 'eval "$JCODE_RELOAD_DETACH_COMMAND"; status=$?; printf \'\\n--- Command finished with exit code: %s ---\\n\' "$status"; exit "$status"';
const roh = i >= 0 ? args[i + 1] ?? '' : '';
const cmd = roh === JCODE_HUELLE ? process.env.JCODE_RELOAD_DETACH_COMMAND ?? '' : roh;

// 17c (Gegenprüfung): der Melious-Schlüssel steht in der Umgebung des jcode-Prozesses. Geprüft wird der Befehl so, wie bash
// ihn sähe: ohne Quotes, Backslashes und $VAR (aus `/pr''oc` oder `/pr$Xoc` macht bash den echten Pfad); Globs schaltet die
// Shell unten ab (-f), damit ein Muster wie `/pro?/*` nicht expandiert. Rekursive Suche, die bei / landet, ist gesperrt.
// ponytail: weiter Muster statt Sandbox — die Shell bekommt den Schlüssel gar nicht, das Ergebnis wird zusätzlich bereinigt.
const flach = cmd.replace(/['"\\]/g, '').replace(/\$[A-Za-z_][A-Za-z0-9_]*|\$\d|\$[@*#?$!-]/g, '');
const UMGEBUNG = ['env', 'printenv', 'export', 'set', 'declare', 'compgen'];
const REKURSIV = ['rg', 'grep', 'egrep', 'fgrep', 'find', 'tree', 'du'];
const SYSTEM = new RegExp(['pr', 'oc|envi', 'ron'].join(''), 'i');   // Prozess-Dateisystem und Umgebungsdateien
function gesperrt(): boolean {
  if (SYSTEM.test(flach)) return true;
  for (const seg of flach.split(/\|\||&&|[|;]/)) {
    const w = seg.trim().split(/\s+/);
    if (UMGEBUNG.includes(w[0])) return true;
    const rek = REKURSIV.includes(w[0]) || (w[0] === 'ls' && w.some((x) => /^-[a-zA-Z]*R/.test(x)));
    if (rek && w.slice(1).some((x) => !x.startsWith('-') && resolve(process.cwd(), x) === '/')) return true;
  }
  return false;
}
if (!cmd || !readOnlyBash(cmd) || gesperrt()) {
  process.stderr.write('Abgelehnt (Werkbank-Wächter): Im Melious-Worker sind nur lesende Shell-Befehle erlaubt (rg, grep, cat, head, tail, git log/show/diff …; kein sed), ohne Umleitung oder Befehlsersetzung. Dateien änderst du mit write/edit.\n');
  process.exit(126);
}
// Der Shell (und allem darunter) den Schlüssel gar nicht erst mitgeben; -f: keine Glob-Expansion.
const env = { ...process.env };
delete env.JCODE_PROVIDER_MELIOUS_API_KEY;
const r = spawnSync('/bin/bash', ['-f', ...args], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
