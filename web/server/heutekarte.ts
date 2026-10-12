// „Heute“ verständlich (docs/plan-heute-verstaendlich.md, Paket 141): je Review-Karte worum es geht, was Knut jetzt tun
// soll und ob der Strang schon live ist. Reine Funktionen — Texte und Git-Ausgaben kommen herein (releasestand.ts liest sie).

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
export const nothing = (t?: string | null) => !t || /^(nichts\b|keins?\s*([.(]|$)|keine\s*([.(]|$)|[—–-]+\s*$|n\/a\b|entfällt\b)/i.test(t.trim().replace(/^\*+|\*+$/g, ''));

/** Erster Satz (bis . ! ? vor Leerzeichen/Ende), ohne Markdown-Fett. */
export function firstSentence(t: string): string {
  const s = oneLine(t.replace(/\*\*/g, ''));
  const m = s.match(/^(.+?[.!?][“”"»]?)(\s|$)/);
  return m ? m[1] : s;
}

const h1 = (md: string) => md.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ?? null;

/** Abschnitt unter einer `##`-Überschrift, die auf re passt (bis zur nächsten `#`/`##`-Überschrift). */
export function section(md: string, re: RegExp): string | null {
  const lines = md.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const i = lines.findIndex((l) => /^#{2,3}\s/.test(l) && re.test(l.replace(/^#+\s*/, '')));
  if (i < 0) return null;
  const level = lines[i].match(/^#+/)![0].length;
  const end = lines.findIndex((l, j) => j > i && new RegExp(`^#{1,${level}}\\s`).test(l));
  return lines.slice(i + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** Ziel-Text: Abschnitt „## Ziel“ oder eine Zeile „Ziel: …“. */
function ziel(md: string): string | null {
  const sec = section(md, /^Ziel\b/i);
  const para = sec?.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^[-*|>]/.test(p)) ?? sec?.split('\n').find((l) => l.trim());
  if (para) return firstSentence(para.replace(/^[-*]\s+/, ''));
  const line = md.match(/^\s*(?:[-*]\s*)?\**Ziel:?\**:?\s+(.+)$/im)?.[1];
  return line ? firstSentence(line) : null;
}

/** Plan-Titel ohne Vorsatz wie „Plan:“, „Schnitt 1:“, „Paket 141 —“. */
const cleanTitle = (t: string) => t.replace(/^(Plan|Paket\s+\d+|Schnitt\s+\d+)\s*[:—–-]\s*/i, '').replace(/\.\s*Bericht$/i, '').trim();

/**
 * Worum es geht — ein Satz: Plan-Titel + Ziel des Plans; sonst Ziel im Bericht; sonst „Ziel:“ im Auftrag; sonst der erste
 * Satz des Auftrags ohne Vorspann „Auftrag (Knut …):“ / „Orchestrator · …“. Höchstens 240 Zeichen.
 */
export function worumGeht(o: { title?: string | null; prompt?: string | null; planText?: string | null; berichtText?: string | null }): string {
  const plan = o.planText ?? '', ber = o.berichtText ?? '', prompt = o.prompt ?? '';
  const pz = plan && ziel(plan);
  if (pz) { const t = h1(plan); return clip(t ? `${cleanTitle(t)}: ${pz}` : pz, 240); }
  const bz = ber && ziel(ber);
  if (bz) return clip(bz, 240);
  const az = ziel(prompt);
  if (az) return clip(az, 240);
  const body = prompt.replace(/^\s*Auftrag\b[^:\n]{0,60}:\s*/i, '').replace(/^[„"]/, '');
  const s = firstSentence(body).replace(/[“"]$/, '');
  return clip(s || oneLine(o.title ?? ''), 240);
}

export interface TodoStep { text: string }

/** Relative Markdown-Links/Bilder auf die Paket-Datei in der Werkbank umbiegen (wie renderPaketMd). */
export function paketLinks(text: string, paket: string | null): string {
  if (!paket) return text;
  return text.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (all, a, url: string, b) => {
    if (/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(url) || url.includes('..')) return all;
    const rel = url.replace(/^\.\//, '').split('#')[0].split('?')[0];
    return `${a}api/files/agenten/${encodeURIComponent(paket)}/${rel.split('/').map(encodeURIComponent).join('/')}${b}`;
  });
}

/** Listenpunkte eines Abschnitts (1. / - / *), Folgezeilen angehängt. */
function items(sec: string): string[] {
  const out: string[] = [];
  for (const l of sec.split('\n')) {
    const m = l.match(/^\s{0,3}(?:\d+[.)]|[-*])\s+(.+)$/);
    if (m) out.push(m[1].trim());
    else if (out.length && /^\s{2,}\S/.test(l)) out[out.length - 1] += ' ' + l.trim();
    else if (out.length && !l.trim()) continue;
  }
  return out.map(oneLine).filter(Boolean);
}

/**
 * Was Knut jetzt tun soll: 1–3 Schritte aus „Für Knut zur Nachprüfung“ bzw. „Braucht Knut“ im Bericht, sonst aus der
 * Zeile „- Braucht Knut: …“ im „### Stand“-Auszug. „nichts“ zählt nicht. Rest als Zahl (more).
 */
export function wasTun(o: { berichtText?: string | null; excerpt?: string | null; paket?: string | null }, max = 3): { steps: TodoStep[]; more: number } {
  let list: string[] = [];
  const ber = o.berichtText ?? '';
  for (const re of [/Für Knut|Nachprüfung/i, /^Braucht Knut/i]) {
    const sec = ber && section(ber, re);
    if (sec) {
      const raw = items(sec);
      list = raw.length ? raw.filter((t) => !nothing(t)) : nothing(firstSentence(sec)) ? [] : [firstSentence(sec)];
    }
    if (list.length) break;
  }
  if (!list.length) {
    const m = (o.excerpt ?? '').match(/^\s*[-*]\s*Braucht Knut:\s*(.+)$/im);
    if (m && !nothing(m[1])) list = [m[1].trim()];
  }
  return { steps: list.slice(0, max).map((t) => ({ text: clip(paketLinks(t, o.paket ?? null), 500) })), more: Math.max(0, list.length - max) };
}

// ---------- Stand: live / in Release N / teilweise / fertig / läuft ----------
// Council Bedingung 1–3: live heißt „im SHA des neuesten Live-Commits enthalten“, nicht „im Live-Zweig“.

export interface LiveEntry { branch: string; sha: string }

/** Live-Log (Betreffe, neueste zuerst) → Einträge in zeitlicher Reihenfolge. „werkbank-gh“ und „werkbank-release“ zählen. */
export function parseLiveLog(subjects: string[]): LiveEntry[] {
  const out: LiveEntry[] = [];
  for (const s of subjects) {
    const m = s.match(/^Live = (release\/[\w./-]+) \(werkbank-[\w-]+ ([0-9a-f]{7,40})\)/);
    if (m) out.push({ branch: m[1], sha: m[2] });
  }
  return out.reverse();
}

/** Release N = Reihenfolge des ersten Auftretens im Live-Log; Zweige ohne Live-Eintrag danach, in Namensreihenfolge. */
export function releaseNumbers(entries: LiveEntry[], branches: string[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of entries) if (!n.has(e.branch)) n.set(e.branch, n.size + 1);
  for (const b of [...branches].sort()) if (!n.has(b)) n.set(b, n.size + 1);
  return n;
}

/** Paketnummer → Merge-Betreff-Treffer: „Paket 136“, „Review-Paket 122“. */
export const paketInSubject = (subject: string, nr: number) => new RegExp(`\\bPaket ${nr}(?!\\d)`).test(subject);
/** Branch-Name im Merge-Betreff: „Merge feat/x (Paket …)“, „Merge feat/x in release/…“, „Merge branch 'feat/x'“. */
export const branchOfMerge = (subject: string) => subject.match(/^Merge (?:branch ')?([\w./-]+?)'?(?=[\s:]|$)/)?.[1] ?? null;

export type StandKind = 'live' | 'teilweise' | 'release' | 'lokal' | 'laeuft';
export interface Stand { kind: StandKind; release?: number; branch?: string; text: string }

export interface StandFacts {
  running?: boolean;
  head?: 'live' | 'release' | 'lokal' | 'fremd' | null;   // Beleg aus dem Arbeitsordner (null = kein Ordner/kein Git)
  headRelease?: { n: number; branch: string } | null;     // live: erster Live-Eintrag mit HEAD · release: erster Zweig mit HEAD
  dirty?: boolean;                                         // Ordner hat nicht committete Änderungen
  merge?: { live: boolean; n: number; branch: string } | null;   // Rückfall: Merge des Pakets/Branches in einen Release-Zweig
}

/** Stand aus Git-Fakten (rein). Ohne belastbaren Beleg → null (kein Chip statt eines falschen). */
export function standFrom(f: StandFacts): Stand | null {
  if (f.running) return { kind: 'laeuft', text: 'Agent arbeitet' };
  const r = f.headRelease;
  // Review-Fix 1: ist der gefundene Merge noch nicht live, ist der Strang nie live — auch wenn sein HEAD im Live-SHA steckt
  // (frischer Worktree ohne eigene Commits, Paket erst in einem späteren Release gemergt).
  if (f.merge && !f.merge.live) {
    const rel = f.head === 'release' && r ? r : { n: f.merge.n, branch: f.merge.branch };
    return { kind: 'release', release: rel.n, branch: rel.branch, text: `in Release ${rel.n}, noch nicht live${f.head === 'lokal' || f.dirty ? ' — neuere Änderungen in keinem Release' : ''}` };
  }
  if (f.head === 'live' && r && !f.dirty) return { kind: 'live', release: r.n, branch: r.branch, text: `live seit Release ${r.n}` };
  if (f.head === 'live' && r && f.dirty) return { kind: 'teilweise', release: r.n, branch: r.branch, text: `live seit Release ${r.n}, neuere Änderungen noch nicht` };
  if (f.merge?.live && f.head && f.head !== 'fremd') return { kind: 'teilweise', release: f.merge.n, branch: f.merge.branch, text: `live seit Release ${f.merge.n}, neuere Änderungen noch nicht` };
  if (f.merge?.live && !f.head) return { kind: 'live', release: f.merge.n, branch: f.merge.branch, text: `live seit Release ${f.merge.n}` };
  if (f.head === 'release' && r) return { kind: 'release', release: r.n, branch: r.branch, text: `in Release ${r.n}, noch nicht live` };
  if (f.head === 'lokal') return { kind: 'lokal', text: 'fertig, in keinem Release' };
  return null;
}
