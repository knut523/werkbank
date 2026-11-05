// Entscheidungsseite (Knut 19.10., Muster ~/work/knut/entscheidungen-site: „das brauchen wir im Workspace von der Idee her“).
// Eine Karte je Frage, selbsterklärend ohne andere Datei: Worum es geht, Optionen, Empfehlung; gruppiert nach Thema. Aus der einen
// Inbox abgeleitet (eine Quelle) — Bericht-Entscheidungen D1… werden zu einzelnen Karten, damit jede für sich beantwortet wird.
// Was keine Frage ist (Pflege, Schlange, Altbestand, Meeting-Vorschläge), bleibt eine Inbox-Zeile unter „Sonstiges“. Rein.
import type { InboxEintrag } from './inbox.ts';
import { klartext, frageForm, empfehlungAus, type Form } from './klartext.ts';
import { klasseVon, type Klasse } from './stufe.ts';

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
  /** Knöpfe zwischen „Ja (wie empfohlen)“ und „Nein“: ein Klick = „Anders: <Alternative>“ (Bericht-Kopf `alternativen:`, bei
   *  Rückfragen die Optionen außer der empfohlenen). */
  alternativen: string[];
  empfehlung: string | null;
  /** R32: welche Antwortknöpfe passen — Ja/Nein, Wahl (Optionen als Knöpfe) oder Freitext. */
  form: Form;
  /** R32 (Befund 4): „wichtig“ nur zeigen, wenn etwas dranhängt (ein Unter-Chat wartet) — samt Grund; die Einstufung selbst (Sortierung, nie automatisch annehmen) bleibt. */
  zeigWichtig?: boolean;
  wichtigGrund?: string | null;
  stufe: 'wichtig' | 'normal';
  stufeGrund: string | null;
  autoAb: string | null;
  quelle: { text: string; url: string | null };
  wartetSeit: string | null;
  antworten: Antwort[];
  /** Wie viele Unter-Chats auf diese Antwort warten. */
  blockiert: number;
  /** Plan §23 T1 (Knut 05.11.): knut → „Für dich“; gewichtig → Hauptchat nach Council; technisch → sofort nach Empfehlung. */
  triage?: { klasse: Klasse; grund: string };
  /** R30b S5: Klasse einer „Braucht Knut“-Zeile (nur mit WERKBANK_BRAUCHT_DICH), sonst null bzw. fehlt. */
  klasse?: 'aktion' | 'entscheidung' | null;
  /** (a) aus harter Regel (Nachbesserung 02.11.): warum nur Knut (zugang, datenbank, geld, recht, extern, entscheidung). */
  nurKnut?: string | null;
  /** (a) Datenbank-Bitte: die SQL zum Kopieren (aus Stand, PR-Text oder Bericht). */
  sql?: string | null;
  /** (b): Zustellung beim Hauptchat — gemeldet · zugestellt · kein-hauptchat. */
  hauptchat?: string | null;
  /** Kennung an der Quelle für Arten mit eigenem Weg: Vault-Sync-Frage (vaultId), Push (Strang). */
  ref: string | null;
}


/** R32 (Befund 3): Antwortknöpfe passend zur Frage — Ja/Nein nur bei Ja/Nein-Fragen; Wahlfragen zeigen ihre Optionen, offene Fragen ein Feld.
 *  `ja` heißt „Empfehlung übernehmen“ und gibt es nur, wenn es eine Empfehlung gibt (außer bei Ja/Nein-Fragen). */
function antwortenFuer(form: Form, basis: Antwort[], empfehlung: string | null): Antwort[] {
  if (form === 'janein') return basis;
  return basis.filter((a) => a !== 'nein' && (a !== 'ja' || !!empfehlung));
}
/** Bei Wahlfragen: alle Optionen außer der empfohlenen als Knöpfe (bis 6), bei Freitext keine. */
const wahlKnoepfe = (form: Form, optionen: string[], empfehlung: string | null) =>
  form === 'wahl' ? optionen.filter((o) => o !== empfehlung && !(empfehlung && empfehlung.startsWith(o)) && !/^(ja|nein)[.!]?$/i.test(o)).slice(0, 6) : [];

