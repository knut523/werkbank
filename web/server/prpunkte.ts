// Paket 436, Nachtrag Knut (04.11.2026): „Fester Prüfschritt … vor jedem Push von PR-Fixes ALLE offenen Kommentare und ungelösten
// Review-Threads von JEDEM Reviewer (nicht nur bizarrochris) einsammeln und gegen den Fix abhaken; was offen bleibt, sichtbar an der
// PR-Karte.“ Rein: aus dem PR-Kontext (prreview.ts `PrKontext`) die offenen Punkte, und je Punkt, ob der Fix ihn erledigt hat.
// Offen ist: jeder ungelöste Review-Thread (auch veraltete — markiert), das letzte Review je Person mit Text, solange sie danach nicht
// freigegeben hat, und Kommentare anderer, auf die die PR-Autorin danach nicht mehr geantwortet hat. Nicht mitgezählt: eigene
// automatische Texte des Workspace (Marke „(OLAF Workspace)“ — Fix-Antworten, Status, Agenten-Review) und reine Befehle („@fix“).
// ponytail: „beantwortet“ bei Kommentaren heißt nur „die Autorin hat danach geschrieben“ — Threads haben dafür GitHubs „resolved“.
import { createHash } from 'node:crypto';
import type { PrKontext } from './prreview.ts';

export interface OffenerPunkt { id: string; art: 'thread' | 'review' | 'kommentar'; wer: string; wo: string | null; text: string; at: string; veraltet?: boolean }
export type OffenGrund = 'nicht-behandelt' | 'frage' | 'nicht-behoben' | 'ohne-commit';
export interface AbgehakterPunkt extends OffenerPunkt { stand: 'erledigt' | 'offen'; grund: OffenGrund | null; notiz: string | null; commit: string | null }
export const GRUND_DE: Record<OffenGrund, string> = { 'nicht-behandelt': 'vom Fix nicht behandelt', frage: 'Rückfrage des Fixes', 'nicht-behoben': 'nicht behoben', 'ohne-commit': 'als behoben gemeldet, aber ohne Commit in diesem Push' };
const GRUND_EN: Record<OffenGrund, string> = { 'nicht-behandelt': 'not addressed by this fix', frage: 'question', 'nicht-behoben': 'not fixed', 'ohne-commit': 'reported fixed, but no commit in this push' };

const MARKE = '(OLAF Workspace)';
const kennung = (...t: string[]) => `p-${createHash('sha1').update(t.join('\u0000')).digest('hex').slice(0, 8)}`;
const nurBefehl = (t: string) => t.replace(/(^|\s)@(fix|review)(\s+(deep|freigeben|ablehnen))?\b/gi, ' ').replace(/[\s.,!:;-]+/g, '').length < 3;
const kurz = (t: string, n = 400) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const eigen = (t: string) => String(t ?? '').includes(MARKE);

