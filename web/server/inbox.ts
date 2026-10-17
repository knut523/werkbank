// Eine Inbox für alles, was auf Knut wartet (Plan 213 S2, Council K4/K10/K12, P5): Rückfragen des Hauptchats und der
// Unter-Chats, Entscheidungen im Bericht, „Braucht Knut“ aus dem Stand, Push-Freigaben, Fragen des Vault-Syncs, Ticketpflege
// (gesammelt), eine stehende Schlange. Jede Unterbrechung ist ein Eintrag mit fester Kennung, Quelle, „wartet seit“,
// „blockiert n“, Empfehlung und erlaubten Antworten (Ja · Nein · Anders … · Später). Sortiert nach „blockiert am meisten“,
// dann „wartet am längsten“ (Paperclip Decisions, Linear Triage). Beantwortet wird immer an der Quelle — was hier oder im
// Chat beantwortet ist, verschwindet überall (209 K8). Stichtag: Einträge älter als 14 Tage erscheinen als ein Sammel-Eintrag
// „Altbestand“. Freitext im Hauptchat wird nie automatisch zugeordnet; die Chat-Knöpfe tragen die Kennung.

export type InboxArt = 'rueckfrage' | 'entscheidung' | 'braucht' | 'push' | 'vault' | 'pflege' | 'schlange' | 'altbestand';
export type Antwort = 'ja' | 'nein' | 'anders' | 'spaeter';

export interface InboxEintrag {
  id: string;
  art: InboxArt;
  frage: string;
  empfehlung: string | null;
  /** Herkunft für die Zeile „Unter-Chat „…“ · Bericht 209 · Hauptchat · Vault-Sync · Pflege“. */
  quelle: { text: string; strand: string | null; url: string | null; paket?: string | null };
  wartetSeit: string | null;
  /** Wie viele Unter-Chats auf diese Antwort warten. */
  blockiert: number;
  antworten: Antwort[];
  /** Zusatz je Art (Optionen einer Rückfrage, Kennungen D1…, Kopf-SHA für den Push, Anzahl bei Sammel-Einträgen …). */
  daten: Record<string, unknown>;
}

export const ALTBESTAND_TAGE = 14;
export const ART_TEXT: Record<InboxArt, string> = { rueckfrage: 'Rückfrage', entscheidung: 'Entscheidung', braucht: 'Frage im Stand', push: 'Push', vault: 'Vault-Sync', pflege: 'Pflege', schlange: 'Schlange', altbestand: 'Altbestand' };

/** Kennung bleibt gleich, solange sich die Frage nicht ändert (Chat-Knöpfe und „Später“ hängen daran). */
export const kennung = {
  rueckfrage: (qid: string) => (qid.startsWith('q-') ? qid : `q-${qid}`),   // Rückfragen heißen schon „q-…“
  entscheidung: (strand: string, hash: string | null) => `d-${strand}-${String(hash ?? '').slice(0, 8)}`,
  braucht: (strand: string, text: string) => `b-${strand}-${kurzHash(text)}`,
  push: (strand: string, head: string) => `p-${strand}-${String(head).slice(0, 12)}`,
  vault: (id: string) => `v-${kurzHash(id)}`,
};
export const KENNUNG_RE = /^(q|d|b|p|v|pflege|schlange|altbestand)(-[A-Za-z0-9-]{1,80})?$/;

export function kurzHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Bis wann „Später“ gilt: morgen 07:00 Wiener Zeit (Council 1, UX-Befund 3). */
export function spaeterBis(now = Date.now()): Date {
  const morgen = new Date(now + 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  // 07:00 Wien = 05:00 (Sommerzeit) oder 06:00 UTC.
  for (const h of ['05', '06']) {
    const d = new Date(`${morgen}T${h}:00:00Z`);
    if (d.toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }).startsWith('07')) return d;
  }
  return new Date(`${morgen}T06:00:00Z`);
}

