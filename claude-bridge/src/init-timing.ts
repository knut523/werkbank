// scripts/werkbank.sh init-timing — wie lange braucht der Start einer Claude-Code-Sitzung bis zur Init-Nachricht?
//
// Echte CLI aus dem Agent SDK, aber OHNE Modellaufruf: der Claude-Token ist absichtlich ungültig, gemessen wird nur bis
// „system/init“ (CLI-Start, Einstellungen, Plugins, Hooks, MCP-Verbindungen), danach wird abgebrochen.
// Drei Varianten, je N Läufe (Median):
//   vorher     — wie bis Runde 3: Nutzer-Konfiguration komplett (alle MCP-Server, Plugins, Hooks)
//   geteilt    — Pilot-Konto mit echter Konfiguration: nur Werkbank-MCP (strict), Knuts Hooks aus
//   je Person  — eigenes CLAUDE_CONFIG_DIR (frisch, mit Vault-Skills und CLAUDE.md), nur Werkbank-MCP
// Der Atlassian-MCP ist in allen Varianten dabei (in „je Person“ ohne Anmeldung → needs-auth, verbindet also nicht).

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHome, atlassianServer, ensureHome, type ClaudeHome } from './claudehome.ts';

const { query } = await import('@anthropic-ai/claude-agent-sdk');
const N = Number(process.argv[2] || 3);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '.runtime', 'e2e', 'init-timing.json');

function baseEnv() {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (/KEY|SECRET|TOKEN|PASSWORD|CREDS|_IV$|MONGO_URI/i.test(k)) delete env[k];
  for (const k of ['ANTHROPIC_BASE_URL', 'BW_SESSION', 'CLAUDE_CONFIG_DIR']) delete env[k];
  env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-PLACEHOLDER';
  env.ENABLE_TOOL_SEARCH = 'true';
  return env;
}

async function once(variant: string, cwd: string, home: ClaudeHome | null) {
  const env = baseEnv();
  const abort = new AbortController();
  const options: Record<string, any> = { cwd, settingSources: ['user', 'project'], env, maxTurns: 1, permissionMode: 'default', abortController: abort, canUseTool: async () => ({ behavior: 'deny', message: 'Messung' }) };
  if (home) { options.mcpServers = atlassianServer(); applyHome(home, env, options); }
  const t0 = Date.now();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try {
    for await (const m of query({ prompt: 'Messung', options }) as any) {
      if (m.type === 'system' && m.subtype === 'init') {
        return { variant, initMs: Date.now() - t0, mcp: (m.mcp_servers ?? []).map((s: any) => `${s.name}:${s.status}`), plugins: (m.plugins ?? []).length, skills: (m.skills ?? []).length };
      }
    }
  } catch { /* abgebrochen */ } finally { clearTimeout(timer); abort.abort(); }
  return { variant, initMs: -1, mcp: [], plugins: 0, skills: 0 };
}

const cwd = mkdtempSync(join(tmpdir(), 'wb-init-'));
const personDir = join(cwd, 'claude-person');
const person: ClaudeHome = { mode: 'person', dir: personDir };
await ensureHome(person);
const runs: any[] = [];
for (let i = 0; i < N; i++) {
  runs.push(await once('vorher', cwd, null));
  runs.push(await once('geteilt', cwd, { mode: 'shared', dir: null }));
  runs.push(await once('je Person', cwd, person));
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = ['vorher', 'geteilt', 'je Person'].map((v) => {
  const rs = runs.filter((r) => r.variant === v && r.initMs >= 0);
  return { variant: v, medianInitMs: rs.length ? median(rs.map((r) => r.initMs)) : null, runs: rs.map((r) => r.initMs), mcp: rs[0]?.mcp ?? [], plugins: rs[0]?.plugins ?? 0, skills: rs[0]?.skills ?? 0 };
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), n: N, summary }, null, 1));
for (const s of summary) console.log(`${s.variant.padEnd(10)} init Median ${String(s.medianInitMs).padStart(5)} ms  (${s.runs.join(', ')})  MCP: ${s.mcp.join(' ') || '—'}  Plugins ${s.plugins}  Skills ${s.skills}`);
rmSync(cwd, { recursive: true, force: true });
