// Werkzeug-Einordnung und lesbare Statuszeilen.
//
// Vier Klassen:
//   read    – läuft ohne Rückfrage (Lesen, Suchen, Skills, Teilagenten)
//   confirm – Schreiben/Ausführen: erst nach "ja" im Chat
//   blocked – im Pilot nie erlaubt (GitHub-Schreiben, Push, Merge)
//   auto    – nur im Auto-Modus (mit Arbeitsordner): Bash und Edits im eigenen Arbeitsordner entscheidet der
//             Klassifikator des SDK (Plan 71 P1, Knut 06.10.2026). Ohne Arbeitsordner gibt es diese Klasse nie.

import { realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

export type ToolClass = 'read' | 'confirm' | 'blocked' | 'auto';

export const VAULT_DIR = process.env.BRIDGE_VAULT_DIR || '/vault';

const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch',
  'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Skill', 'Task', 'Agent',
  'ToolSearch', 'BashOutput', 'TaskOutput', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

// Lesende MCP-Werkzeuge erkennt man am Namen (Atlassian: get*/search*/lookup*/fetch …).
const MCP_READ = /^(get|search|lookup|fetch|list|atlassianUserInfo|memory_(search|get|recent|status|relations|list_namespaces|selftest))/;

// Bash-Befehle, die immer gesperrt sind, auch mit Bestätigung: Merge, Force-Push, Push auf die geschützten Zweige.
const BASH_BLOCKED: [RegExp, string][] = [
  [/\bgit\s+merge\b/, 'git merge'],
  [/\bgh\s+pr\s+merge\b/, 'GitHub-PR mergen'],
  [/\bgh\s+api\b[^|;&]*\/(merge|merges)\b/, 'Merge über die GitHub-API'],
  [/\/merge\b[^|;&]*github|github[^|;&]*\/merge\b/i, 'Merge über GitHub'],
  [/\bgit\s+push\b[^|;&]*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S)/, 'Force-Push'],
  [/\bgit\s+push\b[^|;&]*[\s:](main|master|develop)\b/, 'Push auf main/master/develop'],
];

// GitHub schreiben (Knut, 06.10.2026: „push only with acceptance or orders“): immer erst nach „ja“ im Chat — auch im
// Auto-Modus nie dem Klassifikator überlassen. Lesen (gh api ohne Schreib-Optionen, gh pr view/diff/list) bleibt frei.
const BASH_GITHUB_WRITE: [RegExp, string][] = [
  [/\bgit\s+push\b/, 'git push'],
  [/\bgh\s+pr\s+(create|comment|review|edit|close|reopen|ready)\b/, 'GitHub-PR schreiben'],
  [/\bgh\s+(issue|release|repo|label|secret|variable|workflow|gist)\s+(create|edit|close|delete|comment|reopen|set|run|enable|disable|fork|rename|archive|upload)\b/, 'GitHub schreiben'],
  [/\bgh\s+api\b[^|;&]*(-X|--method)\s*(POST|PATCH|PUT|DELETE)/i, 'GitHub-API schreiben'],
  [/\bgh\s+api\s+(?!graphql\b)[^|;&]*\s(-f|-F|--field|--raw-field|--input)\s/, 'GitHub-API schreiben'],
  [/\bgh\s+api\s+graphql\b[^|;&]*\bmutation\b/i, 'GitHub-API schreiben (GraphQL-Mutation)'],
  [/\bgh\s+api\s+graphql\b[^|;&]*\s--input\s/, 'GitHub-API schreiben (GraphQL aus Datei)'],
  [/api\.github\.com[^|;&]*(-X|--request)\s*(POST|PATCH|PUT|DELETE)/i, 'GitHub-API schreiben'],
  [/(-X|--request)\s*(POST|PATCH|PUT|DELETE)[^|;&]*api\.github\.com/i, 'GitHub-API schreiben'],
];