const FRAGE_ARTEN = new Set(['rueckfrage', 'entscheidung', 'braucht', 'push', 'vault', 'vaultfrage']);
const ein = (t: unknown) => klartext(t);
/** Erster Satz als Titel, der ganze Text unter „Worum es geht“ (nur, wenn er mehr sagt). */
function titelUndWorum(text: string): { titel: string; rest: string } {
  const t = ein(text);
  const m = /^(.{12,140}?[.?!])\s+(.{20,})$/.exec(t);
  // R32 (Befund 3): die Frage wird nicht mehr bei 160 Zeichen abgeschnitten — erst ab 300 Zeichen, dann am Wortende und mit dem ganzen Text unter „Worum“.
  if (m) return { titel: m[1], rest: m[2] };
  if (t.length <= 300) return { titel: t, rest: '' };
  const cut = t.slice(0, 300).replace(/\s+\S*$/, '');
  return { titel: `${cut} …`, rest: t };
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
        const optionen: string[] = Array.isArray(x.optionenListe) ? x.optionenListe.map(ein).filter(Boolean) : [];
        const empfehlung = x.empfehlung ? ein(x.empfehlung) : null;
        const form = frageForm(`${tw.titel}${tw.rest ? ' ' + tw.rest : ''}`, optionen);
        const alt = Array.isArray(x.alternativen) ? [...new Set<string>(x.alternativen.map(ein).filter(Boolean))].filter((o) => o !== empfehlung).slice(0, 3) : [];
        fragen.push({ ...basis, id: `${e.id}~${x.id}`, teil: String(x.id), kennung: String(x.id), titel: tw.titel, worum, form,
          optionen, empfehlung, alternativen: form === 'wahl' ? [...new Set([...wahlKnoepfe(form, optionen, empfehlung), ...alt])].slice(0, 6) : alt,
          stufe: x.stufe === 'wichtig' ? 'wichtig' : 'normal', stufeGrund: x.stufeGrund ?? null, autoAb: x.auto ? e.autoAb ?? null : null,
          antworten: antwortenFuer(form, ['ja', 'nein', 'anders', 'spaeter'], empfehlung) });
      }
      continue;
    }
    const tw = titelUndWorum(e.frage);
    const kontext = ein(e.daten.kontext);
    // R30b S5: klassifizierte „Braucht Knut“-Zeilen (nur mit WERKBANK_BRAUCHT_DICH gesetzt) sagen, was das für Knut heißt.
    const klasse = e.art === 'braucht' && (e.daten.klasse === 'aktion' || e.daten.klasse === 'entscheidung') ? e.daten.klasse as 'aktion' | 'entscheidung' : null;
    const beim = e.daten.hauptchat === 'zugestellt' ? 'Der Hauptchat hat die Aufgabe bekommen.' : e.daten.hauptchat === 'gemeldet' ? 'Die Aufgabe liegt in der Warteschlange des Hauptchats.' : e.daten.hauptchat === 'fehlgeschlagen' ? 'Die Meldung an den Hauptchat ist fehlgeschlagen — frag ihn direkt oder antworte mit „Anders“.' : 'Gerade ist kein Hauptchat aktiv — der nächste bekommt die Aufgabe.';
    const worum = klasse === 'aktion' ? `${e.quelle.text} meldet: „${ein(e.daten.zeile)}“. Das kann der Hauptchat selbst ausführen (${ein(e.daten.aktion)}) — nichts für dich; er fragt nur, wenn eine Freigabe nötig ist. ${beim}`
      // Harte Regel (Nachbesserung 02.11.): „Warum du“ und die Bitte des Unter-Chats zuerst — nicht hinter „mehr“.
      : klasse === 'entscheidung' && e.daten.nurKnut && e.daten.nurKnut !== 'entscheidung' && tw.rest ? tw.rest
      : klasse === 'entscheidung' ? `${e.quelle.text} braucht eine Entscheidung von dir.${tw.rest ? ` ${tw.rest}` : ''}`
      : e.art === 'braucht' ? `${e.quelle.text} wartet auf dich (Abschnitt „Braucht Knut“ im Stand).${tw.rest ? ` ${tw.rest}` : ''}`
      : e.art === 'push' ? `Der Stand von ${e.quelle.text} ist geprüft und kann auf GitHub (Zweig ${ein(e.daten.zweig)}, Stand ${String(e.daten.commit ?? '').slice(0, 7)}). Ja öffnet die Freigabe mit dem gesehenen Stand.`
      : e.art === 'vaultfrage' ? `${e.daten.kurz ? `${ein(e.daten.kurz)} ` : ''}Offene Frage in ${e.quelle.text}${e.daten.section ? `, Abschnitt „${ein(e.daten.section)}“` : ''} — wichtig, weil: ${ein(e.daten.grund)}.${e.daten.beleg ? ` Stand laut Sichtung: ${ein(e.daten.beleg)}.` : ''} Deine Antwort kommt als Zeile „- Knut:“ in die Notiz.${tw.rest ? ` ${tw.rest}` : ''}`
      : e.art === 'vault' ? `Der Vault-Sync hat beim Abgleich etwas gefunden, das er nicht selbst entscheiden darf.${tw.rest ? ` ${tw.rest}` : ''}`
      : [kontext, tw.rest].filter(Boolean).join(' ') || `Rückfrage aus ${e.quelle.text}.`;
    const optionen = ((e.daten.optionen as string[]) ?? []).map(ein).filter(Boolean);
    // Rückfragen: die nicht empfohlenen Optionen als Alternativ-Knöpfe (die empfohlene ist „Ja“, ein bloßes Ja/Nein hat schon seinen Knopf).
    const rec = optionen.find((o) => o === ein(e.empfehlung)) ?? optionen.find((o) => ein(e.empfehlung).startsWith(o));
    const alternativen = e.art === 'rueckfrage' && e.antworten.includes('anders') ? optionen.filter((o) => o !== rec && !/^(ja|nein)[.!]?$/i.test(o)).slice(0, 3) : [];
    // R32: Form nur für Fragen mit Freitext-Bezug (Rückfrage, Braucht-Zeile, Vault-Frage); Push, Vault-Sync und Aufgaben behalten ihre Knöpfe.
    const empf = e.empfehlung ? ein(e.empfehlung) : (e.art === 'vaultfrage' ? empfehlungAus(ein(e.frage)) : null);
    const form: Form = klasse === 'aktion' || e.art === 'push' || e.art === 'vault' ? 'janein' : frageForm(ein(e.frage), optionen);
    fragen.push({ ...basis, id: e.id, teil: null, kennung: null, titel: tw.titel, worum, form, optionen,
      alternativen: form === 'wahl' ? wahlKnoepfe(form, optionen, empf) : alternativen,
      // (b) nie „wichtig“ — es ist keine Frage an Knut (Nachbesserung 02.11.).
      empfehlung: empf, stufe: e.stufe === 'wichtig' && klasse !== 'aktion' ? 'wichtig' : 'normal', stufeGrund: klasse === 'aktion' ? 'Aufgabe des Hauptchats' : e.stufeGrund ?? null,
      ...(klasse === 'aktion' ? { autoAb: null, hauptchat: String(e.daten.hauptchat ?? 'kein-hauptchat') } : {}),
      ...(klasse === 'entscheidung' && e.daten.nurKnut ? { nurKnut: String(e.daten.nurKnut), sql: e.daten.sql ? String(e.daten.sql) : null } : {}),
      // (b): nur „Anders“ — falls es doch etwas für Knut ist, geht die Antwort an den Unter-Chat.
      klasse, antworten: klasse === 'aktion' ? ['anders'] : antwortenFuer(form, (e.antworten as Antwort[]).filter((a) => a !== 'anders' || e.art !== 'vault'), empf) });
  }
  for (const f of fragen) {
    const haengt = f.stufe === 'wichtig' && f.klasse !== 'aktion' && f.blockiert > 0;
    f.zeigWichtig = haengt;
    f.wichtigGrund = haengt ? `${f.blockiert === 1 ? 'ein Unter-Chat wartet' : `${f.blockiert} Unter-Chats warten`} auf die Antwort${f.wartetSeit ? ` (seit ${new Date(f.wartetSeit).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Vienna' })})` : ''}` : null;
  }
  // Plan §23 T1: Klasse je Frage (Aufgaben des Hauptchats sind nie Knut-Fragen; „vom Strang als Knut muss markiert“ stuft hoch).
  for (const f of fragen) {
    const markiert = f.stufe === 'wichtig' && /markiert/.test(f.stufeGrund ?? '') ? 'wichtig' : null;
    f.triage = f.klasse === 'aktion' ? { klasse: 'technisch', grund: 'Aufgabe des Hauptchats' }
      : klasseVon({ text: [f.titel, f.worum, ...f.optionen].join(' '), markiert, art: f.art, empfehlung: f.empfehlung });
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

/** R32 (Nachtrag B): „Fang hier an“ — höchstens 5 Fragen, sortiert nach Wirkung: hält einen Unter-Chat an (am meisten) · Frist (gilt bald als
 *  angenommen) · betrifft Kund:innen/Partner · Push/Geld/Recht · wartet lange. Hauptchat-Aufgaben nie. Rein, deterministisch (Gleichstand: ältere zuerst). */
export function fangHierAn(fragen: Frage[], now = Date.now()): { id: string; grund: string }[] {
  const KUNDE = /(?<![\p{L}])(kund|partner|extern|öffentlich|newsletter)/iu;
  const bewertet = fragen.filter((f) => f.klasse !== 'aktion').map((f, i) => {
    const gruende: [number, string][] = [];
    if (f.blockiert > 0) gruende.push([100 + 10 * Math.min(f.blockiert, 3), f.blockiert === 1 ? 'hält einen Unter-Chat an' : `hält ${f.blockiert} Unter-Chats an`]);
    if (f.autoAb) { const h = (new Date(f.autoAb).getTime() - now) / 3600_000; if (h <= 24) gruende.push([70, h <= 0 ? 'Frist um: gilt gleich als angenommen' : `Frist: gilt in ${Math.max(1, Math.round(h))} h als angenommen`]); }
    if (f.art === 'push') gruende.push([50, 'Freigabe wartet']);
    if (/Außenwirkung/.test(f.stufeGrund ?? '') || KUNDE.test(`${f.titel} ${f.worum}`)) gruende.push([40, 'betrifft Kund:innen oder Partner']);
    if (f.stufe === 'wichtig') gruende.push([20, `wichtig: ${f.stufeGrund ?? 'Regel'}`]);
    const tage = f.wartetSeit ? Math.max(0, (now - new Date(f.wartetSeit).getTime()) / 86400_000) : 0;
    const punkte = gruende.reduce((m, g) => m + g[0], 0) + Math.min(tage, 14);
    gruende.sort((a, b) => b[0] - a[0]);
    return { f, i, punkte, grund: gruende[0]?.[1] ?? (tage >= 1 ? `wartet seit ${Math.round(tage)} Tagen` : 'wartet auf dich') };
  });
  bewertet.sort((a, b) => b.punkte - a.punkte || (a.f.wartetSeit ?? '9').localeCompare(b.f.wartetSeit ?? '9') || a.i - b.i);
  return bewertet.slice(0, 5).map((x) => ({ id: x.f.id, grund: x.grund }));
}

/** R32 (Befund 1): EINE Zahl für „braucht dich“, aus einer Funktion — und ihre Zusammensetzung, damit jede Seite dieselbe Zahl und denselben
 *  Untertitel zeigt. gesamt = fang + heute + offen + sonstiges = `inboxZahl`; Aufgaben des Hauptchats (klasse aktion) zählen nicht (eigener Hinweis). */
export function brauchtSumme(eintraege: InboxEintrag[], now = Date.now()) {
  const { fragen, sonstiges } = fragenAus(eintraege);
  const echt = fragen.filter((f) => f.klasse !== 'aktion');
  const fang = new Set(fangHierAn(echt, now).map((x) => x.id));
  const rest = echt.filter((f) => !fang.has(f.id));
  const heute = rest.filter((f) => heuteFaellig(f, now)).length;
  const offen = rest.length - heute;
  const gesamt = echt.length + sonstiges.length;
  const teile = [fang.size ? `${fang.size} Fang hier an` : '', heute ? `${heute} heute fällig` : '', offen ? `${offen} ${offen === 1 ? 'Frage' : 'Fragen'}` : '', sonstiges.length ? `${sonstiges.length} Sonstiges` : ''].filter(Boolean);
  return { gesamt, fang: fang.size, heute, offen, sonstiges: sonstiges.length, beimHauptchat: fragen.length - echt.length, text: `${gesamt} offen${teile.length ? ` = ${teile.join(' + ')}` : ''}` };
}

/** R32 (Nachtrag A): Wohin geht die Antwort? Ein Satz für die Bestätigung („an Strang „X“ geschickt“). */
export function zielText(e: Pick<InboxEintrag, 'art' | 'quelle' | 'daten'>): string {
  const strang = ein(e.daten?.strangTitel) || (e.quelle?.strand ? ein(e.quelle.text) : '');
  if (e.art === 'rueckfrage') return e.quelle?.strand ? `den Unter-Chat ${ein(e.quelle.text)}` : 'den Hauptchat';
  if (e.art === 'braucht' || e.art === 'entscheidung' || e.art === 'push') return strang ? `den Unter-Chat „${strang.replace(/^Unter-Chat „(.*)“$/, '$1')}“` : 'den Unter-Chat';
  if (e.art === 'vaultfrage') return `die Notiz ${ein(e.quelle?.text)}`;
  if (e.art === 'vault') return 'den Vault-Sync';
  return ein(e.quelle?.text) || 'die Quelle';
}

/** „Anders: <Option> — Notiz“ (Knopf einer Wahlfrage) → die Option als echte Auswahl, damit der Fragende sie als Option bekommt statt als Text. */
export function optionAusAnders(optionen: string[], text: string): { option: string; notiz: string } | null {
  const m = /^Anders:\s*(.+?)(?:\s+—\s+([\s\S]*))?$/.exec(text.trim());
  const opt = m ? optionen.find((o) => o === m[1].trim()) : null;
  return opt ? { option: opt, notiz: (m![2] ?? '').trim() } : null;
}