/** Alle offenen Punkte am PR, von jeder Person — älteste zuerst. */
export function alleOffenenPunkte(k: PrKontext | null): OffenerPunkt[] {
  if (!k) return [];
  const autor = (k.author ?? '').toLowerCase();
  const out: OffenerPunkt[] = [];
  for (const t of k.threads) {
    if (t.resolved || !t.comments.length) continue;
    const c0 = t.comments[0], echte = t.comments.filter((c) => !eigen(c.body));
    if (!echte.length) continue;   // nur eigene automatische Texte im Thread
    // Kennung ohne Zeilennummer: wird ein Thread nach dem Push „veraltet“, ändert sich die Zeile (Pass C).
    out.push({ id: kennung('thread', t.path, c0.at, c0.author ?? ''), art: 'thread', wer: echte[0].author ?? '?', wo: `${t.path}${t.line ? `:${t.line}` : ''}`,
      text: kurz([echte[0].body, ...echte.slice(1).map((c) => `${c.author ?? '?'}: ${c.body}`)].join(' / ')), at: c0.at, ...(t.outdated ? { veraltet: true } : {}) });
  }
  // Letztes Review je Person (nicht die Autorin): mit Text, und danach kein „approved“ derselben Person.
  const jeWer = new Map<string, PrKontext['reviews']>();
  // PENDING = eigener, noch nicht abgeschickter Entwurf (nur für das lesende Konto sichtbar) — nie in einen öffentlichen Kommentar (Pass C).
  for (const r of [...k.reviews].filter((r) => r.state !== 'PENDING').sort((a, b) => a.at.localeCompare(b.at))) { const w = (r.author ?? '').toLowerCase(); if (w && w !== autor) jeWer.set(w, [...(jeWer.get(w) ?? []), r]); }
  for (const rs of jeWer.values()) {
    const letzt = rs.at(-1)!;
    if (letzt.state === 'APPROVED' || letzt.state === 'DISMISSED') continue;
    const mitText = [...rs].reverse().find((r) => r.body.trim() && !eigen(r.body) && !nurBefehl(r.body));
    if (!mitText || rs.some((r) => r.at > mitText.at && r.state === 'APPROVED')) continue;
    out.push({ id: kennung('review', mitText.author ?? '', mitText.at), art: 'review', wer: mitText.author ?? '?', wo: null, text: kurz(mitText.body), at: mitText.at });
  }
  // Kommentare anderer, nach denen die Autorin nicht mehr geschrieben hat (Kommentar oder Review).
  const autorZuletzt = [...k.comments, ...k.reviews.filter((r) => r.state !== 'PENDING'), ...k.threads.flatMap((t) => t.comments)].filter((c) => (c.author ?? '').toLowerCase() === autor).map((c) => c.at).sort().at(-1) ?? '';
  for (const c of k.comments) {
    const w = (c.author ?? '').toLowerCase();
    if (!w || w === autor || eigen(c.body) || nurBefehl(c.body) || c.at <= autorZuletzt) continue;
    out.push({ id: kennung('kommentar', c.author ?? '', c.at), art: 'kommentar', wer: c.author ?? '?', wo: null, text: kurz(c.body), at: c.at });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Abhaken: erledigt nur, wenn fix.json den Punkt (über seine Kennung) als „fixed“ führt UND der Commit im gepushten Bereich liegt.
 *  Alles andere bleibt offen — mit der Notiz des Fixes, falls er etwas dazu sagt (Frage, nicht behoben). */
export function abhaken(punkte: OffenerPunkt[], fix: { punkte: { id?: string | null; stand: string; commit: string | null; notiz: string | null; punkt: string }[] } | null, commits: { sha: string }[]): AbgehakterPunkt[] {
  return punkte.map((p) => {
    const f = fix?.punkte.find((x) => x.id && x.id === p.id);
    const sha = String(f?.commit ?? '').trim().toLowerCase();
    const c = /^[0-9a-f]{7,40}$/.test(sha) ? commits.find((x) => x.sha.toLowerCase().startsWith(sha))?.sha ?? null : null;
    const erledigt = f?.stand === 'fixed' && !!c;
    const grund: OffenGrund | null = erledigt ? null : !f ? 'nicht-behandelt' : f.stand === 'question' ? 'frage' : f.stand === 'fixed' ? 'ohne-commit' : 'nicht-behoben';
    return { ...p, stand: erledigt ? 'erledigt' : 'offen', grund, commit: erledigt ? c!.slice(0, 7) : null, notiz: !erledigt && f?.notiz ? kurz(f.notiz, 300) : null };
  });
}

/** Für den Auftrag an den Fix-Strang: jeder offene Punkt mit Kennung — fix.json führt jeden mit seiner Kennung. */
export function punkteFuerAuftrag(punkte: OffenerPunkt[]): string {
  if (!punkte.length) return '(keine weiteren offenen Punkte am PR)';
  return punkte.map((p) => `- \`${p.id}\` · ${p.art === 'thread' ? `Thread an \`${p.wo}\`${p.veraltet ? ' (veraltet)' : ''}` : p.art === 'review' ? 'Review' : 'Kommentar'} von ${p.wer}: ${p.text.replace(/`/g, 'ˋ')}`).join('\n');
}

/** Englischer Abschnitt für den Antwort-Kommentar am PR: was nach dem Fix offen bleibt. Leer, wenn nichts offen ist. */
export function offenText(a: AbgehakterPunkt[] | 'unlesbar'): string[] {
  // Nie still: war der PR vor dem Push nicht lesbar, steht das im Kommentar (Pass C).
  if (a === 'unlesbar') return ['**All open review items (every reviewer):** could not be read before this push — please check the open threads and comments on the PR.', ''];
  const offen = a.filter((p) => p.stand === 'offen');
  if (!a.length) return [];
  const z = [`**All open review items (every reviewer)** — ${a.length - offen.length} of ${a.length} addressed by this fix${offen.length ? `, ${offen.length} still open:` : '.'}`];
  const MAX = 30;   // GitHub-Kommentare haben eine Längengrenze (Pass C)
  for (const p of offen.slice(0, MAX)) z.push(`- ${p.art === 'thread' ? `thread at \`${p.wo}\`` : p.art} by ${p.wer}: ${p.text.replace(/@(?=[\w-])/g, '@​').slice(0, 160)}${p.grund ? ` — ${GRUND_EN[p.grund]}` : ''}${p.notiz ? `: ${p.notiz.replace(/@(?=[\w-])/g, '@​')}` : ''}`);
  if (offen.length > MAX) z.push(`- … and ${offen.length - MAX} more (see the workspace).`);
  return [...z, ''];
}
