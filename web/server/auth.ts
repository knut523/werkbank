// Anmeldung: dieselben Konten wie LibreChat. Das Passwort prüft LibreChat selbst
// (POST /api/auth/login, serverseitig); die Werkbank merkt sich danach nur eine eigene Sitzung
// (Cookie, 7 Tage, in Mongo nur als Hash). Zugelassen sind nur Konten aus der Freigabeliste.

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ObjectId } from 'mongodb';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';

export interface User { id: string; email: string; name: string; role?: string }

const COOKIE = 'wb_session';
const DAYS = 7;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function allowed(email: string): boolean {
  return cfg.allowedEmails.length === 0 || cfg.allowedEmails.includes(email.toLowerCase());
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function librechatLogin(email: string, password: string, clientIp?: string): Promise<User> {
  const r = await fetch(`${cfg.librechatUrl}/api/auth/login`, {
    method: 'POST',
    // Client-IP weitergeben, damit LibreChats Anmelde-Limit je Person greift und nicht für alle (127.0.0.1).
    headers: { 'content-type': 'application/json', ...(clientIp ? { 'x-forwarded-for': clientIp } : {}) },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) throw Object.assign(new Error('Zu viele Anmeldeversuche. Bitte ein paar Minuten warten.'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error('E-Mail oder Passwort stimmt nicht (es gilt das Werkbank-/LibreChat-Konto).'), { status: 401 });
  const j: any = await r.json();
  const u = j.user ?? {};
  const id = String(u._id ?? u.id ?? '');
  if (!id) throw Object.assign(new Error('Anmeldung fehlgeschlagen.'), { status: 502 });
  return { id, email: String(u.email ?? email).toLowerCase(), name: String(u.name ?? u.username ?? email), role: u.role };
}

export async function createSession(res: ServerResponse, user: User) {
  const token = randomBytes(32).toString('hex');
  await wb().collection('sessions').insertOne({
    _id: hash(token) as any, userId: user.id, email: user.email, name: user.name, role: user.role ?? 'USER',
    createdAt: new Date(), expiresAt: new Date(Date.now() + DAYS * 864e5),
  });
  res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${cfg.secureCookies ? '; Secure' : ''}`);
}

export async function destroySession(req: IncomingMessage, res: ServerResponse) {
  const t = cookies(req)[COOKIE];
  if (t) await wb().collection('sessions').deleteOne({ _id: hash(t) as any });
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cfg.secureCookies ? '; Secure' : ''}`);
}

/** HS256-JWT prüfen (wie jsonwebtoken.verify), ohne Abhängigkeit. */
export function verifyJwt(token: string, secret: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !secret) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const sig = createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest();
    const got = Buffer.from(parts[2], 'base64url');
    if (got.length !== sig.length || !timingSafeEqual(got, sig)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

/**
 * Eine Anmeldung für Chat und Werkbank: läuft die Werkbank unter dem LibreChat-Ursprung (/werkbank),
 * kommt LibreChats Refresh-Cookie mit. Es wird wie in LibreChat geprüft (Signatur mit
 * JWT_REFRESH_SECRET + gültige Sitzung mit diesem Token-Hash in LibreChats DB).
 */
export async function librechatSessionUser(req: IncomingMessage): Promise<User | null> {
  const rt = cookies(req).refreshToken;
  const secret = process.env.JWT_REFRESH_SECRET ?? '';
  if (!rt || !secret) return null;
  const payload = verifyJwt(rt, secret);
  if (!payload?.id || !ObjectId.isValid(payload.id)) return null;
  const sess = await lc().collection('sessions').findOne({ refreshTokenHash: hash(rt), user: new ObjectId(payload.id), expiration: { $gt: new Date() } });
  if (!sess) return null;
  const u: any = await lc().collection('users').findOne({ _id: new ObjectId(payload.id) }, { projection: { email: 1, name: 1, username: 1, role: 1 } });
  if (!u) return null;
  return { id: String(u._id), email: String(u.email).toLowerCase(), name: String(u.name || u.username || u.email), role: u.role };
}

export async function currentUser(req: IncomingMessage): Promise<User | null> {
  // 1) LibreChat-Anmeldung (Werkbank unter /werkbank im Chat), 2) eigene Sitzung (direkt auf :3070).
  const viaChat = await librechatSessionUser(req);
  if (viaChat) return allowed(viaChat.email) ? viaChat : null;
  const t = cookies(req)[COOKIE];
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  const s: any = await wb().collection('sessions').findOne({ _id: hash(t) as any, expiresAt: { $gt: new Date() } });
  if (!s) return null;
  if (!allowed(s.email)) return null;  // Freigabe entzogen → Sitzung wertlos
  return { id: s.userId, email: s.email, name: s.name, role: s.role };
}

/** Alle LibreChat-Konten (für "teilen mit …"), ohne Geheimnisse. */
export async function teammates(): Promise<User[]> {
  const us = await lc().collection('users').find({}, { projection: { email: 1, name: 1, username: 1 } }).toArray();
  return us.map((u: any) => ({ id: String(u._id), email: String(u.email).toLowerCase(), name: String(u.name || u.username || u.email) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function userById(id: string): Promise<User | null> {
  if (!ObjectId.isValid(id)) return null;
  const u: any = await lc().collection('users').findOne({ _id: new ObjectId(id) }, { projection: { email: 1, name: 1, username: 1 } });
  return u ? { id, email: String(u.email).toLowerCase(), name: String(u.name || u.username || u.email) } : null;
}
