// Zugangsdaten je Person — nie im Repo, nie im Log.
// Claude: der Token aus `claude setup-token` liegt im LibreChat-Schlüsselspeicher (Endpunkt
//   "Claude Code", verschlüsselt mit CREDS_KEY). Die Werkbank schreibt ihn dort hinein (Einrichtung)
//   und liest ihn für "Agent ansetzen". So gibt es genau eine Stelle.
// Weitere Claude-Konten (automatischer Wechsel bei ausgeschöpftem Kontingent): AES-GCM in werkbank.creds, siehe unten.
// Jira: E-Mail + Atlassian-API-Token je Person, AES-GCM-verschlüsselt in werkbank.creds.
//   Pilot: für das Pilotkonto darf der Token aus dem Vaultwarden der VM kommen (Eintrag
//   "Jira api", wie maxenergy-jira/scripts/jira-read.sh) — nur lesend.

import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
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

// ---------- Mehrere Claude-Konten (Knut, 06.10.2026: „wie cswap auto“) ----------
// Weitere Konten einer Person (je ein Token aus `claude setup-token`) mit Namen und Reihenfolge, AES-256-GCM in
// werkbank.creds (wie der Jira-Token). Der LibreChat-Schlüssel ist das Konto „chat“ und bleibt, wo er ist. Die Brücke
// bekommt die Liste über den internen Kanal; der Browser sieht nur Name und die letzten 4 Zeichen.

export const CLAUDE_CHAT_ID = 'chat';
export const CLAUDE_CHAT_LABEL = 'Chat-Schlüssel';
export const MAX_CLAUDE_ACCOUNTS = 5;   // weitere Konten neben dem Chat-Schlüssel

interface StoredAccount { id: string; label: string; token: string; last4: string; addedAt: Date }
type HttpErr = Error & { status: number };
const httpErr = (status: number, msg: string): HttpErr => Object.assign(new Error(msg), { status });

async function accountsDoc(u: User): Promise<{ accounts: StoredAccount[]; order: string[]; chat: string | null }> {
  const [doc, chat]: [any, string | null] = await Promise.all([wb().collection('creds').findOne({ userId: u.id }), getClaudeToken(u)]);
  const accounts: StoredAccount[] = Array.isArray(doc?.claudeAccounts) ? doc.claudeAccounts : [];
  const ids = [...(chat ? [CLAUDE_CHAT_ID] : []), ...accounts.map((a) => a.id)];
  const saved: string[] = (Array.isArray(doc?.claudeOrder) ? doc.claudeOrder : []).filter((id: string) => ids.includes(id));
  return { accounts, chat, order: [...saved, ...ids.filter((id) => !saved.includes(id))] };
}

/** Für die Einrichtung: Name, ••••+4, Herkunft — nie der Token. */
export async function listClaudeAccounts(u: User) {
  const { accounts, order, chat } = await accountsDoc(u);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return order.map((id) => id === CLAUDE_CHAT_ID
    ? { id, label: CLAUDE_CHAT_LABEL, last4: chat!.slice(-4), source: 'chat' as const, addedAt: null }
    : { id, label: byId.get(id)!.label, last4: byId.get(id)!.last4, source: 'werkbank' as const, addedAt: byId.get(id)!.addedAt });
}

/** Für die Brücke (interner Kanal): Klartext in Reihenfolge; chat ohne Token (die Brücke hat ihn aus der Anfrage). */
export async function claudeAccountsForBridge(u: User): Promise<{ id: string; label: string; token: string | null }[]> {
  const { accounts, order } = await accountsDoc(u);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: { id: string; label: string; token: string | null }[] = [];
  for (const id of order) {
    if (id === CLAUDE_CHAT_ID) { out.push({ id, label: CLAUDE_CHAT_LABEL, token: null }); continue; }
    const a = byId.get(id)!;
    try { out.push({ id, label: a.label, token: unseal(a.token) }); } catch { /* Schlüssel gewechselt: Konto übergehen */ }
  }
  return out;
}

/** Token eines Kontos (für den Test), null = unbekannt. */
export async function claudeAccountToken(u: User, id: string): Promise<string | null> {
  if (id === CLAUDE_CHAT_ID) return getClaudeToken(u);
  const a = (await accountsDoc(u)).accounts.find((x) => x.id === id);
  if (!a) return null;
  try { return unseal(a.token); } catch { return null; }
}

