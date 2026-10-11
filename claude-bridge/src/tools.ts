// Werkzeug-Einordnung und lesbare Statuszeilen.
//
// Vier Klassen:
//   read    – läuft ohne Rückfrage (Lesen, Suchen, Skills, Teilagenten)
//   confirm – Schreiben/Ausführen: erst nach "ja" im Chat
//   blocked – im Pilot nie erlaubt (GitHub-Schreiben, Push, Merge)
//   auto    – nur im Auto-Modus (mit Arbeitsordner): Bash und Edits im eigenen Arbeitsordner entscheidet der
//             Klassifikator des SDK (Plan 71 P1, Knut 06.10.2026). Ohne Arbeitsordner gibt es diese Klasse nie.

import { realpathSync, statSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

export type ToolClass = 'read' | 'confirm' | 'blocked' | 'auto';

export const VAULT_DIR = process.env.BRIDGE_VAULT_DIR || '/vault';

const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch',
  'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Skill', 'Task', 'Agent',
  'ToolSearch', 'BashOutput', 'TaskOutput', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  // Teilagent gibt sein Ergebnis ab (Plan 132, B13: war „unbekannt → Rückfrage“ und in Strängen damit abgelehnt).
  'SubagentHandback',
]);

// Lesende MCP-Werkzeuge erkennt man am Namen (Atlassian: get*/search*/lookup*/fetch …).
const MCP_READ = /^(get|search|lookup|fetch|list|atlassianUserInfo|memory_(search|get|recent|status|relations|list_namespaces|selftest))/;

// Git mit beliebigen globalen Optionen vor dem Unterbefehl (`git -C "a b" -c k=v --no-pager push`), Plan 132 (C6/A2): ohne
// das liefen `git -C x push`/`git -C x merge` an den Mustern vorbei. Unterbefehl und Zweig enden mit (?![\w-]), damit
// `merge-base` oder `main-fix` nicht treffen. Die beiden Options-Formen überlappen nicht (blankes -c/-C nur mit Argument):
// sonst wächst das Backtracking exponentiell — 60× `-C` hielt den Brücken-Prozess über 2 min fest (Review 11.10.2026).
// Optionen mit getrenntem Wert (`--git-dir /r`) sind eine eigene Form; die allgemeine Form nimmt sie und blankes -c/-C nicht.
const GIT_VALUED = String.raw`(?:-[cC]|--(?:git-dir|work-tree|namespace|super-prefix|config-env))`;
const GIT = String.raw`\bgit(?:\s+(?:${GIT_VALUED}\s+(?:"[^"]*"|'[^']*'|\S+)|(?!${GIT_VALUED}(?:\s|$))-(?:-[\w-]+|\w[\w-]*)(?:=\S+)?))*\s+`;
const git = (sub: string, rest = '') => new RegExp(GIT + sub + String.raw`(?![\w-])` + rest);
const PROTECTED = String.raw`(?:refs\/heads\/)?(?:main|master|develop)(?![\w-])`;

// Bash-Befehle, die immer gesperrt sind, auch mit Bestätigung: Merge, Force-Push, Push auf die geschützten Zweige.
const BASH_BLOCKED: [RegExp, string][] = [
  [git('merge'), 'git merge'],
  [/\bgh\s+pr\s+merge\b/, 'GitHub-PR mergen'],
  [/\bgh\s+api\b[^|;&]*\/(merge|merges)\b/, 'Merge über die GitHub-API'],
  [/\/merge\b[^|;&]*github|github[^|;&]*\/merge\b/i, 'Merge über GitHub'],
  [git('push', String.raw`[^|;&]*(\s--force\b|\s--force-with-lease\b|\s-f\b|\s\+\S)`), 'Force-Push'],
  [git('push', String.raw`[^|;&]*[\s:'"]` + PROTECTED), 'Push auf main/master/develop'],
];

