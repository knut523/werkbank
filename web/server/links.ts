// Verknüpfung Vault ↔ Jira-Tickets (Knut, 29.09.: „bestehende und neue Vault-Seiten mit Tasks verknüpfen“).
//
// Eine Notiz gehört zu einem Ticket, wenn der Key im Frontmatter steht (jira/ticket/tickets/jira-key),
// im Text vorkommt (ohne Code) oder als Jira-Link (…/browse/PM-123). PR-Links in derselben Zeile wie der
// Key werden mitgenommen. Für Notizen ohne Key gibt es Vorschläge (Titel/Tags/Name gegen den Ticket-Titel);
// bestätigt wird ein Vorschlag, indem `jira:` ins Frontmatter geschrieben wird.

import { stripCode } from './vault.ts';

export const PROJECT = process.env.WERKBANK_JIRA_PROJECT || 'PM';
const KEY_RE = new RegExp(`\\b${PROJECT}-\\d+\\b`, 'g');
const PR_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

export interface TicketRef { key: string; via: 'frontmatter' | 'text' | 'link'; prs: string[] }

export function extractTicketRefs(fm: Record<string, unknown>, body: string): TicketRef[] {
  const out = new Map<string, TicketRef>();
  const add = (key: string, via: TicketRef['via'], prs: string[] = []) => {
    const r = out.get(key);
    if (!r) out.set(key, { key, via, prs: [...new Set(prs)] });
    else { r.prs = [...new Set([...r.prs, ...prs])]; if (via === 'frontmatter') r.via = via; }
  };
  for (const f of ['jira', 'ticket', 'tickets', 'jira-key', 'jira_key']) {
    for (const v of [fm[f]].flat()) for (const k of String(v ?? '').match(KEY_RE) ?? []) add(k, 'frontmatter');
  }
  for (const line of stripCode(body).split('\n')) {
    const keys = line.match(KEY_RE);
    if (!keys) continue;
    const prs = line.match(PR_RE) ?? [];
    const linked = new Set([...line.matchAll(new RegExp(`atlassian\\.net/browse/(${PROJECT}-\\d+)`, 'g'))].map((m) => m[1]));
    for (const k of keys) add(k, linked.has(k) ? 'link' : 'text', prs);
  }
  return [...out.values()];
}

/** `jira: <key>` ins Frontmatter setzen, sonst nichts ändern. null = schon verknüpft. */
export function addJiraFrontmatter(text: string, key: string): string | null {
  if (!text.startsWith('---\n')) return `---\njira: ${key}\n---\n${text}`;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return `---\njira: ${key}\n---\n${text}`;
  const head = text.slice(4, end);
  const rest = text.slice(end);
  const lines = head.split('\n');
  const i = lines.findIndex((l) => /^jira:/.test(l));
  if (i < 0) return `---\n${head}${head ? '\n' : ''}jira: ${key}${rest}`;
  const val = lines[i].slice(5).trim();
  if (new RegExp(`\\b${key}\\b`).test(val)) return null;
  if (!val) {
    // Blockliste darunter
    let j = i + 1;
    const items: string[] = [];
    while (j < lines.length && /^\s+-\s/.test(lines[j])) { items.push(lines[j]); j++; }
    if (items.some((l) => new RegExp(`\\b${key}\\b`).test(l))) return null;
    const indent = items[0]?.match(/^(\s+)-/)?.[1] ?? '  ';
    lines.splice(j, 0, `${indent}- ${key}`);
  } else if (val.startsWith('[')) {
    lines[i] = `jira: [${val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).concat(key).join(', ')}]`;
  } else {
    lines[i] = `jira: [${val}, ${key}]`;
  }
  return `---\n${lines.join('\n')}${rest}`;
}

// ---------- Vorschläge ----------

const STOP = new Set(['und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'für', 'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'nach', 'the', 'and', 'for', 'with', 'olaf', 'phase', 'neu', 'neue', 'notizen', 'notiz', 'uebersicht', 'übersicht', 'stand', 'plan', 'bauen', 'machen', 'klären', 'offene', 'punkte', 'umsetzung', 'anforderungen', 'review', 'app', 'dokumentation', 'doku', 'migration', 'wirstrom', 'maxenergy', 'konekto', 'amper', 'code', 'setup', 'test', 'check', 'status', 'quo', 'roadmap', 'workshop', 'team', 'abstimmen', 'durchführen', 'erstellen', 'prüfen']);

export function tokens(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').split(' ').filter((t) => t.length >= 3 && !/^\d+$/.test(t)))];
}
const meaningful = (ts: string[]) => ts.filter((t) => !STOP.has(t));

export interface NoteLike { path: string; name: string; title: string; fm: Record<string, unknown>; tickets: string[] }
export interface IssueLike { key: string; summary: string; status: string; assignee?: string | null }
export interface Suggestion { path: string; title: string; score: number; why: string }

const SKIP_PATH = /transcript|\/(People|Personen|Kontakte)\/|^_meta\/|\/Timeline\/|daily|debrief/i;

/**
 * Je Ticket höchstens 3 Notizen ohne Key, die thematisch passen. Grundlage: Begriffe aus Titel, Dateiname
 * und Tags gegen den Ticket-Titel; Personennamen (Owner) und allgemeine Wörter zählen nicht.
 * Passend = mindestens zwei gemeinsame Begriffe (einer davon selten) oder ein seltener, langer Begriff.
 */
export function suggestTickets(notes: NoteLike[], issues: IssueLike[], dismissed = new Set<string>()): Map<string, Suggestion[]> {
  const people = new Set(issues.flatMap((i) => tokens(i.assignee ?? '')));
  const useful = (ts: string[]) => meaningful(ts).filter((t) => !people.has(t));
  const cands = notes.filter((n) => !n.tickets.length && !SKIP_PATH.test(n.path));
  const noteToks = new Map(cands.map((n) => [n.path, useful(tokens(`${n.title} ${n.name.replace(/-/g, ' ')} ${[n.fm.tags].flat().filter(Boolean).join(' ')}`))]));
  const df = new Map<string, number>();
  for (const ts of noteToks.values()) for (const t of ts) df.set(t, (df.get(t) ?? 0) + 1);
  const out = new Map<string, Suggestion[]>();
  for (const i of issues) {
    if (i.status === 'Done') continue;
    const its = useful(tokens(i.summary));
    if (!its.length) continue;
    const list: Suggestion[] = [];
    for (const n of cands) {
      if (dismissed.has(`${i.key}|${n.path}`)) continue;
      const nt = noteToks.get(n.path)!;
      const common = its.filter((t) => nt.includes(t));
      if (!common.length) continue;
      const rare = common.filter((t) => (df.get(t) ?? 0) <= 2 && t.length >= 7);
      const specific = common.filter((t) => (df.get(t) ?? 0) <= 10);
      if (!(common.length >= 2 && specific.length) && !rare.length) continue;
      const score = common.reduce((s, t) => s + 1 / Math.log2(1 + (df.get(t) ?? 1)), 0) / Math.max(its.length, 1);
      list.push({ path: n.path, title: n.title, score: Math.round(score * 100) / 100, why: `gemeinsam: ${common.join(', ')}` });
    }
    list.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    if (list.length) out.set(i.key, list.slice(0, 3));
  }
  return out;
}