// Bash im Auto-Modus: was den Vault, Konfigurationen, Geheimnisse oder Jira berührt, bleibt beim „ja“. Heuristik —
// die eigentliche Grenze ist der Klassifikator mit permissions.deny und autoMode.hard_deny (templates/claude/settings.json).
const BASH_KEEP_CONFIRM = [
  /\.runtime\b/, /\.config\/vw\b/, /\.ssh\b/, /\.credentials/, /(^|[\s;&|(`$])bw\s/, /(^|[\s;&|(`$])sudo\b/,
  /atlassian|jira/i, /\.env\b/, /\.claude\b/,
];

/**
 * Deny-Regeln im Auto-Modus (als Flag-Settings je Zug, nur im Auto-Modus — im Not-Aus gilt keine davon). Deny greift vor
 * dem Klassifikator und auch gegen ein Hook-„allow“; darum hier **keine** Regel für den Vault oder Jira (die bleiben beim
 * „ja“ im Chat). Absolute Pfade beginnen mit //; die Konfigurationen je Person ergänzt die Brücke (homesRoot).
 */
export const AUTO_DENY = [
  // Kein git push / gh api / gh pr create hier: Deny schlägt auch ein „ja“ im Chat — GitHub-Schreiben fragt stattdessen
  // (BASH_GITHUB_WRITE), GitHub-Lesen ist frei (Knut, 06.10.2026).
  'Bash(git merge:*)', 'Bash(gh pr merge:*)', 'Bash(bw:*)',
  'Read(~/.config/vw/**)', 'Read(~/.ssh/**)', 'Read(~/.claude/.credentials.json)', 'Edit(~/.claude/**)', 'Read(**/.env*)',
];

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Echter Pfad: realpath des tiefsten vorhandenen Vorfahren + Rest (ein Symlink auf den Vault zählt als Vault). */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try { return [realpathSync(cur), ...rest.reverse()].join(sep).replace(/\/+/g, '/'); } catch { /* gibt es noch nicht */ }
    const up = dirname(cur);
    if (up === cur) break;
    rest.push(cur.slice(up.length).replace(/^\/+/, ''));
    cur = up;
  }
  return p;
}

const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith('/') ? dir : dir + '/');

export interface ClassifyContext {
  workDir?: string;   // Arbeitsordner der Person — nur im Auto-Modus gesetzt
  // Reichweite des Auto-Modus (BRIDGE_AUTO_SCOPE). „voll“ (Knut, 07.10.2026: „voll autonom wie hier“): auch Vault,
  // Repos, Gedächtnis und andere MCP-Werkzeuge entscheidet der Klassifikator. Rückfrage bleibt für Jira- und
  // GitHub-Schreiben und Geheimnisse; die Sperren bleiben. Ohne Angabe: nur der Arbeitsordner (Stand 06.10.2026).
  scope?: 'arbeitsordner' | 'voll';
}

