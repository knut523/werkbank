// Chief of Staff, S1.2: Sammler für die Morgenlage — liest Mongo-Kopien, Stränge, Register und Vault-Notizen und übergibt sie an baueLage (cos.ts).
// Keine Schreibzugriffe außer dem Schnappschuss (meta.cos_snapshot) und der Lage-Seite (cosjob.ts). Kein LLM, kein Netz (Jira/GitHub nur als Kopie in Mongo).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { wb } from './db.ts';
import { browseUrl } from './config.ts';
import { parseFrontmatter } from './vault.ts';
import { liesRegister, teamNamen, teamSet } from './cosregister.ts';
import { baueLage, stichzeit, wien, dailyZeilen, debriefZeile, syncZeile, type LageInput, type KarteLite, type FrageLite, type MeetingLite, type BerichtZeile, type PrLite, type IssueLite, type Lage, type PrSnap, type TriageLite } from './cos.ts';
import { vorschlaege } from './cosmeeting.ts';
import { scanNotizen, vorbereitung } from './cosvorbereitung.ts';
import type { User } from './auth.ts';

export interface Quellen {
  vaultDir: string;
  /** Karten + Rückfragen der Übersicht (eine Quelle, K8). */
  uebersicht: (u: User) => Promise<{ karten: any[]; qs: any[]; docs: any[] }>;
  /** „Wartet auf dich“ (mineFor) — PRs, eigene überfällige Tickets, Sync-Fragen. */
  mine: (u: User) => Promise<{ prs: any[]; tickets: any[]; questions: any[] }>;
  ich: (u: User) => string;
  /** OLAF-Jira (max-energy), lesend; null = aus. */
  olafJira?: (st: Date) => Promise<{ issues: IssueLite[]; fehler?: string | null } | null>;
  /** Teams, deren Meeting-Notizen gelesen werden (COS_MEETING_TEAMS). */
  meetingTeams?: () => string[];
}

export const meetingTeams = () => (process.env.COS_MEETING_TEAMS || 'olaf').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9_-]+$/i.test(s));
const meta = () => wb().collection('meta');

