// Zugangsdaten je Person — nie im Repo, nie im Log.
// Claude: der Token aus `claude setup-token` liegt im LibreChat-Schlüsselspeicher (Endpunkt
//   "Claude Code", verschlüsselt mit CREDS_KEY). Die Werkbank schreibt ihn dort hinein (Einrichtung)
//   und liest ihn für "Agent ansetzen". So gibt es genau eine Stelle.
// Jira: E-Mail + Atlassian-API-Token je Person, AES-GCM-verschlüsselt in werkbank.creds.
//   Pilot: für das Pilotkonto darf der Token aus dem Vaultwarden der VM kommen (Eintrag
//   "Jira api", wie maxenergy-jira/scripts/jira-read.sh) — nur lesend.

import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';
import { seal, unseal, librechatEncrypt, librechatDecrypt } from './crypto.ts';
import type { User } from './auth.ts';

export const CLAUDE_ENDPOINT = 'Claude Code';

// ---------- Claude ----------

export function checkClaudeToken(t: string): string | null {
  if (!t) return 'Bitte den Token einfügen.';
  if (/^sk-ant-api/.test(t)) return 'Das ist ein API-Schlüssel. Die Werkbank arbeitet ohne API-Schlüssel — bitte den Token aus `claude setup-token` (beginnt mit sk-ant-oat).';
  if (!/^sk-ant-oat[0-9A-Za-z_-]{20,}$/.test(t)) return 'Das sieht nicht wie ein Token aus `claude setup-token` aus (beginnt mit sk-ant-oat…).';
  return null;
}

export async function claudeStatus(u: User) {
  const k: any = await lc().collection('keys').findOne({ userId: new ObjectId(u.id), name: CLAUDE_ENDPOINT });
  if (!k) return { connected: false as const };
  return { connected: true as const, expiresAt: k.expiresAt ?? null };
}

export async function setClaudeToken(u: User, token: string) {
  const err = checkClaudeToken(token);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  await lc().collection('keys').updateOne(
    { userId: new ObjectId(u.id), name: CLAUDE_ENDPOINT },
    { $set: { userId: new ObjectId(u.id), name: CLAUDE_ENDPOINT, value: librechatEncrypt(JSON.stringify({ apiKey: token })) }, $unset: { expiresAt: '' } },
    { upsert: true },
  );
}

export async function removeClaudeToken(u: User) {
  await lc().collection('keys').deleteOne({ userId: new ObjectId(u.id), name: CLAUDE_ENDPOINT });
}

export async function getClaudeToken(u: User): Promise<string | null> {
  const k: any = await lc().collection('keys').findOne({ userId: new ObjectId(u.id), name: CLAUDE_ENDPOINT });
  if (!k) return null;
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return null;
  try { return JSON.parse(librechatDecrypt(k.value)).apiKey ?? null; } catch { return null; }
}

// ---------- Jira ----------

export interface JiraCreds { email: string; token: string; source: 'eigener Token' | 'Pilot (Vaultwarden der VM)' | 'Demo' }

export async function setJiraCreds(u: User, email: string, token: string, canWrite: boolean | null) {
  await wb().collection('creds').updateOne(
    { userId: u.id },
    { $set: { userId: u.id, jira: { email: email.trim().toLowerCase(), token: seal(token.trim()), canWrite, savedAt: new Date() } } },
    { upsert: true },
  );
}

export async function removeJiraCreds(u: User) {
  await wb().collection('creds').updateOne({ userId: u.id }, { $unset: { jira: '' } });
}

export async function markJiraWrite(u: User, canWrite: boolean) {
  await wb().collection('creds').updateOne({ userId: u.id, jira: { $exists: true } }, { $set: { 'jira.canWrite': canWrite } });
}

let pilotCache: { token: string; at: number } | null = null;

/** Pilot: Token aus dem Vaultwarden der VM (wie jira-daily-vault.sh), nur im Speicher, 10 Min. */
export function pilotToken(): Promise<string | null> {
  if (pilotCache && Date.now() - pilotCache.at < 600_000) return Promise.resolve(pilotCache.token);
  const sessionFile = join(homedir(), '.config/vw/session');
  if (!cfg.pilotJira || !existsSync(sessionFile)) return Promise.resolve(null);
  const session = readFileSync(sessionFile, 'utf8').trim();
  return new Promise((resolve) => {
    execFile('bw', ['get', 'password', 'Jira api'], { env: { ...process.env, BW_SESSION: session }, timeout: 20_000 }, (err, stdout) => {
      const t = String(stdout ?? '').trim();
      if (err || !t) return resolve(null);
      pilotCache = { token: t, at: Date.now() };
      resolve(t);
    });
  });
}

export async function jiraCreds(u: User | null): Promise<JiraCreds | null> {
  if (cfg.demo) return { email: u?.email ?? 'demo@maxenergy.at', token: 'demo', source: 'Demo' };
  if (u) {
    const c: any = await wb().collection('creds').findOne({ userId: u.id });
    if (c?.jira?.token) {
      try { return { email: c.jira.email, token: unseal(c.jira.token), source: 'eigener Token' }; } catch { /* Schlüssel gewechselt */ }
    }
  }
  const isPilot = !u || u.email === cfg.pilotEmail;
  if (isPilot) {
    const t = await pilotToken();
    if (t) return { email: cfg.pilotEmail, token: t, source: 'Pilot (Vaultwarden der VM)' };
  }
  return null;
}

export async function jiraStatus(u: User) {
  const c: any = await wb().collection('creds').findOne({ userId: u.id });
  if (c?.jira) return { connected: true, email: c.jira.email, source: 'eigener Token', canWrite: c.jira.canWrite ?? null, savedAt: c.jira.savedAt };
  if (cfg.demo) return { connected: true, email: u.email, source: 'Demo', canWrite: true };
  if (u.email === cfg.pilotEmail && cfg.pilotJira && existsSync(join(homedir(), '.config/vw/session'))) {
    return { connected: true, email: cfg.pilotEmail, source: 'Pilot (Vaultwarden der VM)', canWrite: false };
  }
  return { connected: false };
}

// ---------- Wer bin ich in Jira? ----------

/** accountId/Anzeigename der Person in Jira (GET /myself mit ihrem Zugang), 1 Tag zwischengespeichert. */
export async function jiraIdentity(u: User): Promise<{ accountId?: string | null; displayName?: string | null; name: string }> {
  const key = `jira_identity:${u.id}`;
  const m: any = await wb().collection('meta').findOne({ _id: key as any });
  if (m && Date.now() - new Date(m.at).getTime() < (m.failed ? 36e5 : 864e5)) return { accountId: m.accountId ?? null, displayName: m.displayName ?? u.name, name: u.name };
  if (!cfg.demo) {
    try {
      const c = await jiraCreds(u);
      if (c) {
        const { jiraFetch } = await import('./jira.ts');
        const me = await jiraFetch(c, 'GET', '/myself');
        await wb().collection('meta').updateOne({ _id: key as any }, { $set: { accountId: me.accountId, displayName: me.displayName, at: new Date() } }, { upsert: true });
        return { accountId: me.accountId, displayName: me.displayName, name: u.name };
      }
    } catch {
      // ohne /myself (z. B. Lesetoken ohne read:jira-user): über den Namen; eine Stunde nicht erneut versuchen
      await wb().collection('meta').updateOne({ _id: key as any }, { $set: { failed: true, at: new Date() }, $unset: { accountId: '' } }, { upsert: true });
    }
  }
  return { name: u.name, displayName: u.name };
}
