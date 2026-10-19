// Entscheidungsseite (Knut 19.10., Muster ~/work/knut/entscheidungen-site: „das brauchen wir im Workspace von der Idee her“).
// Eine Karte je Frage, selbsterklärend ohne andere Datei: Worum es geht, Optionen, Empfehlung; gruppiert nach Thema. Aus der einen
// Inbox abgeleitet (eine Quelle) — Bericht-Entscheidungen D1… werden zu einzelnen Karten, damit jede für sich beantwortet wird.
// Was keine Frage ist (Pflege, Schlange, Altbestand, Meeting-Vorschläge), bleibt eine Inbox-Zeile unter „Sonstiges“. Rein.
import type { InboxEintrag } from './inbox.ts';

export type Antwort = 'ja' | 'nein' | 'anders' | 'spaeter';
export interface Frage {
  /** Eindeutig auf der Seite: Inbox-Kennung, bei Bericht-Entscheidungen „<Kennung>~<D-Nr>“. */
  id: string;
  eintrag: string;
  teil: string | null;
  art: InboxEintrag['art'];
  gruppe: string;
  kennung: string | null;
  titel: string;
  worum: string;
  optionen: string[];
  empfehlung: string | null;
  stufe: 'wichtig' | 'normal';
  stufeGrund: string | null;
  autoAb: string | null;
  quelle: { text: string; url: string | null };
  wartetSeit: string | null;
  antworten: Antwort[];
  /** Wie viele Unter-Chats auf diese Antwort warten. */
  blockiert: number;
  /** Kennung an der Quelle für Arten mit eigenem Weg: Vault-Sync-Frage (vaultId), Push (Strang). */
  ref: string | null;
}

const FRAGE_ARTEN = new Set(['rueckfrage', 'entscheidung', 'braucht', 'push', 'vault', 'vaultfrage']);
const ein = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** Erster Satz als Titel, der ganze Text unter „Worum es geht“ (nur, wenn er mehr sagt). */
function titelUndWorum(text: string): { titel: string; rest: string } {
  const t = ein(text);
  const m = /^(.{12,140}?[.?!])\s+(.{20,})$/.exec(t);
  return m ? { titel: m[1], rest: m[2] } : { titel: t.length > 160 ? `${t.slice(0, 157)}…` : t, rest: t.length > 160 ? t : '' };
}

function gruppeVon(e: InboxEintrag): string {
  if (e.thema) return e.thema;
  if (e.art === 'vault') return 'Vault-Sync';
  if (e.art === 'push') return 'Push-Freigaben';
  if (e.art === 'vaultfrage') return 'Vault';
  return e.quelle.strand ? 'Unter-Chats' : 'Hauptchat';
}

