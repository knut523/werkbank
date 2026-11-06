// Wächter vor jedem Werkzeug des jcode-Workers / melious_sub (Release 20a, Nachtrag zu Fix 17e): jcode ruft den Hook `pre_tool`
// mit JCODE_HOOK_TOOL_NAME, JCODE_HOOK_CWD und JCODE_HOOK_PAYLOAD (JSON, tool_input als Text) auf; Exit 2 sperrt, stderr geht als
// Grund an das Modell (am 19.10. auf der Box belegt: Paket 213, u10-jcode-bewertung.md). Der Bash-Shim (jcode-bash-guard.ts) prüft
// nur die Shell — `read`/`agentgrep` hatten keine Grenze, ein Strang hätte über melious_sub .env.local oder /proc/*/environ lesen
// lassen können (an den Deny-Regeln von 17e vorbei).
// ponytail: Muster statt Sandbox wie beim Bash-Shim; Schreiben nur im Arbeitsordner. Im Zweifel (kaputte Eingabe) gesperrt.
import { resolve, dirname, basename, join, relative, posix } from 'node:path';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';

// Was nie gelesen oder geschrieben werden darf: Umgebungsdateien, Prozess-Umgebung, Zugangsdaten der Werkzeuge.
export const GEHEIM = [
  /(^|[\/\s'"=:])\.env(\.[\w.-]+)?($|[\/\s'"])/i,          // .env, .env.local, librechat/.env …
  /\/proc\//i, /environ(?![a-z])/i,                         // nicht „environment“
  /\.claude\/\.credentials/i, /\.claude\.json/i, /\.melious\//i, /\.jcode\/(auth|config|servers)/i,
  /\.ssh\//i, /id_(rsa|ed25519|ecdsa)/i, /\.netrc/i, /\.git-credentials/i, /werkbank\.creds/i, /\.aws\//i, /testkonten(-basic)?\.txt/i,   // J3: Passwörter der Testkonten nur für das Klickwerkzeug selbst (Dateiname, nicht jedes Erwähnen — Pass C S3)
  // Pass C (Claude, Fix-Runde 2, S3): dieselben Orte wie GEHEIM_MUSTER der opencode-2-Läufer — GitHub-Schreibschlüssel, Vaultwarden-
  // Sitzung, Konten der Brücke, Daten der opencode-2-Server (Prompts und Diffs aller Personen)
  /\.config\/gh\//i, /\.config\/vw\//i, /\.runtime\//i, /claude-accounts\.json/i, /\.local\/opencode2\//i,
  // Pass C (Runde 3): weitere Zugangs-Orte auf dieser Box (Coder-Sitzung, npm/Postgres/Docker/Kubernetes, Bitwarden-CLI, Shell-Verlauf, direnv)
  /\.config\/coderv2\//i, /\.npmrc/i, /\.pgpass/i, /\.docker\/config\.json/i, /\.kube\//i, /Bitwarden CLI/i, /\.\w*_history($|[\/\s'"])/i, /fish_history/i, /\.envrc/i,   // Gegenprüfung (B7): Verlauf nur als Punktdatei, nicht jedes chat_history
];

/** Pass C (Runde 3): echter Pfad eines (evtl. noch nicht vorhandenen) Ziels — der nächste vorhandene Vorfahr wird aufgelöst, damit ein
 *  Symlink im Arbeitsordner (z. B. node_modules der Delegation) nicht nach draußen führt. */
export function echterPfad(p: string, tiefe = 0): string {
  // Gegenprüfung (B5): lstat statt exists — ein hängender Symlink „existiert“ für exists nicht, writeFile folgt ihm aber nach draußen
  const da = (x: string) => { try { lstatSync(x); return true; } catch { return false; } };
  let kopf = p; const rest: string[] = [];
  while (!da(kopf)) { const o = dirname(kopf); if (o === kopf) break; rest.unshift(basename(kopf)); kopf = o; }
  try { return join(realpathSync(kopf), ...rest); } catch {
    // kopf ist ein hängender Symlink: seinem Ziel folgen (Tiefe begrenzt gegen Link-Zyklen)
    if (tiefe < 20) { try { return echterPfad(join(resolve(dirname(kopf), readlinkSync(kopf)), ...rest), tiefe + 1); } catch { /* unten */ } }
    return '/';   // unauflösbar: als „außerhalb“ werten
  }
}
/** Schreibziel prüfen: null = im Arbeitsordner und erlaubt. node_modules (geteilt per Symlink) und die Git-Verwaltung sind nie Ziel. */
export function schreibzielProblem(p: string, cwd: string): string | null {
  const wurzel = echterPfad(resolve(cwd)), ziel = echterPfad(resolve(cwd, p));
  if (ziel !== wurzel && !ziel.startsWith(wurzel + '/')) return `Abgelehnt (Werkbank-Wächter): Schreiben nur im Arbeitsordner (${resolve(cwd)}).`;
  if (/(^|\/)(node_modules|\.git)(\/|$)/.test(relative(wurzel, ziel))) return 'Abgelehnt (Werkbank-Wächter): node_modules und die Git-Verwaltung werden nicht direkt beschrieben.';
  return null;
}
const SCHREIBEND = new Set(['write', 'edit', 'multiedit', 'patch', 'apply_patch']);

// Gegenprüfung (B7): was ein Werkzeug schreibt (Inhalt, Ersetzung), ist kein Zugriff — nur Pfade und Befehle prüfen; aus einem Patch
// nur die Dateizeilen (sonst sperrte `const chat_history = []` oder `COPY .npmrc` im Dockerfile).
const INHALT = new Set(['content', 'contents', 'new_string', 'old_string', 'newString', 'oldString']);
const texte = (v: unknown, out: string[] = [], schreibend = false): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) texte(x, out, schreibend);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (schreibend && INHALT.has(k)) continue;
    if (schreibend && (k === 'patch' || k === 'input') && typeof x === 'string') { out.push(...[...x.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((m) => m[1] ?? m[2])); continue; }
    texte(x, out, schreibend);
  }
  return out;
};
/** Gegenprüfung (B1): Pfad-Wörter normalisieren (`//`, `/./`, `x/../`), damit `~/.config//gh/hosts.yml` die Sperre trifft. */
export const normPfade = (s: string) => s.split(/(\s+)/).map((w) => (w.includes('/') && !/^\s+$/.test(w) ? posix.normalize(w) : w)).join('');
// wie im Bash-Shim: so prüfen, wie die Shell es sähe (ohne Quotes, Backslashes, $VAR)
const flach = (s: string) => s.replace(/['"\\]/g, '').replace(/\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]*\}/g, '');

/** Entscheidung für einen Werkzeugaufruf: null = erlaubt, sonst der Grund. */
export function jcodeEntscheid(tool: string, input: unknown, cwd: string): string | null {
  const t = tool.toLowerCase();
  const alle = texte(input, [], SCHREIBEND.has(t)).flatMap((s) => [s, normPfade(flach(s))]);
  if (alle.some((s) => GEHEIM.some((re) => re.test(s)))) return 'Abgelehnt (Werkbank-Wächter): Umgebungs- und Zugangsdateien (.env*, /proc, Schlüssel) sind für Melious-Teilagenten gesperrt.';
  if (SCHREIBEND.has(t)) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    // wie jcodeWritesOutside (sessions.ts): Pfad-Felder und die Dateizeilen eines Patches
    const pfade = [o.file_path, o.path, o.filePath, ...String(o.patch ?? o.input ?? '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)]
      .map((x: any) => (Array.isArray(x) ? x[1] : x)).filter((x): x is string => typeof x === 'string' && !!x);
    if (!pfade.length) return 'Abgelehnt (Werkbank-Wächter): Schreiben ohne Pfad.';
    for (const p of pfade) { const grund = schreibzielProblem(p, cwd); if (grund) return grund; }
  }
  return null;
}

/** Eingabe des Hooks lesen: tool_input steht in JCODE_HOOK_PAYLOAD als JSON-Text (auch auf stdin). */
export function hookEingabe(env: NodeJS.ProcessEnv): { tool: string; input: unknown; cwd: string } | null {
  try {
    const p = JSON.parse(env.JCODE_HOOK_PAYLOAD ?? '');
    const roh = p.tool_input;
    const input = typeof roh === 'string' ? JSON.parse(roh) : roh;
    const tool = String(env.JCODE_HOOK_TOOL_NAME ?? p.tool_name ?? '');
    const cwd = String(env.JCODE_HOOK_CWD ?? p.cwd ?? '');
    return tool && cwd ? { tool, input, cwd } : null;
  } catch { return null; }
}

if (process.argv[1] && /jcode-pre-tool\.ts$/.test(process.argv[1])) {
  const e = hookEingabe(process.env);
  const grund = e ? jcodeEntscheid(e.tool, e.input, e.cwd) : 'Abgelehnt (Werkbank-Wächter): Werkzeugaufruf nicht lesbar.';
  if (grund) { process.stderr.write(grund); process.exit(2); }
  process.exit(0);
}