export const REL = {
  daily: (datum: string) => `olaf/2-Areas/Product/Produkt-OLAF/3-Analysis/Daily-Check/morgen-${datum}.md`,
  debrief: (datum: string) => `olaf/1-Projects/daily-debrief/${datum}-olaf-debrief.md`,
  sync: 'olaf/1-Projects/daily-debrief/vault-sync-protokoll.md',
  lage: (datum: string) => `olaf/1-Projects/daily-debrief/${datum}-olaf-morgenlage.md`,
};
const lies = (dir: string, rel: string) => { try { return readFileSync(join(dir, rel), 'utf8'); } catch { return null; } };
const basename = (rel: string) => rel.replace(/^.*\//, '').replace(/\.md$/, '');

/** Berichte von heute (K1: Platzhalter gibt es nicht — fehlt ein Bericht, fehlt die Zeile). */
export function berichteVon(vaultDir: string, datum: string): BerichtZeile[] {
  const out: BerichtZeile[] = [];
  const d = lies(vaultDir, REL.daily(datum));
  if (d) {
    const z = dailyZeilen(d);
    if (z.daily) out.push({ art: 'daily', label: 'Daily-Check', zeile: z.daily, link: REL.daily(datum) });
    if (z.dienste) out.push({ art: 'dienste', label: 'Dienste', zeile: z.dienste, link: REL.daily(datum) });
  }
  const b = lies(vaultDir, REL.debrief(datum));
  const bz = b ? debriefZeile(b) : null;
  if (bz) out.push({ art: 'debrief', label: 'Jira-Debrief', zeile: bz, link: REL.debrief(datum) });
  const s = lies(vaultDir, REL.sync);
  const sz = s ? syncZeile(s, datum) : null;
  if (sz) out.push({ art: 'sync', label: 'Vault-Sync', zeile: sz, link: REL.sync });
  return out;
}

/** Wikilink-Ziele nur für Dateien, die es wirklich gibt (Vault-Regel 2). */
export function linkMap(vaultDir: string, berichte: BerichtZeile[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const b of berichte) if (b.link && existsSync(join(vaultDir, b.link))) m[b.link] = basename(b.link);
  return m;
}

/** Meeting-Notizen, die seit der Stichzeit angelegt/geändert wurden (nur Zustandswechsel: neue Datei). */
export function meetingsSeit(vaultDir: string, teams: string[], st: Date): MeetingLite[] {
  const out: MeetingLite[] = [];
  for (const t of teams) {
    const dir = join(vaultDir, t, 'Meetings');
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.')); } catch { continue; }
    for (const f of files) {
      const abs = join(dir, f);
      let mt = 0;
      try { const stt = statSync(abs); if (!stt.isFile()) continue; mt = stt.mtimeMs; } catch { continue; }
      if (mt <= +st) continue;
      let fm: Record<string, unknown> = {};
      try { fm = parseFrontmatter(readFileSync(abs, 'utf8')).fm; } catch { /* unlesbar */ }
      if (fm.type && fm.type !== 'meeting') continue;
      out.push({ pfad: `${t}/Meetings/${f}`, name: f.replace(/\.md$/, ''), titel: String(fm.title ?? f.replace(/\.md$/, '')), datum: fm['meeting-date'] ? String(fm['meeting-date']).slice(0, 10) : null, mtime: mt, status: String(fm.status ?? '') });
    }
  }
  return out;
}

export async function ladeSchnappschuss(): Promise<{ at: Date; prs: Record<string, PrSnap>; jira: Record<string, string> } | null> {
  const d: any = await meta().findOne({ _id: 'cos_snapshot' as any });
  return d && d.prs ? { at: new Date(d.at), prs: d.prs, jira: d.jira ?? {} } : null;
}

/** Offene PRs und Jira-Status als Schnappschuss festhalten (abends; die Morgenlage vergleicht damit). */
export async function speichereSchnappschuss(jetzt: Date): Promise<void> {
  const prs = (await wb().collection('github_prs').find({}, { projection: { _id: 0, pr: 1, title: 1, url: 1, reviewDecision: 1 } }).toArray()) as any[];
  const jira = (await wb().collection('jira_issues').find({ type: { $ne: 'Workstream' } }, { projection: { _id: 0, key: 1, status: 1 } }).toArray()) as any[];
  await meta().updateOne({ _id: 'cos_snapshot' as any }, { $set: { at: jetzt, prs: Object.fromEntries(prs.map((p) => [p.pr, { pr: p.pr, title: String(p.title ?? ''), url: String(p.url ?? ''), reviewDecision: p.reviewDecision ?? null }])), jira: Object.fromEntries(jira.map((i) => [i.key, i.status])) } }, { upsert: true });
}

export async function abschlussZeit(): Promise<Date | null> {
  const d: any = await meta().findOne({ _id: 'cos_abschluss' as any });
  return d?.at ? new Date(d.at) : null;
}

const lite = {
  karte: (k: any): KarteLite => ({ id: k.id, titel: k.titel, thema: k.thema, ampel: k.ampel, running: !!k.running, braucht: k.braucht ?? null, entscheidungen: (k.entscheidungen ?? []).map((e: any) => ({ id: e.id, frage: e.frage, empfehlung: e.empfehlung ?? '' })), berichtHash: k.berichtHash ?? null, rueckfragen: (k.rueckfragen ?? []).length ?? 0, statusAt: iso(k.statusAt), chat: k.chat ?? null }),
  frage: (q: any, titel: Map<string, string>): FrageLite => ({ id: q.id, title: q.title, recommendation: q.recommendation ?? '', options: q.options ?? [], strandId: q.strand?.id ? String(q.strand.id) : null, strandTitel: q.strand?.id ? titel.get(String(q.strand.id)) : undefined, createdAt: iso(q.createdAt), link: q.link ?? null }),
};
const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : '');