// Voller Auto-Modus: Bash fragt nur noch bei Geheimnissen, fremden Konfigurationen und Jira-Schreiben nach.
// Runde 2 (Knut, 07.10.2026: „er fragt halt immer noch viel“): nur noch echte Geheimnis-ORTE, nicht jedes Erwähnen —
// `grep -v '.runtime'` oder `--exclude-dir=.runtime` fragen nicht mehr.
const BASH_KEEP_CONFIRM_VOLL = [
  /\.runtime\/(claude|werkbank\/creds)\b/, /claude-accounts\.json/, /\.config\/vw\b/, /\.ssh\b/, /\.credentials/,
  /(^|[\s;&|(`$])bw\s/, /(^|[\s;&|(`$])sudo\b/, /\.env\b/,
];
// Jira-Schreiben per Bash = ein HTTP-Aufruf an Atlassian, der schreibt. Lesen, grep nach „jira“, Dateinamen mit
// „atlassian“ gehen an den Klassifikator. Jira-Schreiben über den Atlassian-MCP fragt unabhängig davon weiter.
const ATLASSIAN_HOST = /(atlassian\.net|api\.atlassian\.com)/i;
const HTTP_WRITE = /(-X\s*(POST|PUT|PATCH|DELETE)\b|--request\s+(POST|PUT|PATCH|DELETE)\b|\s--data(-raw|-binary)?\b|\s-d\s|\s--json\b|\b(http|https)\s+(POST|PUT|PATCH|DELETE)\b)/i;
const bashTouchesJiraWrite = (cmd: string) => ATLASSIAN_HOST.test(cmd) && HTTP_WRITE.test(cmd);

/** Dateien, die auch der volle Auto-Modus nicht ohne „ja“ ändert: Werkbank-Zustand, Konfigurationen, Geheimnisse. */
function sensitiveTarget(target: string): boolean {
  return /(^|\/)(\.runtime|\.claude|\.ssh)(\/|$)|(^|\/)\.config\/vw(\/|$)|(^|\/)\.env[^/]*$/.test(target);
}

export function classify(tool: string, input: Record<string, unknown>, ctx: ClassifyContext = {}): { cls: ToolClass; why?: string } {
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    for (const [re, why] of BASH_BLOCKED) if (re.test(cmd)) return { cls: 'blocked', why };
    for (const [re, why] of BASH_GITHUB_WRITE) if (re.test(cmd)) return { cls: 'confirm', why };
    if (ctx.workDir && ctx.scope === 'voll') {
      if (BASH_KEEP_CONFIRM_VOLL.some((re) => re.test(cmd)) || bashTouchesJiraWrite(cmd)) return { cls: 'confirm' };
      return { cls: 'auto' };
    }
    if (ctx.workDir && !cmd.includes(VAULT_DIR) && !BASH_KEEP_CONFIRM.some((re) => re.test(cmd))) return { cls: 'auto' };
    return { cls: 'confirm' };
  }
  if (FILE_TOOLS.has(tool) && ctx.workDir) {
    const f = String(input.file_path ?? input.notebook_path ?? '');
    if (!f) return { cls: 'confirm' };
    const work = realish(resolve(ctx.workDir));
    const target = realish(resolve(work, f));
    const vault = realish(resolve(VAULT_DIR));
    if (within(target, work) && !within(target, vault)) return { cls: 'auto' };
    if (ctx.scope === 'voll' && !sensitiveTarget(target)) return { cls: 'auto' };
    return { cls: 'confirm' };
  }
  if (READ_TOOLS.has(tool)) return { cls: 'read' };
  if (tool.startsWith('mcp__')) {
    const [, server, name = ''] = tool.split('__');
    // Eigene Werkbank-Werkzeuge: vault-search nur lesend; "später" ändert nur Werkbank-Zustand.
    if (server === 'vault-search') return { cls: 'read' };
    if (server === 'werkbank' && (name === 'hygiene_list' || name === 'hygiene_snooze' || name === 'skills_list')) return { cls: 'read' };
    if (server === 'werkbank' && name === 'jira_update') return { cls: 'confirm' };
    // forge-review (Platzhalter): Review rechnen/lesen frei; nach GitHub posten ist wie alles GitHub-Schreiben
    // im Pilot gesperrt (Ergebnis bleibt Entwurf), mergen nie.
    if (server === 'forge-review') return /merge|post|publish|submit|comment|approve|request_changes/i.test(name) ? { cls: 'blocked', why: 'GitHub schreiben (forge-Ergebnis bleibt Entwurf)' } : { cls: 'read' };
    if (/github/i.test(server) && !MCP_READ.test(name)) return { cls: 'blocked', why: 'GitHub schreiben' };
    if (/merge/i.test(name)) return { cls: 'blocked', why: 'Merge' };
    // Anmelden beim MCP-Server (Claude Codes eigene Pseudo-Werkzeuge bei „needs-auth“): schreibt nur die
    // eigene OAuth-Anmeldung in die eigene Claude-Konfiguration — ohne Rückfrage.
    if (name === 'authenticate' || name === 'complete_authentication') return { cls: 'read' };
    if (MCP_READ.test(name)) return { cls: 'read' };
    // Voller Auto-Modus: Jira-Schreiben bleibt beim „ja“ (jira_update steht oben), der Rest geht an den Klassifikator.
    if (ctx.workDir && ctx.scope === 'voll' && server !== 'atlassian') return { cls: 'auto' };
    return { cls: 'confirm' };
  }
  // Write, Edit, MultiEdit, NotebookEdit und alles Unbekannte: nachfragen.
  return { cls: 'confirm' };
}

function short(s: unknown, n = 90): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function clip(s: unknown, n: number): string {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) + '\n… (gekürzt)' : t;
}

function where(p: unknown): string {
  const s = String(p ?? '');
  if (s === VAULT_DIR || s.startsWith(VAULT_DIR + '/')) return `Vault: ${s.slice(VAULT_DIR.length + 1) || '/'}`;
  return s;
}

function inVault(p: unknown): boolean {
  const s = String(p ?? '');
  return s === VAULT_DIR || s.startsWith(VAULT_DIR + '/');
}

