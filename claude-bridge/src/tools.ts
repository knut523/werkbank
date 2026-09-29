// Werkzeug-Einordnung und lesbare Statuszeilen.
//
// Drei Klassen:
//   read    – läuft ohne Rückfrage (Lesen, Suchen, Skills, Teilagenten)
//   confirm – Schreiben/Ausführen: erst nach "ja" im Chat
//   blocked – im Pilot nie erlaubt (GitHub-Schreiben, Push, Merge)

export type ToolClass = 'read' | 'confirm' | 'blocked';

export const VAULT_DIR = process.env.BRIDGE_VAULT_DIR || '/vault';

const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch',
  'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Skill', 'Task', 'Agent',
  'ToolSearch', 'BashOutput', 'TaskOutput', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

// Lesende MCP-Werkzeuge erkennt man am Namen (Atlassian: get*/search*/lookup*/fetch …).
const MCP_READ = /^(get|search|lookup|fetch|list|atlassianUserInfo|memory_(search|get|recent|status|relations|list_namespaces|selftest))/;

// Bash-Befehle, die im Pilot gesperrt sind, auch mit Bestätigung.
const BASH_BLOCKED: [RegExp, string][] = [
  [/\bgit\s+push\b/, 'git push'],
  [/\bgit\s+merge\b/, 'git merge'],
  [/\bgh\s+pr\s+(merge|create|comment|review|edit|close|reopen|ready)\b/, 'GitHub-PR schreiben'],
  [/\bgh\s+(issue|release|repo|label|secret|variable|workflow)\s+(create|edit|close|delete|comment|reopen|set|run|enable|disable|fork|rename|archive)\b/, 'GitHub schreiben'],
  [/\bgh\s+api\b[^|;&]*(-X|--method)\s*(POST|PATCH|PUT|DELETE)/i, 'GitHub-API schreiben'],
  [/\bgh\s+api\b[^|;&]*\s(-f|-F|--field|--raw-field|--input)\s/, 'GitHub-API schreiben'],
  [/api\.github\.com[^|;&]*(-X|--request)\s*(POST|PATCH|PUT|DELETE)/i, 'GitHub-API schreiben'],
  [/(-X|--request)\s*(POST|PATCH|PUT|DELETE)[^|;&]*api\.github\.com/i, 'GitHub-API schreiben'],
  [/\/merge\b[^|;&]*github|github[^|;&]*\/merge\b/i, 'Merge über GitHub'],
];

export function classify(tool: string, input: Record<string, unknown>): { cls: ToolClass; why?: string } {
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    for (const [re, why] of BASH_BLOCKED) if (re.test(cmd)) return { cls: 'blocked', why };
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
        return `**Soll ich ${input.key} in Jira nachziehen?** (mit deinem Jira-Zugang)\n\n${parts.map((p) => '- ' + p).join('\n')}\n\nAntworte mit **ja** oder **nein**.`;
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
  return `**Soll ich ${what}?**\n\n${detail}\n\nAntworte mit **ja** oder **nein**.`;
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
