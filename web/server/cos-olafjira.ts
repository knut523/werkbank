// Chief of Staff, S2.3: OLAF-Jira (Site max-energy, Projekt OLAF) in der Morgenlage — NUR LESEND, eigene Datei (docs/plan-chief-of-staff.md, K21).
// Seite und cloudId aus der Seitenliste von 17b (`jiraSites`, WERKBANK_JIRA_SITES); fehlt dort OLAF, die feste Entwicklungsseite —
// nie die Hauptseite (sonst fragte die Lage PM nach `project = OLAF`). COS_OLAF_JIRA_* überschreiben (Tests).
// Zugang: derselbe Pilot-Token „Jira api“ wie bei der PM-Kopie, über das api.atlassian.com-Gateway. Not-Aus: COS_OLAF_JIRA=off. 10 Minuten Cache.

import type { IssueLite } from './cos.ts';
import { jiraSites, OLAF_DEV_SITE, siteBase } from './config.ts';

const olafSeite = () => jiraSites().find((s) => s.prefix === 'OLAF' && !s.main) ?? { ...OLAF_DEV_SITE, main: false };
export const olafAn = (env = process.env) => (env.COS_OLAF_JIRA ?? 'on') !== 'off';
export const olafCloudId = (env = process.env) => env.COS_OLAF_JIRA_CLOUD || olafSeite().cloudId;
export const olafBase = (env = process.env) => (env.COS_OLAF_JIRA_BASE || (env.COS_OLAF_JIRA_CLOUD ? `https://api.atlassian.com/ex/jira/${env.COS_OLAF_JIRA_CLOUD}/rest/api/3` : siteBase(olafSeite()))).replace(/\/$/, '');
export const olafSite = (env = process.env) => (env.COS_OLAF_JIRA_SITE || olafSeite().site).replace(/\/$/, '');

/** JQL in Wiener Wanduhr (Jira rechnet in der Zeitzone des Zugangs; Fehler von ±1 h sind für „über Nacht“ unerheblich). */
export function olafJql(st: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(st).map((x) => [x.type, x.value]));
  return `project = OLAF AND updated >= "${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}" ORDER BY updated DESC`;
}

export const FELDER = ['summary', 'status', 'assignee', 'duedate', 'updated', 'created', 'statuscategorychangedate'];

export function mapOlaf(raw: any, site = olafSite()): IssueLite {
  const f = raw?.fields ?? {};
  return {
    key: String(raw?.key ?? ''), summary: String(f.summary ?? ''), status: String(f.status?.name ?? '?'), statusCategory: f.status?.statusCategory?.key,
    assignee: f.assignee?.displayName ?? null, duedate: f.duedate ?? null, updated: String(f.updated ?? ''), created: f.created ? String(f.created) : undefined,
    statusSince: f.statuscategorychangedate ? String(f.statuscategorychangedate) : null, url: `${site}/browse/${raw?.key}`,
  };
}

export interface OlafDeps { creds: () => Promise<{ email: string; token: string } | null>; fetch?: typeof fetch; env?: NodeJS.ProcessEnv; jetzt?: () => number }

const cache = new Map<string, { at: number; v: { issues: IssueLite[]; fehler?: string | null } }>();

/** Lesen (GET /search/jql). null = aus. Fehler werden als Text zurückgegeben, nicht geworfen (die Lage bleibt ohne diese Quelle nutzbar). */
export async function olafJira(st: Date, d: OlafDeps): Promise<{ issues: IssueLite[]; fehler?: string | null } | null> {
  const env = d.env ?? process.env;
  if (!olafAn(env)) return null;
  const jetzt = d.jetzt?.() ?? Date.now();
  const key = `${olafBase(env)}|${Math.floor(+st / 60_000)}`;
  const c = cache.get(key);
  if (c && jetzt - c.at < 600_000) return c.v;
  const creds = await d.creds();
  if (!creds) return { issues: [], fehler: 'kein Jira-Zugang (Pilot-Token)' };
  const url = `${olafBase(env)}/search/jql?${new URLSearchParams({ jql: olafJql(st), fields: FELDER.join(','), maxResults: '100' })}`;
  try {
    const r = await (d.fetch ?? fetch)(url, { method: 'GET', headers: { authorization: `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { issues: [], fehler: `Jira OLAF antwortet mit ${r.status}${r.status === 401 || r.status === 403 ? ' (Token ohne Zugriff auf diese Seite)' : ''}` };
    const j: any = await r.json().catch(() => ({}));
    const v = { issues: ((j.issues ?? []) as any[]).map((x) => mapOlaf(x, olafSite(env))), fehler: null };
    cache.set(key, { at: jetzt, v });
    return v;
  } catch (e: any) { return { issues: [], fehler: String(e?.message ?? e).slice(0, 120) }; }
}
export const _leereCache = () => cache.clear();
