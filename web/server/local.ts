// Zielzuordnung und Sprint-Mitgliedschaft in der Werkbank (Knut, 30.09., Runde 7): nicht in Jira.
//
// goal_assignments      aktueller Stand je key (Ticket-Key oder Spec-Pfad): {_id: key, key, kind, ziel, begruendung, by, at}
//                       ziel: 'KR1' … | 'KEINS' (bewusst ohne, mit Begründung) | null (lokal entfernt → Jira-Label zählt nicht)
// goal_assignments_log  append-only Verlauf jeder Änderung {key, kind, ziel, prev, begruendung, by, at, source}
// sprint_members        {_id: `${sprint}|${key}`, key, sprint, in, by, at}   (in=false: rausgenommen, schlägt ein Jira-Label)
// sprint_members_log    append-only
// Jira-Labels ziel-*/sprint-* werden weiter gelesen (Fallback/Import); die Werkbank-Zuordnung gewinnt.
// Die Collections entstehen beim ersten Schreiben bzw. durch die Indizes in db.ts — keine Migration.

import { wb } from './db.ts';
import type { Issue } from './jira.ts';
import type { User } from './auth.ts';

export type Kind = 'ticket' | 'spec';
export interface Assignment { key: string; kind: Kind; ziel: string | null; begruendung?: string; by: string; at: Date }

export async function assignments(kind?: Kind): Promise<Map<string, Assignment>> {
  const rows = (await wb().collection('goal_assignments').find(kind ? { kind } : {}, { projection: { _id: 0 } }).toArray()) as unknown as Assignment[];
  return new Map(rows.map((r) => [r.key, r]));
}

/** Ticket-Kopie um lokale Zuordnung und Sprint-Mitgliedschaft ergänzen (localGoal / localSprints). */
export async function attachLocal<T extends Issue>(issues: T[]): Promise<T[]> {
  const [ga, sm] = await Promise.all([assignments('ticket'), wb().collection('sprint_members').find({}).toArray()]);
  const sprints = new Map<string, Record<string, boolean>>();
  for (const m of sm as any[]) { const r = sprints.get(m.key) ?? {}; r[m.sprint] = !!m.in; sprints.set(m.key, r); }
  return issues.map((i) => {
    const a = ga.get(i.key), s = sprints.get(i.key);
    if (!a && !s) return i;
    return { ...i, ...(a ? { localGoal: a.ziel } : {}), ...(s ? { localSprints: s } : {}) };
  });
}

export async function setGoal(u: User, key: string, kind: Kind, ziel: string | null, begruendung = '', source = 'werkbank'): Promise<{ prev: string | null | undefined }> {
  const col = wb().collection('goal_assignments');
  const doc = { key, kind, ziel, begruendung: begruendung.slice(0, 500), by: u.name, byId: u.id, at: new Date(), source };
  // Atomar: alter Stand kommt aus derselben Operation; scheitert der Verlaufseintrag, wird zurückgesetzt.
  const before: any = await col.findOneAndReplace({ _id: key as any }, doc, { upsert: true, returnDocument: 'before' });
  try { await wb().collection('goal_assignments_log').insertOne({ ...doc, action: 'set', prev: before ? before.ziel : undefined } as any); }
  catch (e) { if (before) await col.replaceOne({ _id: key as any }, before); else await col.deleteOne({ _id: key as any }); throw e; }
  return { prev: before?.ziel };
}

/** Werkbank-Zuordnung zurücksetzen: Dokument weg, danach gelten wieder Jira-Label bzw. Frontmatter ziel:. */
export async function resetGoal(u: User, key: string, kind: Kind): Promise<{ prev: string | null | undefined }> {
  const col = wb().collection('goal_assignments');
  const before: any = await col.findOneAndDelete({ _id: key as any });
  if (before) await wb().collection('goal_assignments_log').insertOne({ key, kind, ziel: null, action: 'reset', prev: before.ziel, by: u.name, byId: u.id, at: new Date(), source: 'werkbank' } as any);
  return { prev: before?.ziel };
}

export async function setSprint(u: User, key: string, sprint: string, member: boolean, source = 'werkbank') {
  const at = new Date();
  const doc = { key, sprint, in: member, by: u.name, byId: u.id, at, source };
  await wb().collection('sprint_members').replaceOne({ _id: `${sprint}|${key}` as any }, doc, { upsert: true });
  await wb().collection('sprint_members_log').insertOne({ ...doc } as any);
}

export async function goalHistory(key: string) {
  return wb().collection('goal_assignments_log').find({ key }, { projection: { _id: 0, byId: 0 } }).sort({ at: -1 }).limit(20).toArray();
}

/** Label-Schreibweg nach Jira nur, wenn ausdrücklich eingeschaltet (Standard: aus). */
export const goalsToJira = () => process.env.WERKBANK_GOALS_TO_JIRA === 'labels';