export interface InboxQuellen {
  /** Karten der Übersicht (uebersicht.ts → karte), nur Admin. */
  karten: Array<{ id: string; titel: string; strangTitel?: string; running: boolean; entscheidungen: { id: string; frage: string; empfehlung: string | null }[]; berichtHash: string | null; rueckfragen: any[];
    braucht: string | null; kannFreigeben: boolean; freigabe: any; github: { repo: string; zweig: string; commit: string }[]; statusAt: any; chat: string | null; paket: string | null; seen?: string }>;
  /** Offene Rückfragen ohne Karte (Hauptchat, Drift, G0 …). */
  lose: Array<{ id: string; title: string; recommendation?: string | null; options?: { label: string }[]; createdAt: any; strand?: { id: string; title?: string; url?: string } | null; quelle?: string | null; key?: string | null; context?: string | null }>;
  /** Fragen des Vault-Syncs (mineFor → questions/pendingApprovals). */
  vault: Array<{ id: string; text: string; at?: any }>;
  /** Offene Ticketpflege (Hygiene) — nur die Zahl, als ein Sammel-Eintrag. */
  pflege: number;
  /** Unter-Chats in der Schlange (Platz, seit). */
  schlange: Array<{ id: string; titel: string; since: number }>;
  /** Berichte mit unlesbarem Kopf (K10: ein Sammel-Eintrag). */
  kopfFehler: Array<{ id: string; titel: string }>;
}