/** Fragen-Karten und „Sonstiges“ aus den Inbox-Einträgen; wichtige zuerst, Gruppen in der Reihenfolge ihres ersten Eintrags. */
export function fragenAus(eintraege: InboxEintrag[]): { fragen: Frage[]; sonstiges: InboxEintrag[] } {
  const fragen: Frage[] = [], sonstiges: InboxEintrag[] = [];
  for (const e of eintraege) {
    if (!FRAGE_ARTEN.has(e.art)) { sonstiges.push(e); continue; }
    const ref = e.art === 'vault' ? String(e.daten.vaultId ?? '') || null : e.art === 'push' ? String(e.daten.strand ?? '') || null : null;
    const basis = { eintrag: e.id, ref, art: e.art, gruppe: gruppeVon(e), quelle: { text: e.quelle.text, url: e.quelle.url }, wartetSeit: e.wartetSeit, autoAb: e.autoAb ?? null, blockiert: e.blockiert };
    if (e.art === 'entscheidung') {
      for (const x of (e.daten.entscheidungen as any[]) ?? []) {
        const tw = titelUndWorum(x.frage);
        const worum = [tw.rest, ein(x.worum)].filter(Boolean).join(' ') || `Aus ${e.quelle.text} (Unter-Chat „${ein(e.daten.strangTitel) || 'ohne Titel'}“) — dort steht der Zusammenhang.`;
        fragen.push({ ...basis, id: `${e.id}~${x.id}`, teil: String(x.id), kennung: String(x.id), titel: tw.titel, worum,
          optionen: Array.isArray(x.optionenListe) ? x.optionenListe.map(ein).filter(Boolean) : [], empfehlung: x.empfehlung ? ein(x.empfehlung) : null,
          stufe: x.stufe === 'wichtig' ? 'wichtig' : 'normal', stufeGrund: x.stufeGrund ?? null, autoAb: x.auto ? e.autoAb ?? null : null,
          antworten: ['ja', 'nein', 'anders', 'spaeter'] });
      }
      continue;
    }
    const tw = titelUndWorum(e.frage);
    const kontext = ein(e.daten.kontext);
    const worum = e.art === 'braucht' ? `${e.quelle.text} wartet auf dich (Abschnitt „Braucht Knut“ im Stand).${tw.rest ? ` ${tw.rest}` : ''}`
      : e.art === 'push' ? `Der Stand von ${e.quelle.text} ist geprüft und kann auf GitHub (Zweig ${ein(e.daten.zweig)}, Stand ${String(e.daten.commit ?? '').slice(0, 7)}). Ja öffnet die Freigabe mit dem gesehenen Stand.`
      : e.art === 'vaultfrage' ? `Offene Frage in ${e.quelle.text}${e.daten.section ? `, Abschnitt „${ein(e.daten.section)}“` : ''} — wichtig, weil: ${ein(e.daten.grund)}. Deine Antwort kommt als Zeile „- Knut:“ in die Notiz.${tw.rest ? ` ${tw.rest}` : ''}`
      : e.art === 'vault' ? `Der Vault-Sync hat beim Abgleich etwas gefunden, das er nicht selbst entscheiden darf.${tw.rest ? ` ${tw.rest}` : ''}`
      : [kontext, tw.rest].filter(Boolean).join(' ') || `Rückfrage aus ${e.quelle.text}.`;
    fragen.push({ ...basis, id: e.id, teil: null, kennung: null, titel: tw.titel, worum, optionen: ((e.daten.optionen as string[]) ?? []).map(ein).filter(Boolean),
      empfehlung: e.empfehlung ? ein(e.empfehlung) : null, stufe: e.stufe === 'wichtig' ? 'wichtig' : 'normal', stufeGrund: e.stufeGrund ?? null,
      antworten: (e.antworten as Antwort[]).filter((a) => a !== 'anders' || e.art !== 'vault') });
  }
  // Wichtige oben, sonst die Reihenfolge der Inbox (blockiert am meisten, wartet am längsten); Gruppen zusammenhalten.
  const rang = new Map<string, number>();
  fragen.forEach((f, i) => { if (!rang.has(f.gruppe)) rang.set(f.gruppe, i); });
  const wichtig = (f: Frage) => (f.stufe === 'wichtig' ? 0 : 1);
  const gruppeWichtig = new Map<string, number>();
  for (const f of fragen) gruppeWichtig.set(f.gruppe, Math.min(gruppeWichtig.get(f.gruppe) ?? 1, wichtig(f)));
  const ordnung = fragen.map((f, i) => ({ f, i }));
  ordnung.sort((a, b) => gruppeWichtig.get(a.f.gruppe)! - gruppeWichtig.get(b.f.gruppe)! || rang.get(a.f.gruppe)! - rang.get(b.f.gruppe)! || wichtig(a.f) - wichtig(b.f) || a.i - b.i);
  return { fragen: ordnung.map((x) => x.f), sonstiges };
}

/** U3 (Knut 19.10., wie die Entscheidungsseite): „Heute“ = was heute fällig ist — gilt in den nächsten 24 h als angenommen, oder
 *  ist wichtig und hält einen Unter-Chat an. Alles andere steht unter „Offen“. */
export const heuteFaellig = (f: Pick<Frage, 'autoAb' | 'stufe' | 'blockiert'>, now = Date.now()) =>
  (!!f.autoAb && new Date(f.autoAb).getTime() <= now + 24 * 3600_000) || (f.stufe === 'wichtig' && f.blockiert > 0);

/** „Alle offenen wie empfohlen“: nur Fragen mit Empfehlung; Push nie (braucht den Freigabe-Dialog mit dem gesehenen Stand). */
export const empfohlenBeantwortbar = (f: Frage) => !!f.empfehlung && f.art !== 'push' && f.art !== 'vault' && f.antworten.includes('ja');
