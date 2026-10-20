// Wächter vor jedem Werkzeug des jcode-Workers / melious_sub (Release 20a, Nachtrag zu Fix 17e): jcode ruft den Hook `pre_tool`
// mit JCODE_HOOK_TOOL_NAME, JCODE_HOOK_CWD und JCODE_HOOK_PAYLOAD (JSON, tool_input als Text) auf; Exit 2 sperrt, stderr geht als
// Grund an das Modell (am 19.10. auf der Box belegt: Paket 213, u10-jcode-bewertung.md). Der Bash-Shim (jcode-bash-guard.ts) prüft
// nur die Shell — `read`/`agentgrep` hatten keine Grenze, ein Strang hätte über melious_sub .env.local oder /proc/*/environ lesen
// lassen können (an den Deny-Regeln von 17e vorbei).
// ponytail: Muster statt Sandbox wie beim Bash-Shim; Schreiben nur im Arbeitsordner. Im Zweifel (kaputte Eingabe) gesperrt.
import { resolve } from 'node:path';

// Was nie gelesen oder geschrieben werden darf: Umgebungsdateien, Prozess-Umgebung, Zugangsdaten der Werkzeuge.
const GEHEIM = [
  /(^|[\/\s'"=:])\.env(\.[\w.-]+)?($|[\/\s'"])/i,          // .env, .env.local, librechat/.env …
  /\/proc\//i, /environ(?![a-z])/i,                         // nicht „environment“
  /\.claude\/\.credentials/i, /\.claude\.json/i, /\.melious\//i, /\.jcode\/(auth|config|servers)/i,
  /\.ssh\//i, /id_(rsa|ed25519|ecdsa)/i, /\.netrc/i, /\.git-credentials/i, /werkbank\.creds/i, /\.aws\//i,
];
const SCHREIBEND = new Set(['write', 'edit', 'multiedit', 'patch', 'apply_patch']);

const texte = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) texte(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) texte(x, out);
  return out;
};
// wie im Bash-Shim: so prüfen, wie die Shell es sähe (ohne Quotes, Backslashes, $VAR)
const flach = (s: string) => s.replace(/['"\\]/g, '').replace(/\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]*\}/g, '');

/** Entscheidung für einen Werkzeugaufruf: null = erlaubt, sonst der Grund. */
export function jcodeEntscheid(tool: string, input: unknown, cwd: string): string | null {
  const t = tool.toLowerCase();
  const alle = texte(input).map(flach);
  if (alle.some((s) => GEHEIM.some((re) => re.test(s)))) return 'Abgelehnt (Werkbank-Wächter): Umgebungs- und Zugangsdateien (.env*, /proc, Schlüssel) sind für Melious-Teilagenten gesperrt.';
  if (SCHREIBEND.has(t)) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    // wie jcodeWritesOutside (sessions.ts): Pfad-Felder und die Dateizeilen eines Patches
    const pfade = [o.file_path, o.path, o.filePath, ...String(o.patch ?? o.input ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((x: any) => (Array.isArray(x) ? x[1] : x)).filter((x): x is string => typeof x === 'string' && !!x);
    if (!pfade.length) return 'Abgelehnt (Werkbank-Wächter): Schreiben ohne Pfad.';
    const wurzel = resolve(cwd);
    for (const p of pfade) { const ziel = resolve(cwd, p); if (ziel !== wurzel && !ziel.startsWith(wurzel + '/')) return `Abgelehnt (Werkbank-Wächter): Schreiben nur im Arbeitsordner (${wurzel}).`; }
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