export async function addClaudeAccount(u: User, label: string, token: string) {
  const name = String(label ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > 40) throw httpErr(400, 'Bitte einen Namen für das Konto angeben (höchstens 40 Zeichen), z. B. „Firma“ oder „Privat“.');
  const t = String(token ?? '').trim();
  const err = checkClaudeToken(t);
  if (err) throw httpErr(400, err);
  const { accounts, chat, order } = await accountsDoc(u);
  if (accounts.length >= MAX_CLAUDE_ACCOUNTS) throw httpErr(400, `Höchstens ${MAX_CLAUDE_ACCOUNTS} weitere Konten.`);
  const known = [chat, ...accounts.map((a) => { try { return unseal(a.token); } catch { return null; } })];
  if (known.includes(t)) throw httpErr(409, 'Dieses Konto ist schon hinterlegt.');
  const acc: StoredAccount = { id: randomBytes(6).toString('hex'), label: name, token: seal(t), last4: t.slice(-4), addedAt: new Date() };
  await wb().collection('creds').updateOne(
    { userId: u.id },
    { $set: { userId: u.id, claudeOrder: [...order, acc.id] }, $push: { claudeAccounts: acc } as any },
    { upsert: true },
  );
  return { id: acc.id, label: acc.label, last4: acc.last4 };
}

export async function removeClaudeAccount(u: User, id: string) {
  if (id === CLAUDE_CHAT_ID) throw httpErr(400, 'Den Chat-Schlüssel entfernst du oben mit „Trennen“.');
  const { accounts, order } = await accountsDoc(u);
  if (!accounts.some((a) => a.id === id)) throw httpErr(404, 'Konto nicht gefunden.');
  await wb().collection('creds').updateOne({ userId: u.id }, { $pull: { claudeAccounts: { id } } as any, $set: { claudeOrder: order.filter((x) => x !== id) } });
}

export async function reorderClaudeAccounts(u: User, ids: unknown) {
  const { order } = await accountsDoc(u);
  const want = Array.isArray(ids) ? ids.map(String) : [];
  if (want.length !== order.length || new Set(want).size !== want.length || !want.every((id) => order.includes(id))) {
    throw httpErr(400, 'Die Reihenfolge muss genau deine Konten enthalten.');
  }
  await wb().collection('creds').updateOne({ userId: u.id }, { $set: { userId: u.id, claudeOrder: want } }, { upsert: true });
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

// ---------- GitHub (nur lesend) ----------
// PR-Review live: ein Lesetoken für die Organisation WirStrom1. Reihenfolge: WERKBANK_GITHUB_TOKEN (Env), sonst — nur
// im Pilot — das Vaultwarden-Element „View only github API“ (wie im Skill wirstrom-github-team). Nur im Speicher,
// 10 Minuten; nie ins Frontend, nie ins Log. Benutzt wird er ausschließlich für GraphQL-Abfragen (keine Mutation).

let ghCache: { token: string; at: number } | null = null;

export function githubReadToken(): Promise<string | null> {
  if (process.env.WERKBANK_GITHUB_TOKEN) return Promise.resolve(process.env.WERKBANK_GITHUB_TOKEN);
  if (cfg.demo) return Promise.resolve(process.env.WERKBANK_GITHUB_API ? 'demo' : null);
  if (ghCache && Date.now() - ghCache.at < 600_000) return Promise.resolve(ghCache.token);
  const sessionFile = join(homedir(), '.config/vw/session');
  if (!cfg.pilotJira || !existsSync(sessionFile)) return Promise.resolve(null);
  const session = readFileSync(sessionFile, 'utf8').trim();
  const item = process.env.WERKBANK_GITHUB_BW_ITEM || 'View only github API';
  return new Promise((resolve) => {
    execFile('bw', ['get', 'item', item], { env: { ...process.env, BW_SESSION: session }, timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      let pw = '';
      try { pw = String(JSON.parse(String(stdout)).login?.password ?? ''); } catch { return resolve(null); }
      const t = pw.match(/(ghp_|github_pat_)[A-Za-z0-9_]+/)?.[0] ?? '';
      if (!t) return resolve(null);
      ghCache = { token: t, at: Date.now() };
      resolve(t);
    });
  });
}