const iso = (v: unknown): string | null => { const t = v ? new Date(v as any).getTime() : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** Einträge aus allen Quellen (rein). `spaeter`: Kennung → bis; `now` für Altbestand und Schlange. */
export function baueInbox(q: InboxQuellen, o: { spaeter?: Map<string, number>; now?: number; schlangeAlarmMs?: number } = {}): { eintraege: InboxEintrag[]; zurueckgestellt: number } {
  const now = o.now ?? Date.now();
  const out: InboxEintrag[] = [];
  const kartenIds = new Set(q.karten.map((k) => k.id));
  for (const k of q.karten) {
    const quelle = { text: `Unter-Chat „${k.strangTitel || k.titel}“`, strand: k.id, url: k.chat, paket: k.paket };
    const seit = iso(k.statusAt);
    if (k.entscheidungen.length) {
      const ids = k.entscheidungen.map((e) => e.id);
      out.push({ id: kennung.entscheidung(k.id, k.berichtHash), art: 'entscheidung', frage: k.entscheidungen.length === 1 ? `${ids[0]}: ${k.entscheidungen[0].frage}` : `${k.titel} — ${ids.length} Entscheidungen im Bericht (${ids.join(', ')})`,
        empfehlung: k.entscheidungen.length === 1 ? k.entscheidungen[0].empfehlung : (k.entscheidungen.every((e) => e.empfehlung) ? 'alle Empfehlungen übernehmen' : null),
        quelle: { ...quelle, text: k.paket ? `Bericht ${k.paket.split('-')[0]}` : quelle.text }, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'],
        daten: { berichtHash: k.berichtHash, entscheidungen: k.entscheidungen, strand: k.id } });
    }
    for (const r of k.rueckfragen ?? []) out.push(rueckfrageEintrag(r, quelle));
    if (k.braucht && !k.entscheidungen.length && !(k.rueckfragen ?? []).length && !k.running) {
      out.push({ id: kennung.braucht(k.id, k.braucht), art: 'braucht', frage: k.braucht, empfehlung: null, quelle, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { strand: k.id, seen: k.seen ?? null } });
    }
    if (k.kannFreigeben && !k.entscheidungen.length && (k.github?.length ?? 0) > 0) {
      const g = k.github[0];
      out.push({ id: kennung.push(k.id, g.commit), art: 'push', frage: `Push freigeben: ${k.titel}`, empfehlung: null,
        quelle: { ...quelle, text: `${g.repo.split('/').pop()}${k.github.length > 1 ? ` + ${k.github.length - 1}` : ''}` }, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'spaeter'],
        daten: { strand: k.id, repo: g.repo, zweig: g.zweig, commit: g.commit } });
    }
  }
  for (const r of q.lose) {
    if (r.strand && kartenIds.has(String(r.strand.id))) continue;   // steht schon bei seiner Karte
    out.push(rueckfrageEintrag(r, r.strand ? { text: `Unter-Chat „${r.strand.title ?? ''}“`, strand: String(r.strand.id), url: r.strand.url ?? null } : { text: r.quelle === 'drift' ? 'Abgleich Vault ↔ Jira' : 'Hauptchat', strand: null, url: null }));
  }
  for (const v of q.vault) {
    out.push({ id: kennung.vault(v.id), art: 'vault', frage: v.text, empfehlung: null, quelle: { text: 'Vault-Sync', strand: null, url: null }, wartetSeit: iso(v.at), blockiert: 0, antworten: ['ja', 'nein', 'spaeter'], daten: { vaultId: v.id } });
  }
  if (q.pflege > 0) out.push({ id: 'pflege', art: 'pflege', frage: `${q.pflege} ${q.pflege === 1 ? 'Ticket braucht' : 'Tickets brauchen'} Pflege`, empfehlung: null, quelle: { text: 'Pflege', strand: null, url: '#/board' }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { n: q.pflege } });
  if (q.kopfFehler.length) out.push({ id: 'pflege-kopf', art: 'pflege', frage: `${q.kopfFehler.length} ${q.kopfFehler.length === 1 ? 'Bericht hat' : 'Berichte haben'} einen unlesbaren Kopf`, empfehlung: 'im Unter-Chat reparieren lassen', quelle: { text: 'Pflege', strand: null, url: null }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { berichte: q.kopfFehler } });
  // Schlange steht (K3): wartet der Erste länger als 30 min, genau ein Eintrag.
  const alarm = o.schlangeAlarmMs ?? 30 * 60_000;
  const lang = q.schlange.filter((s) => now - s.since > alarm);
  if (lang.length) {
    const aelteste = Math.min(...lang.map((s) => s.since));
    out.push({ id: 'schlange', art: 'schlange', frage: `Die Schlange steht: ${lang.length} Unter-Chat${lang.length > 1 ? 's warten' : ' wartet'} seit ${Math.round((now - aelteste) / 60_000)} min auf einen freien Platz`,
      empfehlung: 'einen laufenden Unter-Chat anhalten oder abwarten', quelle: { text: 'Brücke', strand: null, url: null }, wartetSeit: new Date(aelteste).toISOString(), blockiert: lang.length, antworten: ['spaeter'], daten: { unterchats: lang } });
  }
  // Später zurückgestellt
  const spaeter = o.spaeter ?? new Map<string, number>();
  const sichtbar = out.filter((e) => !((spaeter.get(e.id) ?? 0) > now));
  // Altbestand (Stichtag): älter als 14 Tage → ein Sammel-Eintrag (Push und Schlange nie).
  const grenze = now - ALTBESTAND_TAGE * 86400_000;
  const alt = sichtbar.filter((e) => e.art !== 'push' && e.art !== 'schlange' && e.wartetSeit && new Date(e.wartetSeit).getTime() < grenze);
  const frisch = sichtbar.filter((e) => !alt.includes(e));
  if (alt.length) frisch.push({ id: 'altbestand', art: 'altbestand', frage: `Altbestand: ${alt.length} ${alt.length === 1 ? 'Frage ist' : 'Fragen sind'} älter als ${ALTBESTAND_TAGE} Tage — durchsehen oder alle verwerfen`, empfehlung: 'alle verwerfen',
    quelle: { text: 'Inbox', strand: null, url: null }, wartetSeit: alt.map((e) => e.wartetSeit!).sort()[0], blockiert: 0, antworten: ['nein', 'spaeter'], daten: { eintraege: alt } });
  frisch.sort((a, b) => b.blockiert - a.blockiert || (a.wartetSeit ?? '9').localeCompare(b.wartetSeit ?? '9'));
  return { eintraege: frisch, zurueckgestellt: out.length - sichtbar.length };
}

function rueckfrageEintrag(r: InboxQuellen['lose'][number], quelle: InboxEintrag['quelle']): InboxEintrag {
  const opts = r.options ?? [];
  const g0 = /#G0$/.test(String(r.key ?? ''));
  return { id: kennung.rueckfrage(r.id), art: 'rueckfrage', frage: r.title, empfehlung: r.recommendation ?? null, quelle, wartetSeit: iso(r.createdAt), blockiert: quelle.strand || g0 ? 1 : 0,
    antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { qid: r.id, optionen: opts.map((o) => o.label), kontext: r.context ?? null } };
}

/** Zähler für Leiste und Heute-Kopf (K11): nur sichtbare, nicht zurückgestellte Einträge; der Altbestand zählt als einer. */
export const inboxZahl = (eintraege: InboxEintrag[]) => eintraege.length;
