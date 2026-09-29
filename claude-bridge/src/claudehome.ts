// Womit eine Werkbank-Sitzung startet: welche Claude-Konfiguration (CLAUDE_CONFIG_DIR) und welche MCP-Server.
//
// Knut, 29.09.:
//  - „Schneller“: nicht mehr alle MCP-Server und Plugins der Nutzer-Konfiguration laden, sondern eine feste, kleine
//    Auswahl (vault-search, werkbank, forge-review falls eingerichtet, Atlassian für Jira) mit strictMcpConfig.
//  - „Team-fähig“: je Person ein eigenes Claude-Konfigurationsverzeichnis unter .runtime/claude/<id>/ — eigene
//    MCP-Anmeldungen (Atlassian-OAuth), keine fremden Hooks, kein fremdes Gedächtnis. Skills werden hineinverlinkt
//    (dasselbe wie `werkbank.sh skills --apply` mit CLAUDE_CONFIG_DIR), CLAUDE.md aus templates/claude/.
//  - Knuts Pilot-Konto darf seine echte Konfiguration behalten: BRIDGE_CLAUDE_CONFIG_SHARED (E-Mails) — ohne
//    Eintrag gilt für alle „je Person“.
//
// Die Atlassian-OAuth-Anmeldung liegt in <Konfig>/.credentials.json unter dem Schlüssel
// "atlassian|<sha256({type,url,headers})[:16]>". Weil die Werkbank den Server mit genau Name, Typ und URL der
// üblichen Nutzer-Registrierung übergibt, findet Claude Code eine vorhandene Anmeldung ohne eigene Registrierung.

import { mkdirSync, existsSync, symlinkSync, lstatSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { log } from './log.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..');

export const ATLASSIAN_URL = process.env.BRIDGE_ATLASSIAN_MCP_URL ?? 'https://mcp.atlassian.com/v1/mcp';

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export interface ClaudeHome {
  mode: 'person' | 'shared';
  dir: string | null;        // CLAUDE_CONFIG_DIR (null = Konfiguration des VM-Nutzers, ~/.claude)
}

export function homesRoot(): string {
  return process.env.BRIDGE_CLAUDE_HOMES || join(process.env.BRIDGE_STATE_DIR || join(REPO, '.runtime', 'bridge'), '..', 'claude');
}

/** Welche Konfiguration gilt für diese Person? Vorgabe: je Person. */
export function homeFor(safeUserId: string, email?: string): ClaudeHome {
  const shared = list(process.env.BRIDGE_CLAUDE_CONFIG_SHARED);
  if (process.env.BRIDGE_CLAUDE_CONFIG === 'shared' || (email && shared.includes(email.toLowerCase()))) return { mode: 'shared', dir: null };
  return { mode: 'person', dir: join(homesRoot(), safeUserId) };
}

const prepared = new Map<string, number>();

/**
 * Legt das Verzeichnis an (0700), verlinkt CLAUDE.md und die Vault-Skills. Nichts wird überschrieben.
 * Skills höchstens alle 10 Minuten je Verzeichnis abgleichen (neue Vault-Skills kommen so von selbst dazu).
 */
export async function ensureHome(h: ClaudeHome): Promise<void> {
  if (!h.dir) return;
  const last = prepared.get(h.dir) ?? 0;
  if (Date.now() - last < 600_000) return;
  prepared.set(h.dir, Date.now());
  mkdirSync(h.dir, { recursive: true, mode: 0o700 });
  try { chmodSync(h.dir, 0o700); } catch { /* egal */ }
  const md = join(h.dir, 'CLAUDE.md');
  const tpl = process.env.BRIDGE_CLAUDE_MD_TEMPLATE || join(REPO, 'templates', 'claude', 'CLAUDE.md');
  if (!exists(md) && existsSync(tpl)) { try { symlinkSync(tpl, md); } catch { /* gleichzeitig angelegt */ } }
  try {
    // Genau das, was `scripts/werkbank.sh skills --apply` mit CLAUDE_CONFIG_DIR tut.
    await promisify(execFile)(process.execPath, [join(REPO, 'web', 'server', 'skills-cli.ts'), '--apply', '--json'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CLAUDE_CONFIG_DIR: h.dir, WERKBANK_SKILLS_TARGET: join(h.dir, 'skills'), ...(process.env.WERKBANK_SKILLS_SOURCE ? { WERKBANK_SKILLS_SOURCE: process.env.WERKBANK_SKILLS_SOURCE } : {}) },
      timeout: 20_000, maxBuffer: 4 << 20,
    });
  } catch (e: any) { log('skills für konfig fehlgeschlagen', { dir: h.dir, error: String(e?.stderr ?? e?.message ?? e).slice(0, 200) }); }
}

function exists(p: string) { try { lstatSync(p); return true; } catch { return false; } }

/** Umgebung + SDK-Optionen, die die Konfiguration festlegen (an env/options der Sitzung anhängen). */
export function applyHome(h: ClaudeHome, env: Record<string, string | undefined>, options: Record<string, any>): void {
  if (h.dir) env.CLAUDE_CONFIG_DIR = h.dir;
  else delete env.CLAUDE_CONFIG_DIR;
  // Nur die MCP-Server der Werkbank (options.mcpServers), nichts aus Nutzer-/Projekt-Konfiguration oder Plugins.
  options.strictMcpConfig = true;
  // Knuts eigene Hooks (SessionStart: Gedächtnis aus TDAI mit Vaultwarden, ~4,5 s; Stop: Verlauf nach TDAI) laufen
  // in Werkbank-Sitzungen nicht — die Brücke hat eigene Wächter (die SDK-Hooks der Brücke bleiben aktiv).
  // BRIDGE_SHARED_USER_HOOKS=on schaltet sie für die geteilte Konfiguration wieder ein.
  if (!h.dir && process.env.BRIDGE_SHARED_USER_HOOKS !== 'on') options.settings = { ...(options.settings ?? {}), disableAllHooks: true };
}

/** Atlassian-MCP (HTTP, OAuth je Konfiguration) für Jira — gleicher Name/URL wie `claude mcp add … atlassian`. */
export function atlassianServer(): Record<string, unknown> {
  return ATLASSIAN_URL && ATLASSIAN_URL !== 'off' ? { atlassian: { type: 'http', url: ATLASSIAN_URL } } : {};
}