/** Eine kurze deutsche Zeile, was das Werkzeug gerade tut. */
export function statusLine(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read': return `📄 Datei gelesen: ${where(input.file_path)}`;
    case 'Grep': return `🔎 Suche${inVault(input.path) ? ' im Vault' : ''}: „${short(input.pattern, 60)}“`;
    case 'Glob': return `🔎 Suche Dateien${inVault(input.path) ? ' im Vault' : ''}: ${short(input.pattern, 60)}`;
    case 'LS': return `📂 Ordner angesehen: ${where(input.path)}`;
    case 'WebSearch': return `🌐 Websuche: „${short(input.query, 70)}“`;
    case 'WebFetch': return `🌐 Seite geladen: ${short(input.url, 80)}`;
    case 'Skill': return `🧰 Skill: ${short(input.skill ?? input.command, 60)}`;
    case 'Task': case 'Agent': return `🤖 Teilagent: ${short(input.description, 70)}`;
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return '🗒️ Aufgabenliste aktualisiert';
    case 'Bash': return `💻 Befehl: ${short(input.description || input.command, 80)}`;
    case 'Write': return `📝 Datei geschrieben: ${where(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `📝 Datei geändert: ${where(input.file_path)}`;
    case 'NotebookEdit': return `📝 Notebook geändert: ${where(input.notebook_path)}`;
    case 'ToolSearch': return '🔧 Werkzeuge nachgeladen';
  }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    const key = input.issueIdOrKey ?? input.issueKey ?? input.jql ?? input.query ?? input.cql ?? '';
    if (server === 'vault-search') return `📚 Vault-Suche: ${name}${input.query || input.note || input.folder ? ` – ${short(input.query ?? input.note ?? input.folder, 70)}` : ''}`;
    if (server === 'werkbank') return name === 'jira_update' ? `🎫 Jira nachgezogen: ${input.key}` : name === 'hygiene_snooze' ? `⏰ Später nachfragen: ${input.key}` : '🧹 Task-Hygiene angesehen';
    const icon = server === 'atlassian' ? '🎫 Jira' : server === 'compartment' ? '🧠 Gedächtnis' : `🔌 ${server}`;
    return `${icon}: ${name}${key ? ` – ${short(key, 70)}` : ''}`;
  }
  return `🔧 ${tool}`;
}

/**
 * Sofort-Zeile, sobald Claude ANFÄNGT, einen Werkzeugaufruf mit langer Eingabe zu formulieren (Datei, Änderung,
 * Teilagent, schreibender MCP-Aufruf). Bis die Eingabe fertig ist, vergehen bei großen Dateien leicht 30 s und mehr,
 * in denen sonst nichts zu sehen ist (Knut, 07.10.2026: „tools appear as he is working, not after“).
 * Lesende Werkzeuge und Bash haben kurze Eingaben — deren Zeile kommt wie bisher mit dem fertigen Aufruf. null = keine.
 */
export function prepLine(tool: string): string | null {
  switch (tool) {
    case 'Write': return '✍️ schreibt eine Datei …';
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return '✍️ bereitet eine Änderung vor …';
    case 'Task': case 'Agent': return '✍️ bereitet einen Teilagenten vor …';
  }
  if (tool.startsWith('mcp__') && classify(tool, {}).cls === 'confirm') return `✍️ bereitet vor: ${statusLine(tool, {})} …`;
  return null;
}

/**
 * Ja/Nein-Knöpfe unter jeder Rückfrage (docs/plan-ja-nein-knoepfe.md; Knut, 07.10.2026: „gib mir einen Button zum
 * Klicken oder Tappen“). Der Werkbank-Patch für LibreChat (`librechat/patches/30-client-antwort-knoepfe.patch`) rendert
 * genau diese zwei Anker als Knöpfe, die „ja“ bzw. „nein“ als Chat-Nachricht senden; ohne Patch bleiben sie harmlose
 * Anker, und der Satz darunter sagt, was man tippen kann.
 */
export const ANSWER_BUTTONS = '[✅ Ja](#werkbank-antwort:ja) [✖️ Nein](#werkbank-antwort:nein)\n\n_oder **ja** / **nein** tippen_';

/** Kern des Knopf-Ankers; steht er im Text des Modells, bricht `neutralizeAnswerAnchors` ihn. */
export const ANSWER_MARK = 'werkbank-antwort';

/**
 * Fügt in jedes `werkbank-antwort` in `text` ein Nullbreite-Leerzeichen ein, auch wenn der Anfang schon im zuvor
 * gesendeten `tail` stand (gestreamte Deltas). Zurück kommt nur der neue Teil — gesendetes lässt sich nicht ändern,
 * aber der Rest des Ankers liegt immer im neuen Teil.
 */
export function neutralizeAnswerAnchors(tail: string, text: string): string {
  const combined = tail + text;
  const cuts: number[] = [];
  for (let i = combined.indexOf(ANSWER_MARK); i !== -1; i = combined.indexOf(ANSWER_MARK, i + 1)) {
    cuts.push(Math.max(i + 1, tail.length) - tail.length);
  }
  let out = text;
  for (const at of cuts.reverse()) out = out.slice(0, at) + '\u200b' + out.slice(at);
  return out;
}

/** Die Rückfrage vor einem Schreibzugriff, auf Deutsch. */
export function confirmQuestion(tool: string, input: Record<string, unknown>): string {
  let what: string;
  let detail = '';
  switch (tool) {
    case 'Write':
      what = `die Datei **${where(input.file_path)}** schreiben`;
      detail = fence(clip(input.content, 1500), langOf(input.file_path));
      break;
    case 'Edit': case 'MultiEdit':
      what = `die Datei **${where(input.file_path)}** ändern`;
      if (input.old_string !== undefined) detail = `Ersetzen:\n${fence(clip(input.old_string, 600), langOf(input.file_path))}\ndurch:\n${fence(clip(input.new_string, 1000), langOf(input.file_path))}`;
      break;
    case 'NotebookEdit':
      what = `das Notebook **${where(input.notebook_path)}** ändern`;
      break;
    case 'Bash':
      what = 'diesen Befehl ausführen';
      detail = (input.description ? `_${short(input.description, 200)}_\n` : '') + fence(String(input.command ?? ''), 'bash');
      break;
    default:
      if (tool === 'mcp__werkbank__jira_update') {
        const parts = [
          input.status ? `Status → **${short(input.status, 30)}**` : '',
          input.due !== undefined && input.due !== null ? `Fällig → **${input.due || 'ohne Datum'}**` : '',
          input.comment ? `Kommentar: „${short(input.comment, 300)}“` : '',
        ].filter(Boolean);
        return `${neutralizeAnswerAnchors('', `**Soll ich ${input.key} in Jira nachziehen?** (mit deinem Jira-Zugang)\n\n${parts.map((p) => '- ' + p).join('\n')}`)}\n\n${ANSWER_BUTTONS}`;
      }
      if (tool.startsWith('mcp__atlassian__')) {
        what = `in Jira **${tool.split('__')[2]}** ausführen`;
      } else if (tool.startsWith('mcp__')) {
        const [, server, name] = tool.split('__');
        what = `**${name}** (${server}) ausführen`;
      } else {
        what = `das Werkzeug **${tool}** ausführen`;
      }
      detail = fence(clip(JSON.stringify(input, null, 2), 1500), 'json');
  }
  // Was aus dem Werkzeugaufruf stammt (Befehl, Beschreibung, Jira-Text), schreibt das Modell: dort keine Knöpfe.
  return `${neutralizeAnswerAnchors('', `**Soll ich ${what}?**\n\n${detail}`)}\n\n${ANSWER_BUTTONS}`;
}

const LANGS: Record<string, string> = { md: 'markdown', ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', py: 'python', json: 'json', sh: 'bash', yaml: 'yaml', yml: 'yaml', sql: 'sql', html: 'html', css: 'css' };
function langOf(p: unknown): string {
  return LANGS[String(p ?? '').split('.').pop()?.toLowerCase() ?? ''] ?? 'text';
}

function fence(s: string, lang = 'text'): string {
  const ticks = s.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${s}\n${ticks}`;
}