export async function sammleEingabe(u: User, q: Quellen, jetzt: Date): Promise<LageInput> {
  const heute = wien(jetzt).datum;
  const [ub, mine, snap, abschluss] = await Promise.all([q.uebersicht(u), q.mine(u), ladeSchnappschuss(), abschlussZeit()]);
  const st = stichzeit(jetzt, abschluss);
  const startedAt = new Map(ub.docs.map((d: any) => [String(d._id), iso(d.startedAt)]));
  const docVon = new Map(ub.docs.map((d: any) => [String(d._id), d]));
  const karten = ub.karten.map((k) => { const d: any = docVon.get(k.id); return { ...lite.karte(k), startedAt: startedAt.get(k.id) ?? null, budget: d?.budget?.anzeige ?? null, lebenszeichen: d?.heartbeat?.zustand ? { zustand: d.heartbeat.zustand, minuten: d.heartbeat.minuten ?? 0 } : null }; });
  const titel = new Map(karten.map((k) => [k.id, k.titel]));
  const fragen = ub.qs.map((x: any) => lite.frage(x, titel));
  const prs = ((await wb().collection('github_prs').find({}, { projection: { _id: 0 } }).toArray()) as any[]).map((p): PrLite => ({ pr: p.pr, title: p.title ?? '', url: p.url ?? '', author: p.author ?? null, createdAt: p.createdAt ?? '', updatedAt: p.updatedAt ?? '', reviewDecision: p.reviewDecision ?? null, turn: p.turn ?? { who: '', role: '', why: '' } }));
  const jira = ((await wb().collection('jira_issues').find({ type: { $ne: 'Workstream' } }, { projection: { _id: 0, key: 1, summary: 1, status: 1, statusCategory: 1, assignee: 1, duedate: 1, updated: 1, created: 1, statusSince: 1, blockedBy: 1, workstream: 1 } }).toArray()) as any[]).map((i): IssueLite => ({ ...i, url: browseUrl(i.key) }));
  const register = liesRegister(q.vaultDir);
  const namen = teamNamen(q.vaultDir);
  const teams = (q.meetingTeams ?? meetingTeams)();
  const berichte = berichteVon(q.vaultDir, heute);
  const olafJira = q.olafJira ? await q.olafJira(st).catch((e: any) => ({ issues: [], fehler: String(e?.message ?? e).slice(0, 120) })) : null;
  const versteckt = new Set(((await wb().collection('cos_triage').find({ art: 'nein' }).toArray().catch(() => [])) as any[]).map((d) => String(d._id)));
  const tri = vorschlaege(q.vaultDir, teams, heute, versteckt);
  const triage: TriageLite[] = tri.items;
  return {
    jetzt, stichzeit: st, karten, fragen, mine: { prs: mine.prs, tickets: mine.tickets }, prs, prSnapshot: snap?.prs ?? null, jira, jiraSnapshot: snap?.jira ?? null, olafJira,
    register: { vorhanden: register.vorhanden, zusagen: register.zusagen, themen: register.themen, personen: register.personen, unlesbar: register.unlesbar, themenUnlesbar: register.themenUnlesbar, doppelt: register.doppelt },
    team: teamSet(namen), meetings: meetingsSeit(q.vaultDir, teams, st), triage, berichte, roadmapFragen: (mine.questions ?? []).filter((x: any) => !x.answer).length, ich: q.ich(u), triageInfo: { aelter: tri.aelter, ohnePunkte: tri.ohnePunkte },
    termine: vorbereitung({ heute, notizen: scanNotizen(q.vaultDir, teams), register: { termine: register.termine, zusagen: register.zusagen, personen: register.personen } }),
  };
}

export async function sammleLage(u: User, q: Quellen, jetzt: Date = new Date()): Promise<{ lage: Lage; eingabe: LageInput }> {
  const eingabe = await sammleEingabe(u, q, jetzt);
  return { lage: baueLage(eingabe), eingabe };
}