// GitHub schreiben (Knut, 06.10.2026: „push only with acceptance or orders“): immer erst nach „ja“ im Chat — auch im
// Auto-Modus nie dem Klassifikator überlassen. Lesen (gh api ohne Schreib-Optionen, gh pr view/diff/list) bleibt frei.
const BASH_GITHUB_WRITE: [RegExp, string][] = [
  [git('push'), 'git push'],
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
  guard?: PathGuard;  // S0: Ordnergrenzen je Person (alle Modi), siehe pathGuardProblem
  // Reichweite des Auto-Modus (BRIDGE_AUTO_SCOPE). „voll“ (Knut, 07.10.2026: „voll autonom wie hier“): auch Vault,
  // Repos, Gedächtnis und andere MCP-Werkzeuge entscheidet der Klassifikator. Rückfrage bleibt für Jira- und
  // GitHub-Schreiben und Geheimnisse; die Sperren bleiben. Ohne Angabe: nur der Arbeitsordner (Stand 06.10.2026).
  scope?: 'arbeitsordner' | 'voll';
  leit?: boolean;     // Leitstand-Chat (Plan 132): nur dort gibt es die orch_*-Werkzeuge
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

// ---------- S0: Ordnergrenzen für Agenten (Plan 126, Knut 11.10.2026) ----------
// Bisher galten Zugriffsregeln nur in der Web-Oberfläche: Read/Glob/Grep ohne Pfadprüfung, alles läuft als ein
// Linux-Nutzer. Jetzt: der Arbeitsordner einer ANDEREN Person, fremde Claude-Konfigurationen und der Dateispeicher der
// Werkbank brauchen ein „ja“. Personen mit eigener Konfiguration (strict, also alle außer dem Pilotkonto) lesen ohne
// Rückfrage nur den eigenen Arbeitsordner (scratch, Chat-Ordner) und den Vault. Ehrliche Grenze: Bash kann über Umwege
// (cd ..; cat *) trotzdem an andere Pfade — das schließt erst eine Betriebssystem-Sandbox (nicht vorhanden).
export interface PathGuard {
  scratchRoot: string;     // …/.runtime/bridge/scratch
  ownScratch: string;      // …/scratch/<person>
  homesRoot: string;       // …/.runtime/claude (Konfiguration je Person)
  ownHome: string | null;  // eigene Konfiguration (null = geteilte des VM-Nutzers)
  store: string;           // …/.runtime/werkbank (Dateien aller Personen)
  strict: boolean;         // nur eigene Ordner + Vault ohne Rückfrage
  allowed: string[];       // eigene Ordner (scratch, Arbeitsordner dieses Chats)
}

const GUARD_PATH_TOOLS: Record<string, string[]> = {
  Read: ['file_path'], NotebookRead: ['notebook_path'], Glob: ['path'], Grep: ['path'], LS: ['path'],
  Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'], NotebookEdit: ['notebook_path'],
};
export const OUTSIDE = 'liegt außerhalb deiner Ordner';

function pathProblem(target: string, g: PathGuard): string | null {
  const t = realish(target);
  const R = (p: string) => realish(resolve(p));
  if (within(t, R(g.scratchRoot)) && !within(t, R(g.ownScratch))) return `${OUTSIDE} (Arbeitsordner einer anderen Person)`;
  if (within(t, R(g.homesRoot)) && !(g.ownHome && within(t, R(g.ownHome)))) return `${OUTSIDE} (Claude-Konfiguration einer anderen Person)`;
  if (within(t, R(g.store))) return `${OUTSIDE} (Dateispeicher der Werkbank — Dateien aller Personen)`;
  if (g.strict && ![...g.allowed, g.ownScratch, VAULT_DIR, ...(g.ownHome ? [g.ownHome] : [])].some((a) => within(t, R(a)))) return OUTSIDE;
  return null;
}

/** S0-Grenze für Datei-Werkzeuge: Grund für eine Rückfrage oder null. Ohne Pfad (Glob/Grep im Arbeitsordner) frei. */
export function pathGuardProblem(tool: string, input: Record<string, unknown>, ctx: ClassifyContext): string | null {
  const g = ctx.guard;
  if (!g) return null;
  const keys = GUARD_PATH_TOOLS[tool];
  if (!keys) return null;
  const base = ctx.workDir ?? g.allowed[0] ?? g.ownScratch;
  for (const k of keys) {
    const v = input[k];
    if (typeof v !== 'string' || !v) continue;
    const p = pathProblem(resolve(base, v.replace(/^~(?=\/|$)/, process.env.HOME ?? '~')), g);
    if (p) return p;
  }
  return null;
}

/** S0 für Bash (nur Muster, keine Sandbox): fremde scratch-Ordner, Dateispeicher; strict zusätzlich absolute Pfade
 *  unter /home bzw. ~ außerhalb der eigenen Ordner. */
export function bashGuardProblem(cmd: string, g: PathGuard | undefined): string | null {
  if (!g) return null;
  for (const m of cmd.matchAll(/bridge\/scratch\/([\w.-]+)/g)) if (!g.ownScratch.endsWith('/' + m[1])) return `${OUTSIDE} (Arbeitsordner einer anderen Person)`;
  if (/bridge\/scratch\/(\*|\s|$|["'])/.test(cmd) || /bridge\/scratch\/?\s*$/.test(cmd)) return `${OUTSIDE} (Arbeitsordner aller Personen)`;
  if (/\.runtime\/werkbank\b/.test(cmd)) return `${OUTSIDE} (Dateispeicher der Werkbank)`;
  if (g.strict) {
    for (const m of cmd.matchAll(/(?:^|[\s'"=:(<>])((?:\/home\/|~\/|\$HOME\/)[^\s'";|&)<>]*|~(?=[\s'";|&]|$))/g)) {
      const raw = m[1].replace(/^(~|\$HOME)(?=\/|$)/, process.env.HOME ?? '/home');
      if (pathProblem(resolve(raw), g)) return OUTSIDE;
    }
  }
  return null;
}

export function classify(tool: string, input: Record<string, unknown>, ctx: ClassifyContext = {}): { cls: ToolClass; why?: string } {
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    for (const [re, why] of BASH_BLOCKED) if (re.test(cmd)) return { cls: 'blocked', why };
    for (const [re, why] of BASH_GITHUB_WRITE) if (re.test(cmd)) return { cls: 'confirm', why };
    const gb = bashGuardProblem(cmd, ctx.guard);
    if (gb) return { cls: 'confirm', why: gb };
    if (ctx.workDir && ctx.scope === 'voll') {
      if (BASH_KEEP_CONFIRM_VOLL.some((re) => re.test(cmd)) || bashTouchesJiraWrite(cmd)) return { cls: 'confirm' };
      return { cls: 'auto' };
    }
    if (ctx.workDir && !cmd.includes(VAULT_DIR) && !BASH_KEEP_CONFIRM.some((re) => re.test(cmd))) return { cls: 'auto' };
    return { cls: 'confirm' };
  }
  const gp = pathGuardProblem(tool, input, ctx);
  if (gp) return { cls: 'confirm', why: gp };
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
    // review_ready ändert nur Werkbank-Zustand (Fertig-Marke am eigenen Lauf) → ohne Rückfrage.
    if (server === 'werkbank' && (name === 'hygiene_list' || name === 'hygiene_snooze' || name === 'skills_list' || name === 'review_ready')) return { cls: 'read' };
    // Jira schreiben (einzeln/gesammelt) und einen neuen Chat mit Agent starten: immer erst nach „ja“.
    if (server === 'werkbank' && (name === 'jira_update' || name === 'jira_update_many' || name === 'agent_start')) return { cls: 'confirm' };
    // Orchestrator-Werkzeuge (Plan 132, S3): nur im Leitstand. Lesen und Rückfragen an Knut frei; Stränge starten, Nachrichten
    // schicken und prüfen entscheidet der Klassifikator; ein Strang außerhalb des Leitstand-Ordners braucht ein „ja“.
    if (server === 'werkbank' && name.startsWith('orch_')) {
      if (!ctx.leit) return { cls: 'blocked', why: 'Orchestrator-Werkzeuge gibt es nur im Leitstand' };
      if (/^orch_(list|show|questions|ask)$/.test(name)) return { cls: 'read' };
      if (name === 'orch_start' && ctx.workDir) {
        const cwd = realish(resolve(ctx.workDir, String(input.cwd ?? '')));
        if (!within(cwd, realish(resolve(ctx.workDir)))) return { cls: 'confirm', why: 'Strang außerhalb des Leitstand-Ordners' };
      }
      return ctx.workDir && ctx.scope === 'voll' ? { cls: 'auto' } : { cls: 'confirm' };
    }
    // PostHog (Plan 132, C5/A3; Namen in kebab-case): Löschen gesperrt, Lesen frei, alles andere — auch der Sammelaufruf
    // `exec` — erst nach „ja“, nie dem Klassifikator überlassen (Feature-Flags wirken auf Produktion).
    if (server === 'posthog') {
      if (/(^|-)(delete|destroy|remove)(-|$)/.test(name)) return { cls: 'blocked', why: 'PostHog löschen' };
      // „or“ in der Negativliste: `…-get-or-create` schreibt.
      if (name === 'execute-sql' || (/(^|-)(get|list|retrieve|read|search)(-|$)/.test(name) && !/(^|-)(create|update|delete|set|add|remove|duplicate|rename|or)(-|$)/.test(name))) return { cls: 'read' };
      return { cls: 'confirm' };
    }
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

// ---------- Orchestrator-Stränge (docs/plan-orchestrator-agents.md, Knut 09.10.2026) ----------
// Ein Strang ist ein Chat, den die Haupt-Sitzung über den internen Kanal gestartet hat. Dort gilt zusätzlich, vor allen
// Klassen und auch nach einem „ja“: kein GitHub-Schreiben, kein Jira-Schreiben, keine Änderung an Git-Konfiguration,
// Hooks, Claude-Einstellungen oder .env. Muster sind keine Sandbox (siehe Plan, Council NOTES); die zweite Schicht ist
// die Git-Umgebung ohne Zugangsdaten (sessions.ts, orchGitEnv).
const ORCH_BASH_BLOCK: [RegExp, string][] = [
  [git('(?:push|send-pack)'), 'git push'],
  [/\balias\.[\w-]+/, 'Git-Alias (könnte pushen)'],
  [/\bgit-(send-pack|receive-pack)\b/, 'git push'],
  [/\bcore\.hooksPath\b|\.git\/(hooks|config)\b/, 'Git-Hooks/-Konfiguration'],
  [/\bgh\s+(pr|issue|release|repo|label|secret|variable|workflow|gist|api)\b(?!\s+(view|list|diff|status|checks)\b)/, 'GitHub-CLI (nur lesen erlaubt: view/list/diff/status/checks)'],
  [/api\.github\.com|github\.com\/[^\s]*\.git\b/, 'GitHub direkt ansprechen'],
  [/(atlassian\.net|api\.atlassian\.com)/i, 'Atlassian/Jira direkt ansprechen'],
  // Plan 132 (B7/C8): Wege zum internen Schlüssel der Werkbank — sonst könnte ein Strang Stränge starten oder den Leitstand
  // ersetzen. Muster zielen auf Zugriffe (Pfade, Header), nicht auf Wörter: `grep environ datei` bleibt frei.
  // Nur Adressen der lokalen Dienste (Review B/C: `./internal/…` in Go-Repos ist ein normaler Pfad).
  [/\bscripts\/orch\b|\borch-cli\b|(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?\/(werkbank\/)?internal\/|x-werkbank-internal|WERKBANK_INTERNAL_TOKEN/i, 'interner Kanal der Werkbank'],
  // `ps` nur als Befehl (nicht `docker ps web`); BSD-Form mit e = Umgebung anzeigen.
  [/\/proc\/[^\s'"]*\/environ\b|(^|[\s/'"])\.env\.local\b|(^|[;&|(]\s*|\bsudo\s+)ps\s+(-\S+\s+)*[a-zA-Z]*e[a-zA-Z]*(\s|$)/, 'Umgebung/Geheimnisse anderer Prozesse lesen'],
];
const ORCH_FILE_BLOCK = /(^|\/)(\.git|\.claude)(\/|$)|(^|\/)\.env[^/]*$/;
// Lesen, das in einem Strang gesperrt ist (Plan 132, C8): Umgebung anderer Prozesse, .env-Dateien (außer Beispielen).
const ORCH_READ_BLOCK = /^\/proc\/.*\/environ$|(^|\/)\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/;
const READ_PATH_TOOLS: Record<string, string> = { Read: 'file_path', Grep: 'path', Glob: 'path', NotebookRead: 'notebook_path', LS: 'path' };

/** Grund, warum ein Aufruf in einem Orchestrator-Strang gesperrt ist — oder null. */
export function orchestratorBlock(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    for (const [re, why] of [...BASH_BLOCKED, ...BASH_GITHUB_WRITE, ...ORCH_BASH_BLOCK]) if (re.test(cmd)) return why;
    // git config: nur lesen (--get…/--list/-l); jede schreibende Form ist gesperrt.
    for (const m of cmd.matchAll(new RegExp(GIT + String.raw`config(?![\w-])([^|;&\n]*)`, 'g'))) if (!/\s(--get(-all|-regexp)?|--list|-l)\b/.test(m[1])) return 'Git-Konfiguration ändern';
    return null;
  }
  if (FILE_TOOLS.has(tool)) {
    const f = String(input.file_path ?? input.notebook_path ?? '');
    return ORCH_FILE_BLOCK.test(f) ? 'Git-/Claude-Konfiguration oder .env ändern' : null;
  }
  if (READ_PATH_TOOLS[tool] && ORCH_READ_BLOCK.test(String(input[READ_PATH_TOOLS[tool]] ?? ''))) return 'Umgebung/Geheimnisse lesen';
  if (tool.startsWith('mcp__')) {
    const [, server, name = ''] = tool.split('__');
    if (server === 'werkbank' && /^(jira_|orch_)/.test(name)) return name.startsWith('orch_') ? 'Orchestrator-Werkzeuge' : 'Jira schreiben';
    if (server === 'atlassian' && !MCP_READ.test(name) && name !== 'authenticate' && name !== 'complete_authentication') return 'Jira/Confluence schreiben';
    if (/github/i.test(server) && !MCP_READ.test(name)) return 'GitHub schreiben';
    if (server === 'forge-review' && /merge|post|publish|submit|comment|approve|request_changes/i.test(name)) return 'GitHub schreiben';
  }
  return null;
}

// ---------- Leitstand (docs/plan-leitstand.md, S4) ----------
// Knuts Orchestrator-Chat: Auto-Modus „voll“, aber vor allen Klassen (und vor der Arbeitsordner-Regel): Vault-git gesperrt;
// Live-Instanz, crontab, ~/bin, Git-Hooks/-Konfiguration, .claude/ und .env sowie Dateien außerhalb von Arbeitsordner, eigenem
// Scratch und Vault brauchen ein „ja“. Muster sind keine Sandbox (Bash-Restrisiko S0, im Plan bewertet).
const VAULT_GIT = (vault: string) => {
  const v = vault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`\bgit\s+(?:\S+\s+)*?(?:-C\s+["']?${v}(?:["'/\s]|$)|--git-dir=?\s*["']?${v}|--work-tree=?\s*["']?${v})|GIT_(?:DIR|WORK_TREE)=["']?${v}|\b(?:cd|pushd)\s+["']?${v}(?:["'/\s;&]|$)[^|]*?\bgit\b|${v}\/\.git\b`);
};
const LEIT_BASH_CONFIRM: [RegExp, string][] = [
  [/werkbank-dev\b|\bwerkbank\.sh\b/, 'Live-Instanz der Werkbank'],
  [/\bcrontab\b/, 'crontab'],
  [/(~|\$HOME|\/home\/[^/\s]+)\/bin\b/, '~/bin'],
  [/\bsystemctl\b/, 'systemctl'],
  [/(^|[\s/'"])\.claude(\/|\b)|(^|[\s/'"])\.env\b|\.git\/(hooks|config)\b|\bcore\.hooksPath\b/, 'Claude-/Git-Konfiguration oder .env'],
];

/** Leitstand: gesperrt / Rückfrage (mit Grund) / null = normale Einordnung. Läuft vor classify (Plan 132, C7/D4). */
export function leitstandCheck(tool: string, input: Record<string, unknown>, ctx: { workDir?: string; scratch?: string }): { cls: 'blocked' | 'confirm'; why: string } | null {
  const vault = realish(resolve(VAULT_DIR));
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    if (VAULT_GIT(VAULT_DIR).test(cmd) || (vault !== VAULT_DIR && VAULT_GIT(vault).test(cmd))) return { cls: 'blocked', why: 'git im Vault' };
    for (const [re, why] of LEIT_BASH_CONFIRM) if (re.test(cmd)) return { cls: 'confirm', why };
    return null;
  }
  if (FILE_TOOLS.has(tool)) {
    const f = String(input.file_path ?? input.notebook_path ?? '');
    const target = realish(resolve(ctx.workDir ?? '/', f));
    if (within(target, vault)) return /(^|\/)\.git(\/|$)/.test(target.slice(vault.length)) ? { cls: 'blocked', why: 'git im Vault' } : null;
    if (ORCH_FILE_BLOCK.test(target)) return { cls: 'confirm', why: 'Git-/Claude-Konfiguration oder .env' };
    const own = [ctx.workDir, ctx.scratch].filter(Boolean).map((d) => realish(resolve(d!)));
    if (!own.some((d) => within(target, d))) return { cls: 'confirm', why: 'außerhalb von Leitstand-Ordner, Scratch und Vault' };
  }
  return null;
}

/** Erlaubte Wurzeln für Arbeitsordner von Strängen (WERKBANK_ORCH_ROOTS, Komma-getrennt; Vorgabe $HOME/work). */
export const orchRoots = () => (process.env.WERKBANK_ORCH_ROOTS || `${process.env.HOME ?? '/nonexistent'}/work`).split(',').map((x) => x.trim()).filter(Boolean);

/** Prüft einen Arbeitsordner für einen Strang (echter Pfad). Fehlertext oder null; bei Erfolg der echte Pfad in `real`. */
export function orchDirProblem(dir: string): { problem: string | null; real?: string } {
  if (!dir || !dir.startsWith('/')) return { problem: 'Arbeitsordner muss ein absoluter Pfad sein.' };
  let real: string;
  try { real = realpathSync(dir); } catch { return { problem: 'Arbeitsordner gibt es nicht.' }; }
  try { if (!statSync(real).isDirectory()) return { problem: 'Arbeitsordner ist kein Verzeichnis.' }; } catch { return { problem: 'Arbeitsordner nicht lesbar.' }; }
  const roots = orchRoots().map((r) => { try { return realpathSync(r); } catch { return resolve(r); } });
  if (!roots.some((r) => real !== r && within(real, r))) return { problem: `Arbeitsordner muss unterhalb von ${orchRoots().join(', ')} liegen (nicht die Wurzel selbst).` };
  let vault = resolve(VAULT_DIR); try { vault = realpathSync(VAULT_DIR); } catch { /* kein Vault */ }
  if (within(real, vault)) return { problem: 'Der Vault ist kein Arbeitsordner für Stränge.' };
  if (/(^|\/)(\.runtime[^/]*|\.git|\.claude|\.ssh)(\/|$)/.test(real)) return { problem: 'Arbeitsordner darf nicht in .runtime, .git, .claude oder .ssh liegen.' };
  return { problem: null, real };
}

function short(s: unknown, n = 90): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Was an einem Ticket geändert wird (Status, Fälligkeit, Kommentar) — für die Rückfrage. */
// Was geschrieben wird, steht hier vollständig (Kommentar bis 1500 Zeichen, mehr lehnt die Werkbank ab); Done und
// „Datum entfernen“ sind markiert, weil sie in einer langen Liste leicht durchrutschen (Council 09.10.2026).
function jiraChangeParts(c: Record<string, unknown>): string[] {
  const st = String(c.status ?? '');
  return [
    st ? `${/^(done|erledigt|closed|geschlossen)$/i.test(st.trim()) ? '⚠️ ' : ''}Status → **${short(st, 60)}**` : '',
    c.due !== undefined && c.due !== null ? (c.due ? `Fällig → **${short(c.due, 20)}**` : '⚠️ Fällig → **ohne Datum** (Datum entfernen)') : '',
    c.comment ? `Kommentar: „${short(c.comment, 1500)}“` : '',
  ].filter(Boolean);
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
    if (server === 'werkbank') {
      if (name === 'jira_update') return `🎫 Jira nachgezogen: ${input.key}`;
      if (name === 'jira_update_many') return `🎫 Jira nachgezogen: ${Array.isArray(input.changes) ? input.changes.length : 0} Tickets`;
      if (name === 'agent_start') return `🤖 Agent-Chat gestartet: ${input.key}`;
      if (name === 'review_ready') return '📬 Bereit zum Review gemeldet';
      return name === 'hygiene_snooze' ? `⏰ Später nachfragen: ${input.key}` : '🧹 Task-Hygiene angesehen';
    }
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
        const head = `**${input.key}**${input.summary ? ` „${short(input.summary, 80)}“` : ''}`;
        const parts = [...jiraChangeParts(input), input.reason ? `Grund: ${short(input.reason, 200)}` : ''].filter(Boolean);
        return `${neutralizeAnswerAnchors('', `**Soll ich ${head} in Jira nachziehen?** (mit deinem Jira-Zugang)\n\n${input.was ? `Bisher (laut Chat): ${short(input.was, 120)}\n\n` : ''}${parts.map((p) => '- ' + p).join('\n')}`)}\n\n${ANSWER_BUTTONS}`;
      }
      if (tool === 'mcp__werkbank__jira_update_many') {
        const cs = (Array.isArray(input.changes) ? input.changes : []) as Record<string, unknown>[];
        const rows = cs.map((c) => `- **${short(c.key, 20)}**${c.summary ? ` „${short(c.summary, 60)}“` : ''}${c.was ? ` (bisher laut Chat: ${short(c.was, 60)})` : ''}: ${jiraChangeParts(c).join(' · ') || '—'}${c.reason ? ` — ${short(c.reason, 120)}` : ''}`);
        return `${neutralizeAnswerAnchors('', `**Soll ich diese ${cs.length} Tickets in Jira nachziehen?** (mit deinem Jira-Zugang, der Reihe nach)\n\n${rows.join('\n')}`)}\n\n${ANSWER_BUTTONS}`;
      }
      if (tool === 'mcp__werkbank__agent_start') {
        return `${neutralizeAnswerAnchors('', `**Soll ich für ${input.key} einen neuen Chat mit einem Agenten starten?** Er arbeitet das Ticket vor und fragt vor jedem Schreiben nach.${input.note ? `\n\nAuftrag: „${short(input.note, 300)}“` : ''}`)}\n\n${ANSWER_BUTTONS}`;
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

/** Die Rückfrage als ein Satz (ohne Markdown) für die Review-Karte der Werkbank: „Soll ich … ?“, bei Bash mit Befehl. */
export function questionText(tool: string, input: Record<string, unknown>): string {
  const m = confirmQuestion(tool, input).match(/\*\*(Soll ich [\s\S]*?\?)\*\*/);
  const q = (m?.[1] ?? statusLine(tool, input)).replace(/\*\*/g, '').replace(/​/g, '');
  return tool === 'Bash' ? `${q} ${short(input.command, 200)}` : q;
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
export function parseAnswer(text: string, strict = false): 'yes' | 'no' | 'other' {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/, '');
  // Leitstand (Plan 132, B5): nur das ausdrückliche Wort bzw. der Knopf — ein beiläufiges „ok“ am Handy gibt nichts frei.
  if (strict) return t === 'ja' || t === 'yes' ? 'yes' : t === 'nein' || t === 'no' ? 'no' : 'other';
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