/** "ja" / "nein" / sonstiger Text aus der Antwort des Nutzers. */
export function parseAnswer(text: string): 'yes' | 'no' | 'other' {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/, '');
  if (/^(ja|j|yes|y|ok|okay|passt|mach|mach das|go|jawohl|klar|ja bitte|bitte)$/.test(t)) return 'yes';
  if (/^(nein|n|no|nö|stopp|stop|abbrechen|lieber nicht|nicht)$/.test(t)) return 'no';
  return 'other';
}

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Hat ein erfolgreicher Atlassian-MCP-Aufruf Jira geändert? Dann die betroffenen Schlüssel (für das sofortige
 * Nachziehen der Jira-Kopie am Board), sonst null. Schlüssel aus den Argumenten (issueIdOrKey, parent, Links)
 * und — beim Anlegen — aus der Antwort.
 */
export function jiraWriteKeys(tool: string, input: Record<string, unknown>, result = ''): string[] | null {
  if (!tool.startsWith('mcp__atlassian__')) return null;
  const name = tool.split('__')[2] ?? '';
  if (!/jira|issuelink|worklog/i.test(name) || classify(tool, input).cls !== 'confirm') return null;
  const keys = new Set<string>();
  const take = (v: unknown) => {
    if (typeof v === 'string' && KEY_RE.test(v.trim())) keys.add(v.trim());
    else if (v && typeof v === 'object' && !Array.isArray(v)) { const k = (v as any).key ?? (v as any).issueKey; if (typeof k === 'string' && KEY_RE.test(k)) keys.add(k); }
  };
  for (const v of Object.values(input)) take(v);
  if (/^create/i.test(name)) for (const m of String(result).matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) { keys.add(m[0]); if (keys.size >= 5) break; }
  return [...keys];
}
