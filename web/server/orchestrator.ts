// Orchestrator-Stränge (docs/plan-orchestrator-agents.md, Knut 09.10.2026: „schau, dass du einzelne Agents auf der
// Werkbank startest und koordinierst (du bist der Orchestrator)“).
//
// Die Haupt-Sitzung von Claude Code startet über den internen Kanal (scripts/orch → /internal/orchestrator/*) je
// Arbeitsstrang einen normalen Werkbank-Chat in Knuts Konto: Titel „Orchestrator · …“, Lesezeichen „Orchestrator“,
// Arbeitsordner = der angegebene Worktree. Die Brücke kennt den Strang vorab (die Web-App wählt die
// Unterhaltungs-ID und meldet sie an, bevor der Chat entsteht) und setzt dort strengere Sperren: kein GitHub-/Jira-
// Schreiben, keine Rückfragen. Status kommt aus dem ausdrücklichen Zustand der Brücke (Zug läuft / Ausgang) und —
// nur bei normalem Ende — aus der Status-Marke der letzten Antwort.

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { findBericht, eigenesPaket, reviewDir } from './bericht.ts';
import { kopfPflege } from './berichtstand.ts';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';
import { librechatAccessToken, type User } from './auth.ts';
import { createLibreChat } from './agent.ts';
import { prepareFresh } from './fresh.ts';
import { pruefe, parsePlan, protokolliere, g0Text, g0Optionen, OHNE_PR, vorbauAus, type VorbauErgebnis } from './vorbau.ts';
import { vienna } from './hygiene.ts';
import { cleanThema, themaOf } from './themen.ts';
import { meliousSettings, ausserhalbAbo } from './melious.ts';
import { budgetVon } from './cosbudget.ts';   // zyklisch (cosbudget → orchestrator), nur zur Laufzeit im Rückfrage-Pfad benutzt
import { tiefeOf, istTiefe, tiefeStart, tiefeText, modellAusserhalbAbo, MELIOUS_ZUARBEIT_TEXT, autoMaxFuer, etaMark, etaFuer, mediane, ETA_ZEILE, TIEFEN, GRUENDLICH_TEXT, type Tiefe } from './tiefe.ts';
import { zustandAus, abweichung, nachfordern, statusNeu, NACHFORDER_TEXT, wienDatum, wienUm } from './zustand.ts';
import { regelBestaetigen } from './regelquelle.ts';

export const ORCH_TAG = 'Orchestrator';
export type OrchStatus = 'running' | 'waiting' | 'done' | 'failed' | 'blocked_g0';

const internalHeaders = () => ({ 'content-type': 'application/json', 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' });
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OLAF-Werkbank';

export interface BriefInput { title: string; prompt: string; cwd: string; plan?: string | null; person?: string; stand?: string | null; tiefe?: Tiefe | null; modell?: string | null }

// Berichtsvorlage für jeden Strang (docs/plan-leitstand.md, Teil C, C8; Knut 14.10.2026): fester Kopf, den „Heute“ liest, und
// Pflicht-Visualisierung neben Screenshots. Vollständiges Muster: docs/bericht-vorlage.md, Folien: docs/bericht-folien-vorlage.html.
export const BERICHT_PFLICHT = [
  'Bericht (Pflicht, sobald du etwas gebaut oder geprüft hast): `~/work/knut/review-pakete/NNN-<slug>/bericht.md` (das Paket nennt der Auftrag). Er beginnt mit diesem YAML-Kopf. Der Kopf ist die **Exec Summary** — „Heute“ und die Berichtsanzeige zeigen ihn oben als erstes:',
  '```yaml',
  '---',
  'status: wartet_auf_knut      # bereit_fuer_github | wartet_auf_knut | blockiert',
  'titel: …                     # ein Satz: was jetzt geht (Überschrift der Exec Summary)',
  'worum: …                     # 2–3 Sätze für jemanden, der den Chat nicht kennt: Ausgangslage, Problem, Ziel',
  'anders:                       # was jetzt anders ist, höchstens 4 kurze Punkte',
  '  - …',
  'offen:                        # was Knut tun muss, höchstens 5 kurze Zeilen; leer = nichts',
  '  - …',
  'review:                       # wo Knut reviewt (Coder-Vorschau mit Login-Link, Screenshots, PR-Text)',
  '  - titel: Admin-Vorschau',
  '    url: https://<port>--main--dev--knut.ws.konekto.energy/<seite>',
  '    login: https://<port>--main--dev--knut.ws.konekto.energy/login?next=/<seite>',
  '  - screenshot: screenshots/<name>.png',
  '  - pr_text: pr.md',
  'fragen:                       # nur echte Entscheidungen Knuts, je mit Empfehlung; antwort bleibt leer — jede Frage muss ohne andere Datei verständlich sein (Entscheidungsseite)',
  '  - id: D1',
  '    frage: …                   # die Frage in einem Satz',
  '    worum: …                   # 2–4 Sätze ohne Codes/Kürzel: Ausgangslage und was an der Entscheidung hängt',
  '    optionen:                  # die echten Wahlmöglichkeiten, je eine Zeile',
  '      - …',
  '    empfehlung: …',
  '    alternativen: ["…", "…"]   # optional, 2–3 kurze, konkrete Alternativen zur Empfehlung (je ≤ 120 Zeichen) — Knut wählt sie per Klick statt zu tippen; nur, wenn es echte gibt',
  '    antwort: ""',
  'github:                       # je Repo/PR eine Zeile (wird die PR-Tabelle); commit = ≥ 7-stelliger SHA des Stands, den Knut freigeben soll',
  '  - repo: <org>/<repo>',
  '    zweig: <branch>',
  '    commit: <sha>',
  '    was: …                     # Inhalt in wenigen Worten',
  '    pr: https://github.com/<org>/<repo>/pull/<n>   # nur wenn der PR auf GitHub existiert; sonst weglassen (= lokal)',
  '    pr_text: pr.md',
  '---',
  '```',
  '- `status`: `bereit_fuer_github` nur, wenn Tests grün, Review-Pässe durch und nichts offen; sonst `wartet_auf_knut` (Review/Fragen) oder `blockiert`. Der Kopf muss zum Text passen; ändert sich etwas, Kopf mit ändern (auch `commit`).',
  '- Darunter mindestens ein Mermaid-Diagramm (```` ```mermaid ````) „Wie es jetzt funktioniert“ (Ablauf/Datenfluss des Gebauten, `flowchart LR`); bei mehreren PRs oder Repos zusätzlich „Ausroll-Reihenfolge“. Dazu Screenshots bei allem Sichtbaren.',
  '- PR-Tabelle: nur PRs, die es auf GitHub wirklich gibt, mit `pr:`-Link; nicht gepushte Zweige ohne `pr:` (erscheinen als „lokal, nicht auf GitHub“). Einen Stand (offen/gemergt) schreibst du nicht hin — den holt der Leitstand selbst von GitHub.',
  '- Optional HTML-Folien nach `docs/bericht-folien-vorlage.html` im Werkbank-Repo. Folie 1 ist die Exec Summary (Titel, Status, Worum es geht · Was jetzt anders ist · Was du tun musst, PR-Tabelle); dann Ablauf, Ausrollen, Screenshots, Prüfungen, Entscheidungen.',
  '- Fragen im Kopf tragen dieselbe Kennung wie im Text (`D1`). Antworten Knuts kommen als „Nacharbeit nach Review“; trag sie dann in `antwort:` ein.',
].join('\n');

/**
 * Regeltreue vor „fertig“ (Plan 274, Zusatz B — Knut 20.10.2026: Christophs Reviews fanden vor allem Verstöße gegen AGENTS.md).
 * Pflicht bei Code-/Doku-Arbeit; das Ergebnis steht im Stand-Block (Zeile „Regeln:“), fehlende Werkzeuge werden genannt.
 */
export const REGEL_PFLICHT = [
  'Regeltreue (Pflicht vor „Status: fertig“ bei Code- oder Doku-Arbeit; Ergebnis in die Zeile „Regeln:“ des Stand-Blocks):',
  '1. `AGENTS.md` des Repos lesen und dazu `olaf-docs/AGENTS.md` (lokaler Klon, sonst die Kopie `~/work/knut/tools/pre-push-gate/quellen/AGENTS-olaf-docs.md`).',
  '2. Den Skill `olaf-feedback-check` abarbeiten — je Punkt ein Beleg (Datei:Zeile, Befehl mit Ausgabe oder „nicht betroffen, weil …“).',
  '3. Den Checklisten-Teil des Pre-Push-Gates gegen den eigenen Diff laufen lassen: `~/work/knut/tools/pre-push-gate/pre-push-gate.sh --checkliste <repo> HEAD <zweig>` — Befunde beheben oder begründen.',
  'Fehlt eine Datei, der Skill oder der Modus `--checkliste`, schreib das so in die Zeile „Regeln:“ — nicht still überspringen. Reine Recherche ohne Änderung: „Regeln: nicht betroffen (keine Änderung)“.',
].join('\n');

/** Erster Text des Strangs. Erste Zeile = Titel; der Auftrag steht am Ende. */
export function orchBrief(b: BriefInput): string {
  const first = (b.person || 'Knut').split(/\s+/)[0];
  return [
    `Orchestrator · ${b.title}`,
    ...(b.stand ? [b.stand] : []),
    `Du bist ein Agent im OLAF Workspace für einen Arbeitsstrang (Unter-Chat). Die Haupt-Sitzung (Orchestrator) hat dich gestartet und koordiniert mehrere Stränge; ${first} liest im Chat mit und kann jederzeit selbst schreiben.`,
    [
      'Regeln:',
      `- Arbeitsordner: \`${b.cwd}\` (dein aktuelles Verzeichnis). Arbeite dort; andere Repos und den Vault nur lesen, außer der Auftrag sagt ausdrücklich etwas anderes.`,
      b.plan ? `- Plandatei: \`${b.plan}\` — lies sie zuerst vollständig und arbeite danach (Definition of Done wörtlich nehmen).` : '- Gibt es keine Plandatei und ist der Auftrag nicht trivial: erst kurz planen (plan-to-pr), dann umsetzen.',
      '- Lokale Commits im Arbeitsordner sind erlaubt, wenn der Auftrag sie verlangt. **Nie pushen, keine Pull Requests, nie mergen, nie Jira oder Confluence schreiben, keine Tickets anlegen** — das ist hier technisch gesperrt; versuch nicht, es zu umgehen.',
      '- Es gibt keine Rückfragen im Chat: was eine Freigabe bräuchte, wird abgelehnt. Mach ohne diesen Schritt weiter, so weit es geht, und schreib es unter „Braucht Knut“ auf.',
      '- Offene inhaltliche Entscheidungen sammelst du und stellst sie am Ende gesammelt (je Kontext · Optionen · Empfehlung). Nichts still annehmen, was wirklich Knuts Entscheidung ist.',
      '- Tests und Prüfungen des Repos laufen lassen, bevor du „fertig“ meldest.',
      // Plan 274 (Knut 20.10.2026, Rechner-Runden): Grundregeln zuerst als Test, nicht erst im Review.
      '- Rechner-, Geld- oder Summenlogik (Preise, Tarife, Beträge, Summen, Ersparnis): zuerst die Tests für die Grundregeln schreiben und rot sehen, dann bauen — Summe = Summe der gezeigten Posten, Vorzeichen (Abzug/Gutschrift/Ersparnis), netto/brutto-Beschriftung passt zum gerechneten Wert.',
      // Plan 274 (Vorfall e422ab42): eine mitten im Zug nachgereichte Richtungsänderung ging unter.
      '- Nachgereichte Nachrichten (📨, während du arbeitest) haben Vorrang vor deinem bisherigen Plan: bestätige im nächsten Text in einem Satz, was du daraus übernimmst, und richte die Arbeit danach aus.',
      // Knut 13.10.2026: PR- und Plan-Texte gehen auf GitHub — dort gibt es weder die lokalen Ordner noch Zweige/PRs, die erst entstehen.
      '- PR- und Plan-Texte verweisen nie auf PRs oder Branches, die es noch nicht gibt, und nie auf lokale Pfade (`~/…`, `/home/…`, Review-Paket-Ordner). Belege als Commit-SHA, Dateipfad im Repo oder bestehender PR-Link.',
    ].join('\n'),
    // Plan 205: Tiefe (Pflichtschritte) und ETA (Pflichtzeile im Stand-Block, die Werkbank liest sie wie „Status:“).
    tiefeText(b.tiefe ?? tiefeOf(null)),
    // Knut 26.10.2026: Stränge auf Claude geben Zuarbeit an Melious (Abo, Energie statt Geld).
    ...(String(b.modell ?? '').startsWith('melious:') ? [] : [MELIOUS_ZUARBEIT_TEXT]),
    REGEL_PFLICHT,
    [
      'Schließe JEDE Antwort mit diesem Abschnitt (die Haupt-Sitzung liest ihn maschinell; nach „Status:“ genau eines der drei Wörter — „fertig“ nur, wenn der Auftrag erledigt und geprüft ist):',
      '```text',
      '### Stand',
      '- Erledigt: …',
      '- Offen: …',
      '- Braucht Knut: … (oder „nichts“)',
      '- Regeln: AGENTS.md gelesen · olaf-feedback-check n/n mit Beleg · Checkliste: ohne Befund | Befunde …',
      ETA_ZEILE,
      'Status: fertig | braucht Antwort | blockiert',
      '```',
      'Schreib den Abschnitt selbst als normales Markdown, nicht als Codeblock. Die ETA schätzt du schon in der ersten Antwort (Uhrzeit in Wiener Zeit oder Dauer ab jetzt) und ziehst sie bei jeder Antwort nach. Bei „Status: fertig“ lässt du die ETA-Zeile weg.',
    ].join('\n'),
    BERICHT_PFLICHT,
    `---\n\nAuftrag:\n${b.prompt.trim()}`,
  ].join('\n\n');
}

/** Text einer gespeicherten LibreChat-Nachricht: Agenten-Endpunkte legen ihn in content[] ab, `text` ist dann leer. */
export function messageText(m: any): string {
  if (!m) return '';
  const parts = Array.isArray(m.content) ? m.content.filter((p: any) => p?.type === 'text').map((p: any) => (typeof p.text === 'string' ? p.text : p.text?.value ?? '')).join('') : '';
  return (parts || String(m.text ?? '')).trim();
}

/** Status-Marke der letzten Antwort („Status: fertig | braucht Antwort | blockiert“), die letzte zählt. */
export function statusMark(text: string): 'fertig' | 'braucht Antwort' | 'blockiert' | null {
  const all = [...text.matchAll(/^[\s>*_-]*Status[*_]*\s*:\s*[*_]*\s*(fertig|braucht Antwort|blockiert)\b/gim)];
  const v = all.at(-1)?.[1]?.toLowerCase();
  return v === 'fertig' ? 'fertig' : v === 'braucht antwort' ? 'braucht Antwort' : v === 'blockiert' ? 'blockiert' : null;
}

export interface StrandState { running: boolean; interrupted: boolean; queued?: { pos: number; since: number } | null; turn: { start: number; end: number | null; outcome: string | null; modell?: string } | null }
export interface LastMsg { fromUser: boolean; text: string; error: boolean; at: number }

/**
 * Status eines Strangs (rein, testbar). Reihenfolge: Startfehler → läuft (Brücke) → abgebrochen (Neustart) → letzte
 * Nachricht noch nicht bei der Brücke → Ausgang des Zuges → Status-Marke der Antwort.
 */
export type AutoCause = 'limit' | 'timeout' | 'interrupted' | 'lost' | 'busy' | 'rate_limit';

export function orchStatus(run: { startError?: string | null; startedAt: Date | number; lastSentAt?: Date | number | null }, s: StrandState | null | undefined, last: LastMsg | null, now = Date.now()): { status: OrchStatus; reason: string; cause?: AutoCause } {
  if (run.startError) return { status: 'failed', reason: `Start fehlgeschlagen: ${run.startError}` };
  if (s?.running) return { status: 'running', reason: 'Zug läuft' };
  // Plan 213 S1a: wartet in der Schlange der Brücke (Parallelgrenze) — kein Fehlschlag, startet von selbst.
  if (s?.queued) return { status: 'running', reason: `in der Schlange (Platz ${s.queued.pos}, seit ${Math.max(0, Math.round((now - s.queued.since) / 60_000))} min)` };
  // Kein Fehler: das automatische „weiter“ übernimmt; greift es nicht, meldet der Hauptchat „hängt“ (Plan 154, G10).
  if (s?.interrupted) return { status: 'waiting', reason: 'Zug abgebrochen (Brücke neu gestartet) — wird automatisch fortgesetzt, sonst `send <id> weiter`', cause: 'interrupted' };
  const sent = new Date(run.lastSentAt ?? run.startedAt).getTime();
  // Plan 274 (D9): eine gespeicherte Antwort mit „Status: fertig“ NACH der letzten Nachricht ist das Ergebnis — was danach technisch
  // schiefging (Zugende, Brücke ohne Vermerk), steht nur noch im Grund. Kein cause: nach „fertig“ kein automatisches „weiter“.
  // Nur Antworten NACH dem Senden (lastSentAt wird vor dem Senden gestempelt) — sonst gälte eine ältere „fertig“-Antwort als Ergebnis
  // einer verlorenen Nachricht (Gegenprüfung Pass C).
  const fertigNachSend = !!last && !last.fromUser && !last.error && last.at > sent && statusMark(last.text) === 'fertig';
  if (!s?.turn || s.turn.start < sent - 5000) {
    if (last?.error && last.at >= sent - 5000) return { status: 'failed', reason: `LibreChat meldet einen Fehler: ${last.text.slice(0, 160)}` };
    if (fertigNachSend) return { status: 'done', reason: 'fertig (Zug in der Brücke nicht vermerkt)' };
    if (now - sent < 180_000) return { status: 'running', reason: 'startet (Nachricht unterwegs zur Brücke)' };
    return { status: 'failed', reason: 'Nachricht ist nach 3 Minuten nicht bei der Brücke angekommen — `send <id> weiter` oder Chat ansehen', cause: 'lost' };
  }
  const ABBRUCH: Record<string, string> = { busy: 'Parallelgrenze', limit: 'Schrittlimit', timeout: 'Zeitlimit', rate_limit: 'Kontingent', error: 'Fehler in der Claude-Sitzung', aborted: 'Zug abgebrochen' };
  if (s.turn.outcome && ABBRUCH[s.turn.outcome] && fertigNachSend && last!.at >= s.turn.start - 5000) return { status: 'done', reason: `fertig (danach abgebrochen: ${ABBRUCH[s.turn.outcome]})` };
  switch (s.turn.outcome) {
    case 'busy': return { status: 'failed', reason: 'Parallelgrenze der Brücke (BRIDGE_MAX_PARALLEL_CHATS) — später `send <id> weiter`', cause: 'busy' };
    case 'limit': return { status: 'waiting', reason: 'Schrittlimit des Zuges erreicht — `send <id> weiter`', cause: 'limit' };
    case 'timeout': return { status: 'waiting', reason: 'Zeitlimit des Zuges erreicht — `send <id> weiter`', cause: 'timeout' };
    case 'rate_limit': return { status: 'failed', reason: 'Claude-Kontingent ausgeschöpft', cause: 'rate_limit' };
    case 'error': return { status: 'failed', reason: 'Fehler in der Claude-Sitzung — Chat ansehen, ggf. `send <id> weiter`' };
    case 'aborted': return { status: 'failed', reason: 'Zug abgebrochen' };
  }
  // Normal beendet: die Antwort speichert LibreChat erst nach dem Zug.
  if (!last || last.fromUser) {
    if (s.turn.end && now - s.turn.end < 60_000) return { status: 'running', reason: 'Antwort wird gespeichert' };
    return { status: 'waiting', reason: 'keine gespeicherte Antwort — Chat ansehen' };
  }
  if (last.error) return { status: 'failed', reason: `LibreChat meldet einen Fehler: ${last.text.slice(0, 160)}` };
  const mark = statusMark(last.text);
  if (mark === 'fertig') return { status: 'done', reason: 'Agent meldet „fertig“' };
  if (mark === 'blockiert') return { status: 'failed', reason: 'Agent meldet „blockiert“' };
  if (mark === 'braucht Antwort') return { status: 'waiting', reason: 'Agent braucht eine Antwort' };
  return { status: 'waiting', reason: 'Antwort ohne Status-Marke — lesen und antworten' };
}

/**
 * Status mit Deckel (`autoStopped`) — Plan 274, D5/D9. Fertig bleibt fertig („danach: Grund“); eine Budget-Pause wartet auf Knuts
 * Entscheidung (kein Fehlschlag); der Deckel des automatischen „weiter“ bleibt „gestoppt“ (failed). Ein laufender Zug läuft.
 */
export function mitDeckel(st: { status: OrchStatus; reason: string; cause?: AutoCause }, stop: { reason?: unknown; cause?: unknown } | null | undefined): { status: OrchStatus; reason: string; cause?: AutoCause } {
  if (!stop || st.status === 'running') return st;
  const grund = String(stop.reason ?? 'Deckel erreicht');
  if (st.status === 'done') return { status: 'done', reason: `fertig (danach: ${grund})` };
  if (stop.cause === 'budget') return { status: 'waiting', reason: `pausiert: ${grund} — Knut entscheidet in „Heute“ (Weiter mit +50 % / Anhalten)` };
  return { status: 'failed', reason: grund };
}

// ---------- Automatisch fortsetzen (docs/plan-orchestrator-auto-weiter.md, Knut 11.10.2026: „max schrittlimits … mit dem
// orchestrator sollte das nicht passieren“) ----------
//
// Endet ein Zug eines orchestrierten Strangs an einer technischen Grenze (Schrittlimit, Zeitlimit, Brücken-Neustart,
// Nachricht nicht angekommen, Parallelgrenze, Kontingent), schickt die Werkbank selbst „weiter“. Nie bei geprüften
// Strängen, nach review_ready, bei offener Rückfrage zum Strang und nach dem Deckel. Normale Chats stehen nicht in
// orchestrator_runs und bleiben unberührt.

export const AUTO_BUSY_MS = 2 * 60_000, AUTO_RATE_MS = 30 * 60_000, AUTO_SAVE_MS = 30_000, AUTO_STALE_MS = 6 * 3600_000;
export const autoMax = () => Math.max(1, Math.floor(Number(process.env.ORCH_AUTO_WEITER_MAX)) || 30);
export const CAUSE_TEXT: Record<AutoCause, string> = { limit: 'Schrittlimit', timeout: 'Zeitlimit', interrupted: 'Brücke neu gestartet', lost: 'Nachricht nicht angekommen', busy: 'Parallelgrenze', rate_limit: 'Kontingent' };

// ---------- Zustellung mit Bestätigung und Wiederholung (Plan 274, D4b; Vorfall e422ab42, 20.10.) ----------

export type Bestaetigung = 'angekommen' | 'schlange' | 'unterwegs';
/** Hat die Brücke die Nachricht, die um `sentAt` (vor dem Senden) abging, angenommen? */
export function bestaetigung(s: StrandState | null | undefined, sentAt: number): Bestaetigung {
  if (s?.turn && s.turn.start >= sentAt - 5000) return s.queued ? 'schlange' : 'angekommen';
  if (s?.queued && s.queued.since >= sentAt - 5000) return 'schlange';
  return 'unterwegs';
}
export const BESTAETIGUNG_TEXT: Record<Bestaetigung, string> = {
  angekommen: 'angekommen (die Brücke fährt den Zug)',
  schlange: 'angekommen, wartet in der Schlange der Brücke (startet von selbst)',
  unterwegs: 'noch nicht bestätigt — kommt sie nicht an, schickt die Werkbank nach 3 min denselben Text noch einmal',
};
export const ERNEUT = '(Werkbank: Diese Nachricht kam beim ersten Versuch nicht an und wird noch einmal zugestellt.)';

/** Text des automatischen Fortsetzens: „nicht angekommen“ → dieselbe Nachricht noch einmal (sonst ginge sie verloren), sonst „weiter“. */
export function fortsetzText(cause: AutoCause, lastSentText: string | null | undefined, n: number, max: number): string {
  const weiter = `weiter (automatisch fortgesetzt: ${CAUSE_TEXT[cause]}, ${n}/${max})`;
  const t = String(lastSentText ?? '').trim();
  if (cause !== 'lost' || !t || /^weiter \(automatisch fortgesetzt/.test(t)) return weiter;
  const kern = t.startsWith(ERNEUT) ? t.slice(ERNEUT.length).trim() : t;
  return `${ERNEUT}\n\n${kern}`;
}

/** Nachreichungen eines Strangs, die noch nicht abgeschlossen sind (Liste `nachreichungen` + Einzelfeld von vor 20b). */
export function injectsVon(d: { nachreichungen?: unknown; lastInject?: any }): any[] {
  const liste = Array.isArray(d.nachreichungen) ? d.nachreichungen : [];
  const alt = d.lastInject && !liste.some((x: any) => x?.id === d.lastInject.id) ? [d.lastInject] : [];
  return [...liste, ...alt].filter((x: any) => x && !x.done);
}
/** Nach dem Zug nachsenden? ungelesen ja; unbekannt (Brücke neu gestartet) auch — lieber einmal doppelt mit Hinweis als verloren. */
export const nachsenden = (state: string | null | undefined) => state === 'ungelesen' || state == null;
export const NACHGEREICHT_HINWEIS = '(Werkbank: Diese Nachricht wurde dir während deines letzten Zugs nachgereicht und kommt jetzt noch einmal als normale Nachricht — falls du sie schon umgesetzt hast, bestätige das nur kurz.)';

export interface AutoRun { startedAt: Date | number; lastSentAt?: Date | number | null; reviewedAt?: unknown; reviewReadyAt?: unknown; autoStopped?: unknown; autoStreak?: number; autoFor?: string | null }
export interface AutoCtx { now: number; openQuestion: boolean; accountFree: boolean; max: number }
export type AutoDecision = { action: 'none' | 'wait' | 'send' | 'stop'; key?: string; why: string };

/** Ob und wann ein Strang automatisch fortgesetzt wird (rein, testbar). `key` kennzeichnet den Zug, der fortgesetzt wird. */
export function autoWeiter(run: AutoRun, st: { cause?: AutoCause }, s: StrandState | null | undefined, last: LastMsg | null, ctx: AutoCtx): AutoDecision {
  const cause = st.cause;
  if (!cause) return { action: 'none', why: 'kein technisches Zugende' };
  if (run.reviewedAt) return { action: 'none', why: 'geprüft' };
  if (run.reviewReadyAt) return { action: 'none', why: 'review_ready gemeldet' };
  if (run.autoStopped) return { action: 'none', why: 'Deckel erreicht' };
  if (ctx.openQuestion) return { action: 'none', why: 'wartet auf eine Rückfrage' };
  const sent = new Date(run.lastSentAt ?? run.startedAt).getTime();
  const t = s?.turn ?? null;
  let key = cause === 'lost' || !t ? `s:${sent}` : `t:${t.start}`;
  // Abgebrochener Zug, aber danach schon gesendet: wie „unterwegs“, nach 3 min wie „nicht angekommen“.
  if (cause === 'interrupted' && t && t.start < sent - 5000) {
    if (ctx.now - sent < 180_000) return { action: 'wait', why: 'Nachricht unterwegs' };
    key = `s:${sent}`;
  }
  if (run.autoFor === key) return { action: 'none', why: 'dieser Zug ist schon fortgesetzt' };
  const end = t?.end ?? t?.start ?? sent;
  // Review-Pass: alte Zugenden nie (sonst setzt der erste Takt nach dem Ausrollen tagealte Stränge auf einmal fort).
  if (ctx.now - Math.max(end, sent) > AUTO_STALE_MS) return { action: 'none', why: 'Zugende länger als 6 h her — von Hand fortsetzen' };
  // Council 15.10., C5: Parallelgrenze → wachsender Abstand (2, 4, 8, 16, 32 min) statt alle 2 min neu (jeder Neustart lädt den vollen Kontext).
  const busyMs = AUTO_BUSY_MS * 2 ** Math.min(4, Math.max(0, Number(run.autoStreak ?? 0)));
  if (cause === 'busy' && ctx.now - end < busyMs) return { action: 'wait', key, why: `Parallelgrenze — erneut nach ${Math.round(busyMs / 60_000)} min` };
  if (cause === 'rate_limit' && ctx.now - end < AUTO_RATE_MS && !ctx.accountFree) return { action: 'wait', key, why: 'Kontingent — erneut nach 30 min oder bei freiem Konto' };
  // Council R1, Bedingung 1: erst wenn LibreChat die Antwort des Zuges gespeichert hat (sonst falsche Elternnachricht).
  if ((cause === 'limit' || cause === 'timeout') && t && !(last && !last.fromUser && last.at >= t.start - 5000) && ctx.now - end < AUTO_SAVE_MS) return { action: 'wait', key, why: 'Antwort wird gespeichert' };
  if ((run.autoStreak ?? 0) >= ctx.max) return { action: 'stop', key, why: `${ctx.max}× automatisch fortgesetzt — Chat ansehen` };
  return { action: 'send', key, why: CAUSE_TEXT[cause] };
}

// ---------- LibreChat (im Namen der Person) ----------

async function lcFetch(u: User, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; j: any }> {
  const token = await librechatAccessToken(u);
  const r = await fetch(`${cfg.librechatUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, j: await r.json().catch(() => null) };
}

// Leitstand (docs/plan-leitstand.md): eigener Titel-Präfix und eigenes Lesezeichen.
// Plan 144: neue Hauptchats bekommen „Hauptchat“; alte Chats behalten ihr Lesezeichen „Leitstand“ (erkannt wird über kind).
export const LEIT_TAG = 'Hauptchat';
const TAG_TEXT: Record<string, string> = { [ORCH_TAG]: 'Unter-Chats, die der Hauptchat (oder die CLI) im OLAF Workspace gestartet hat', [LEIT_TAG]: 'Der Hauptchat: führt die Unter-Chats' };

/**
 * Lesezeichen in LibreChats `conversationtags` atomar anlegen (Release 4, Offen 4). Nicht über POST /api/tags: LibreChat
 * prüft dort erst mit findOne und schreibt dann per Upsert `count: 0` — legen zwei Stränge desselben Laufs gleichzeitig
 * an, setzt die spätere Anlage die Zählung der früheren zurück. `$setOnInsert` fasst ein vorhandenes Lesezeichen nie an;
 * die Zählung erhöht danach LibreChat selbst (PUT /api/tags/convo, `$inc`). Den eindeutigen Index (tag, user, tenantId)
 * legt LibreChat an; verliert unser Upsert den Wettlauf, ist das 11000 — dann gibt es das Lesezeichen schon.
 */
async function ensureTag(u: User, tag: string) {
  const T = lc().collection('conversationtags');
  const last: any = await T.find({ user: u.id }, { projection: { position: 1 } }).sort({ position: -1 }).limit(1).next();
  const now = new Date();
  try {
    await T.updateOne({ user: u.id, tag }, { $setOnInsert: { description: TAG_TEXT[tag] ?? tag, count: 0, position: (last?.position || 0) + 1, createdAt: now, updatedAt: now } }, { upsert: true });
  } catch (e: any) { if (e?.code !== 11000) throw e; }
}

/** Titel „Orchestrator · …“ (bzw. „Leitstand · …“) und Lesezeichen setzen, sobald LibreChat die Unterhaltung gespeichert hat. Idempotent. */
export async function decorate(u: User, conv: string, title: string, tag = ORCH_TAG): Promise<{ ok: boolean; why?: string }> {
  const c: any = await lc().collection('conversations').findOne({ conversationId: conv, user: u.id }, { projection: { title: 1, tags: 1 } });
  if (!c) return { ok: false, why: 'Unterhaltung noch nicht gespeichert' };
  const want = (tag === LEIT_TAG ? title : `Orchestrator · ${title}`).slice(0, 200);
  if (c.title !== want) {
    const r = await lcFetch(u, '/api/convos/update', { method: 'POST', body: { arg: { conversationId: conv, title: want } } });
    if (r.status >= 300) return { ok: false, why: `Titel: LibreChat ${r.status}` };
  }
  const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
  if (!tags.includes(tag)) {
    await ensureTag(u, tag);
    const r = await lcFetch(u, `/api/tags/convo/${encodeURIComponent(conv)}`, { method: 'PUT', body: { tags: [...tags, tag] } });
    if (r.status >= 300) return { ok: false, why: `Lesezeichen: LibreChat ${r.status}` };
  }
  return { ok: true };
}

export async function decorateSoon(u: User, conv: string, title: string, tries = 20, tag = ORCH_TAG) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await decorate(u, conv, title, tag)).ok) {
        // LibreChats Auto-Titel kann nach dem ersten Zug den Titel überschreiben; die Chatliste blendet Unter-Chats an „Orchestrator · …“
        // aus (Paket 187, D5) — den Titel deshalb noch zweimal nachziehen (idempotent: ohne Abweichung nur ein Lesen).
        for (const ms of [45_000, 180_000]) setTimeout(() => { decorate(u, conv, title, tag).catch(() => {}); }, ms).unref?.();
        return;
      }
    } catch { /* weiter versuchen */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function lastMessage(u: User, conv: string): Promise<(LastMsg & { id: string }) | null> {
  const m: any = await lc().collection('messages').find({ conversationId: conv, user: u.id }).sort({ createdAt: -1 }).limit(1).next();
  return m ? { id: String(m.messageId), fromUser: !!m.isCreatedByUser, text: messageText(m), error: !!m.error, at: new Date(m.createdAt ?? 0).getTime() } : null;
}

export async function strandStates(u: User): Promise<Map<string, StrandState & { dir: string; written: string[]; kind?: string; waitingAnswer?: boolean }>> {
  const r = await fetch(`${cfg.bridgeUrl}/internal/orch-state?user=${encodeURIComponent(u.id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw err(502, `Brücke antwortet mit ${r.status}`);
  const j: any = await r.json();
  return new Map((j.strands ?? []).map((s: any) => [s.conv, s]));
}

// ---------- Öffentliche Schnittstelle ----------

export interface StartInput { title: string; prompt: string; cwd: string; plan?: string | null; shared?: boolean; code?: boolean; slug?: string | null; aufrufer?: string; g0?: G0Tor | null; lauf?: string | null; modell?: string | null; risiko?: 'niedrig' | 'mittel' | 'hoch' | null; profil?: 'voll' | 'bauer' | 'leser' | 'schreiber' | 'release' | null; tiefe?: string | null;
  /** Tokenbudget des Strangs (Plan 209, S3.2); leer = ORCH_BUDGET_TOKENS je Tiefe (Vorgabe 0 = aus). */
  budget?: number | null;
  /** Vorrang in der Warteschlange der Brücke (Plan 213 S1a: Reviews). */
  vorrang?: boolean }

// Plan 162, S2: Hauptmodell und Risikostufe eines Strangs (vorbereitet für die smarte Modellwahl, Paket 163). Nur beim Start.
const STRAND_MODEL = /^(claude:(opus|sonnet|haiku)|melious:[\w.:/-]{1,80})$/;
const RISIKO = ['niedrig', 'mittel', 'hoch'];

/** Lauf-Name (Plan 132 Teil B, F8): ausdrücklich angegeben oder der Titelteil vor „:“ bzw. „ · “; gesäubert, ≤ 40 Zeichen. */
export function laufName(title: string, explicit?: string | null): { lauf: string; explicit: boolean } {
  const clean = (t: string) => t.replace(/[\u0000-\u001f\u007f·/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  const e = clean(String(explicit ?? ''));
  if (e) return { lauf: e, explicit: true };
  const head = String(title).split(/:| · /)[0];
  return { lauf: clean(head) || clean(title) || 'ohne Lauf', explicit: false };
}
export const laufTag = (lauf: string) => `Orch · ${lauf}`;

export const runs = () => wb().collection('orchestrator_runs');
// Stränge, nicht der Leitstand (Plan 132, C9/D2): `$ne`, damit alte Dokumente ohne kind dabei bleiben.
export const STRANDS = { kind: { $ne: 'leitstand' } };
// Offen = Knut hat ihn nicht geprüft (Teil B, G2); vom Leitstand abgelegte bleiben offen. Alte Dokumente ohne knutReviewedAt,
// die per CLI geprüft wurden (reviewedAt ohne reviewedBy), gelten als von Knut geprüft.
export const OPEN = { knutReviewedAt: null, $or: [{ reviewedAt: null }, { reviewedBy: 'leitstand' }] };

async function newId(): Promise<string> {
  for (;;) { const id = randomUUID().slice(0, 8); if (!(await runs().findOne({ _id: id as any }))) return id; }
}

// ---------- Paket und Bericht eines Strangs (Plan 274, D8; Vorfall ce076bec → Bericht aus Paket 242) ----------

/** paket/bericht beim Start: das eigene Paket; ohne eigenes Paket bleibt der Bericht offen, bis der Agent ihn nennt (Status-Takt). */
export function paketFelder(cwd: string, texte: string[]): { paket: string | null; bericht: string | null } {
  const paket = eigenesPaket(cwd, texte);
  return { paket, bericht: paket ? join(reviewDir(), paket, 'bericht.md') : null };
}

/**
 * Falsch zugeordnet (vor 20b: erster Paketpfad im Auftrag)? → $set auf das eigene Paket, Kopf neu lesen; sonst null. Nur das
 * sichere Signal „Arbeitsordner liegt im Paket“ — der gespeicherte Auftrag ist gekürzt, eine Marke darin könnte fehlen.
 */
export function paketHeilung(d: { cwd?: string | null; prompt?: string | null; bericht?: string | null; paket?: string | null }): Record<string, unknown> | null {
  const eigen = eigenesPaket(String(d.cwd ?? ''), []);
  if (!eigen) return null;
  const soll = join(reviewDir(), eigen, 'bericht.md');
  if (d.bericht === soll && (d.paket ?? eigen) === eigen) return null;
  return { paket: eigen, bericht: soll, berichtMeta: null, berichtKopf: null, berichtDiagramm: null, berichtHash: null };
}

// ---------- Ein Strang je Worktree (Plan 274, D4a; Vorfall 20.10.: b9b968af und 4c836b73 im selben Rechner-Worktree) ----------
// Schlüssel ist die Git-Wurzel, nicht der Ordner: ein Strang mit dem Paketordner als cwd, der in den Repo-Worktree schreibt, belegt
// diesen Worktree genauso wie ein Strang, der dort startet. Die Brücke sperrt zusätzlich das Schreiben (sessions.ts, fremderWorktree).

const wtCache = new Map<string, { at: number; wt: string }>();
/**
 * Git-Wurzel eines Ordners oder einer Datei (auch einer, die es noch nicht gibt); ohne Git der Ordner selbst. Ein Review-Paket ist
 * immer sein eigener Schlüssel — auch falls review-pakete einmal in einem Repo läge (sonst teilten sich alle Pakete einen Worktree).
 */
export function worktreeVon(pfad: string): string {
  if (!pfad || !isAbsolute(String(pfad))) return '';
  const paket = eigenesPaket(String(pfad), []);
  if (paket) return join(reviewDir(), paket);
  let dir = String(pfad);
  while (dir !== dirname(dir) && !existsSync(dir)) dir = dirname(dir);
  try { if (!statSync(dir).isDirectory()) dir = dirname(dir); dir = realpathSync(dir); } catch { return pfad; }
  const c = wtCache.get(dir);
  if (c && Date.now() - c.at < 60_000) return c.wt;
  let wt = dir;
  try { wt = realpathSync(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || dir; } catch { /* kein Git */ }
  wtCache.set(dir, { at: Date.now(), wt });
  return wt;
}

export interface StrangImWorktree { id: string; title: string; status: OrchStatus | string; cause?: string | null; trees: string[] }
/** Belegt ein anderer Strang einen dieser Worktrees? Belegt = läuft, wartet oder hängt an einer Grenze, die automatisch fortgesetzt wird. */
export function worktreeKonflikt(ziel: string[], andere: StrangImWorktree[]): StrangImWorktree | null {
  const z = new Set(ziel);
  return andere.find((a) => (a.status === 'running' || a.status === 'waiting' || (a.status === 'failed' && !!a.cause)) && a.trees.some((t) => z.has(t))) ?? null;
}
export const konfliktText = (k: StrangImWorktree) => `Im selben Worktree arbeitet schon der Strang ${k.id} („${k.title}“, ${k.status}) — höchstens ein Strang je Worktree. Warten, bis er fertig ist, einen eigenen Worktree nehmen oder ausdrücklich --shared.`;

/** Worktrees, die die offenen Stränge belegen: Wurzel des cwd + Wurzeln der Dateien, die die Brücke als geschrieben kennt. */
async function belegte(u: User, ohne: string | null): Promise<StrangImWorktree[]> {
  const offen = (await listOrch(u, { all: false })).filter((r) => r.id !== ohne);
  return offen.map((r: any) => ({ id: r.id, title: r.title, status: r.status, cause: r.cause ?? null, trees: [...new Set([r.cwd, ...(r.written ?? [])].filter(Boolean).map((p: string) => worktreeVon(p)).filter(Boolean))] }));
}

export async function startOrch(u: User, inp: StartInput): Promise<{ id: string; conv: string; url: string; cwd: string; plan: string | null; mode: any; stand: string | null; g0: G0Public | null; worktree: boolean; tiefe: Tiefe; modell: string | null; warning?: string }> {
  const title = String(inp.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const prompt = String(inp.prompt ?? '').trim();
  if (!title) throw err(400, 'Titel fehlt.');
  if (!prompt) throw err(400, 'Auftrag fehlt.');
  if (prompt.length > 40_000) throw err(400, 'Auftrag zu lang (höchstens 40 000 Zeichen) — Details in eine Plandatei.');
  let real: string;
  try { real = realpathSync(String(inp.cwd ?? '')); } catch { throw err(400, 'Arbeitsordner gibt es nicht.'); }
  let plan: string | null = null;
  if (inp.plan) {
    try { plan = realpathSync(String(inp.plan)); if (!statSync(plan).isFile()) throw new Error(); } catch { throw err(400, 'Plandatei gibt es nicht.'); }
  }
  // G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md): jeder Code-Auftrag. Treffer/Stopp → kein Start, Rückfrage.
  let g0: G0Tor | null = null;
  if (inp.code === true && !vorbauAus()) {   // WERKBANK_VORBAU_CHECK=off → kein G0, nichts blockiert
    g0 = inp.g0 ?? await g0Tor(u, { slug: inp.slug ?? null, plan, cwd: real, aufrufer: inp.aufrufer ?? 'orch start --code', title });
    if (!g0.go) throw Object.assign(err(409, g0.text), { g0: g0.public });
  }
  // Neuester Code (Knut 11.10.2026, fresh.ts): git fetch; Code-Auftrag → frischer Worktree vom Integrationszweig.
  const id = await newId();
  const fresh = prepareFresh(real, id, inp.code === true);
  real = fresh.cwd;
  // Ein Worktree, ein offener Strang (Council, Bedingung 8; Plan 274: Git-Wurzel statt Ordner, geschriebene Dateien zählen mit).
  if (!inp.shared) {
    const k = worktreeKonflikt([worktreeVon(real)], await belegte(u, null));
    if (k) throw err(409, konfliktText(k));
  }
  const conv = randomUUID();
  // Plan 205: Tiefe (Vorgabe regular); quick/deep setzen Modell bzw. Risiko vor, ausdrückliche Angaben schlagen das.
  if (inp.tiefe && !istTiefe(inp.tiefe)) throw err(400, `Tiefe: ${TIEFEN.join(', ')}.`);
  const tiefe = tiefeOf(inp.tiefe);
  const vor = tiefeStart(tiefe, { modell: inp.modell ? String(inp.modell) : null, risiko: inp.risiko && RISIKO.includes(inp.risiko) ? inp.risiko : null });
  const modell = vor.modell;
  if (modell && !STRAND_MODEL.test(modell)) throw err(400, 'Modell: claude:opus|sonnet|haiku oder melious:<modell>.');
  const abo = modellAusserhalbAbo(modell);
  if (abo) throw err(400, abo);
  const risiko = vor.risiko as StartInput['risiko'];
  // Hotfix 15.10.: Melious-Modell außerhalb des Abos → Start erlaubt, aber mit Hinweis „läuft auf Guthaben“ (kein stilles Guthaben).
  const aboHinweis = modell?.startsWith('melious:') && modell !== 'melious:auto' && ausserhalbAbo([modell.slice(8)], (await meliousSettings(u)).abo).length ? `Melious-Modell „${modell.slice(8)}“ ist nicht im Abo und läuft auf Guthaben.` : null;
  if (inp.profil && !['voll', 'bauer', 'leser', 'schreiber', 'release'].includes(inp.profil)) throw err(400, 'Profil: voll, bauer, leser, schreiber oder release.');
  const profil = inp.profil && inp.profil !== 'voll' ? inp.profil : null;
  // 1) Bei der Brücke anmelden (prüft den Ordner selbst). Ohne Anmeldung kein Chat (fail closed).
  const reg = await fetch(`${cfg.bridgeUrl}/internal/orchestrate`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ userId: u.id, email: u.email, conv, dir: real, ...(modell ? { modell } : {}), ...(risiko ? { risiko } : {}), ...(profil ? { profil } : {}), tiefe, ...(inp.vorrang === true ? { vorrang: true } : {}) }), signal: AbortSignal.timeout(5000) });
  const rj: any = await reg.json().catch(() => ({}));
  if (!reg.ok) throw err(reg.status === 400 || reg.status === 409 || reg.status === 403 ? reg.status : 502, rj.error ?? `Brücke antwortet mit ${reg.status}`);
  const stand = [fresh.status, g0 ? g0.text : null].filter(Boolean).join('\n') || null;
  const text = orchBrief({ title, prompt, cwd: rj.dir ?? real, plan, person: u.name, stand, tiefe, modell });
  const { lauf, explicit } = laufName(title, inp.lauf);
  // Bericht-Pfad aus dem VOLLEN Auftrag und der Plandatei (F7) — der gespeicherte Auftrag ist gekürzt.
  let planText = '';
  if (plan) { try { planText = readFileSync(plan, 'utf8').slice(0, 200_000); } catch { /* egal */ } }
  const doc: any = { _id: id, userId: u.id, conv, url: `${cfg.librechatPublicUrl}/c/${conv}`, title, cwd: rj.dir ?? real, plan, prompt: prompt.slice(0, 500), startedAt: new Date(), lastSentAt: new Date(), sends: 1, reviewedAt: null, knutReviewedAt: null, mode: rj.mode ?? null, startError: null, slug: g0?.slug ?? null, g0: g0?.public ?? null,
    lauf, laufExplicit: explicit, modell, risiko, profil, tiefe, shared: inp.shared === true,
    // Plan 274 (D8): eigenes Paket (Arbeitsordner im Paket, „Paket …“, auftrag.md, genau ein Paket) — nie die Vorarbeit im Auftrag.
    ...paketFelder(rj.dir ?? real, [prompt, planText]),
    budgetTokens: Number(inp.budget) > 0 ? Math.round(Number(inp.budget)) : null,
    ownWorktree: fresh.worktree,   // Heute/Release-Stand (Paket 141): nur ein eigener Worktree belegt den Stand des Strangs
    // „Worum es geht“ auf Heute (Paket 141): die Ziel-Zeile aus dem VOLLEN Auftrag — der gespeicherte ist auf 500 Zeichen gekürzt.
    zielLine: prompt.match(/^\s*(?:[-*]\s*)?\**Ziel:?\**:?\s+.+$/im)?.[0].trim().slice(0, 600) ?? null };
  await runs().insertOne(doc);
  // 2) Chat mit genau dieser ID anlegen; LibreChat fährt den Zug serverseitig.
  try {
    await createLibreChat(u, text, { conversationId: conv });
  } catch (e: any) {
    await runs().updateOne({ _id: id as any }, { $set: { startError: String(e.message ?? e).slice(0, 300) } });
    throw err(e.status ?? 502, String(e.message ?? e));
  }
  // 3) Titel + Lesezeichen im Hintergrund (LibreChat speichert die Unterhaltung erst nach ein paar Sekunden).
  // Nacheinander: beide lesen sonst dieselbe leere Tag-Liste, und der zweite PUT überschreibt den ersten (Test Teil B).
  decorateSoon(u, conv, title).then(() => (explicit ? decorateSoon(u, conv, title, 20, laufTag(lauf)) : undefined)).catch(() => {});
  const warnungen = [doc.mode && doc.mode !== 'auto' ? `Brücke läuft für dieses Konto im Modus „${doc.mode}“ — ohne Auto-Modus darf der Strang nur lesen.` : null, aboHinweis].filter(Boolean);
  return { id, conv, url: doc.url, cwd: doc.cwd, plan, mode: doc.mode, stand, g0: g0?.public ?? null, worktree: fresh.worktree, tiefe, modell, ...(warnungen.length ? { warning: warnungen.join(' ') } : {}) };
}

/** Median-Dauer je Tiefe aus den erledigten Strängen der Person (Plan 205: Rückfall-ETA ohne Agentenangabe). */
export async function etaMediane(u: User, now = Date.now()) {
  const docs = await runs().find({ userId: u.id, ...STRANDS, doneAt: { $ne: null }, startedAt: { $gt: new Date(now - 60 * 86400_000) } }, { projection: { tiefe: 1, startedAt: 1, doneAt: 1 } }).sort({ doneAt: -1 }).limit(600).toArray();
  // Je Tiefe höchstens die letzten 50.
  const n: Record<string, number> = {};
  return mediane(docs.filter((d: any) => (n[tiefeOf(d.tiefe)] = (n[tiefeOf(d.tiefe)] ?? 0) + 1) <= 50));
}

/** ETA eines Strangs für list/show: die ETA-Zeile der letzten Antwort, sonst die zuletzt gemeldete, sonst Median/Vorgabe. */
/** Fertig (Status done oder Marke „fertig“ in der letzten Antwort): null — keine ETA, auch wenn der Agent eine mitschickt. */
function etaVon(d: any, last: LastMsg | null, status: OrchStatus, med: Record<Tiefe, number | null>) {
  const marke = last ? (last.fromUser ? null : statusMark(last.text)) : d.marke ?? null;
  if (status === 'done' || marke === 'fertig') return null;
  const neu = last && !last.fromUser ? etaMark(last.text, last.at) : null;
  return etaFuer({ ...d, marke, zustand: null, eta: neu ? { at: neu } : d.eta }, { fertig: status === 'failed' || status === 'blocked_g0', mediane: med });
}

export async function listOrch(u: User, opts: { all?: boolean } = {}) {
  const docs: any[] = await runs().find({ userId: u.id, ...STRANDS, ...(opts.all ? {} : OPEN) }).sort({ startedAt: -1 }).limit(100).toArray();
  if (!docs.length) return [];
  const med = await etaMediane(u).catch(() => null) ?? { quick: null, regular: null, deep: null, live: null };
  let states = new Map<string, any>();
  let bridgeError: string | null = null;
  try { states = await strandStates(u); } catch (e: any) { bridgeError = String(e.message ?? e); }
  const out = [];
  for (const d of docs) {
    if (d.status === 'blocked_g0') {
      out.push({ id: d._id, title: d.title, status: 'blocked_g0' as OrchStatus, reason: `G0 ${d.g0?.ergebnis === 'stopp' ? 'nicht prüfbar' : 'Treffer'} — Rückfrage ${d.question ?? '?'} im OLAF Workspace (Heute)`, reviewed: !!d.reviewedAt, url: null, cwd: d.cwd, plan: d.plan,
        startedAt: d.startedAt, lastSentAt: d.startedAt, lastActivity: new Date(d.startedAt).getTime(), sends: 0, excerpt: d.g0?.text ?? '', written: [], slug: d.slug, g0: d.g0 ?? null, question: d.question ?? null,
        tiefe: istTiefe(d.tiefe) ? d.tiefe : null, eta: etaFuer(d, { fertig: true }) });
      continue;
    }
    const last = await lastMessage(u, d.conv);
    const s = states.get(d.conv);
    let st: { status: OrchStatus; reason: string; cause?: AutoCause } = bridgeError ? { status: 'failed', reason: `Brücke nicht erreichbar: ${bridgeError}` } : orchStatus(d, s, last);
    if (!bridgeError) st = mitDeckel(st, d.autoStopped);   // Brücke weg bleibt sichtbar, auch bei Budget-Pause (Pass C)
    // Titel/Lesezeichen nachziehen, falls der Start-Durchlauf es nicht geschafft hat (selbstheilend, idempotent).
    if (!d.decorated && !d.startError) { try { if ((await decorate(u, d.conv, d.title)).ok) await runs().updateOne({ _id: d._id }, { $set: { decorated: true } }); } catch { /* nächstes Mal */ } }
    if (d.laufExplicit && !d.decoratedLauf && !d.startError) { try { if ((await decorate(u, d.conv, d.title, laufTag(d.lauf))).ok) await runs().updateOne({ _id: d._id }, { $set: { decoratedLauf: true } }); } catch { /* nächstes Mal */ } }
    out.push({
      id: d._id, title: d.title, status: st.status, reason: st.reason, cause: st.cause ?? null, reviewed: !!d.reviewedAt, url: d.url, cwd: d.cwd, plan: d.plan,
      // Plan 213 S1b: Zustand aus dem Status-Takt (eine Quelle für Workspace, Chat-Leiste und `orch list`).
      zustand: d.zustand ?? null, zustandGrund: d.zustandGrund ?? null, queued: s?.queued ?? null,
      startedAt: d.startedAt, lastSentAt: d.lastSentAt, lastActivity: Math.max(s?.turn?.end ?? 0, s?.turn?.start ?? 0, last?.at ?? 0) || null,
      lauf: d.lauf ?? laufName(d.title).lauf, laufExplicit: !!d.laufExplicit, reviewedBy: d.reviewedBy ?? null, knutReviewed: !!d.knutReviewedAt, doneAt: d.doneAt ?? null, bericht: !!d.bericht,
      // Plan 205: Tiefe (null = alter Strang ohne Feld) und ETA ({ at, quelle, text, ueberfaellig }).
      tiefe: istTiefe(d.tiefe) ? d.tiefe : null, eta: etaVon(d, last, st.status, med),
      sends: d.sends ?? 1, autoWeiter: d.autoTotal ?? 0, autoLast: d.autoLastAt ? { at: d.autoLastAt, cause: d.autoLastCause ?? null } : null, reviewReady: !!d.reviewReadyAt, excerpt: last && !last.fromUser ? excerpt(last.text) : '', written: s?.written ?? [],
    });
  }
  return out;
}

/** Auszug der letzten Antwort: der Abschnitt „### Stand“, sonst das Ende. */
export function excerpt(text: string, n = 600): string {
  const i = text.lastIndexOf('### Stand');
  const t = (i >= 0 ? text.slice(i) : text.slice(-n)).replace(/^\s*\*[^*\n]*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function ownRun(u: User, id: string) {
  const d: any = await runs().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, `Strang ${id} gibt es nicht.`);
  if (d.kind === 'leitstand') throw err(409, `${id} ist der Hauptchat, kein Unter-Chat.`);
  return d;
}

export async function showOrch(u: User, id: string, verlauf = 0) {
  const d = await ownRun(u, id);
  const item = (await listOrch(u, { all: true })).find((r) => r.id === id);
  const last = d.conv ? await lastMessage(u, d.conv) : null;
  // Pull (Plan 154, S4): die letzten n Nachrichten (1–10, je ≤ 4 000 Zeichen vom Ende, zusammen ≤ 20 000), älteste zuerst.
  const n = Math.max(0, Math.min(10, Math.floor(verlauf)));
  let hist: { fromUser: boolean; at: Date; text: string }[] | undefined;
  if (n && d.conv) {
    const ms: any[] = await lc().collection('messages').find({ conversationId: d.conv, user: u.id }).sort({ createdAt: -1 }).limit(n).toArray();
    let budget = 20_000;
    hist = [];
    for (const m of ms) {
      const t = messageText(m);
      // Lange Nachrichten: erste Zeile (beim Brief der Titel „Orchestrator · …“) + Ende (dort steht der Auftrag).
      const cut = t.length > 4000 ? t.split('\n')[0].slice(0, 200) + '\n…' + t.slice(-3790) : t;
      if (budget - cut.length < 0) break;
      budget -= cut.length;
      hist.push({ fromUser: !!m.isCreatedByUser, at: new Date(m.createdAt ?? 0), text: cut });
    }
    hist.reverse();
  }
  return { ...item, conv: d.conv, prompt: d.prompt, bericht: d.bericht ?? null, modell: d.modell ?? null, risiko: d.risiko ?? null, lastModell: d.lastModell ?? null, lastMessage: last ? { fromUser: last.fromUser, at: new Date(last.at), text: last.text.slice(-20_000) } : null, ...(hist ? { verlauf: hist } : {}) };
}

export async function sendOrch(u: User, id: string, text: string, via: 'hand' | 'leitstand' = 'hand', o: { warteMs?: number } = {}) {
  const msg = String(text ?? '').trim();
  if (!msg) throw err(400, 'Nachricht fehlt.');
  const d = await ownRun(u, id);
  if (d.status === 'blocked_g0') throw err(409, `Strang ${id} wurde von G0 vor dem Bau gestoppt — erst die Rückfrage ${d.question ?? ''} im OLAF Workspace beantworten.`);
  // Leitstand (Plan 132, E3/B3): setzt den Deckel nicht zurück und hebt keinen Stopp auf — das entscheidet nur Knut.
  if (via === 'leitstand' && d.autoStopped) throw err(409, `Strang ${id} hat seinen Deckel erreicht — Knut entscheidet in „Heute“ (Fortsetzen/Anhalten).`);
  if (via === 'leitstand' && d.knutReviewedAt) throw err(409, `Strang ${id} hat Knut geprüft — nicht weiterführen; einen neuen Strang starten oder Knut fragen.`);
  const item = (await listOrch(u, { all: true })).find((r) => r.id === id);
  if (item?.status === 'running') {
    // Plan 154 (G13): in den laufenden Zug nachreichen — der Agent sieht es beim nächsten Schritt. Kein lastSentAt (sonst gälte
    // der Zug nach seinem Ende als „Nachricht nicht angekommen“), zählt nicht gegen den Deckel (Council R1, Bedingung 5).
    const r = await injectBridge(u, d.conv, msg);
    if (!r.ok) throw err(409, `Strang ${id} arbeitet noch (${item.reason}) und nimmt gerade nichts an (${r.error}) — gleich noch einmal.`);
    // Plan 274 (D4b): jede Nachreichung verfolgen (vorher nur die letzte — eine frühere ging so unbemerkt verloren).
    const eintrag = { id: r.id, text: msg.slice(0, 20_000), at: new Date(), via, done: false };
    await runs().updateOne({ _id: d._id }, { $set: { lastInject: eintrag }, $push: { nachreichungen: { $each: [eintrag], $slice: -10 } } as any, $inc: { injects: 1 } });
    return { id, conv: d.conv, url: d.url, injected: true, zustellung: 'nachgereicht (zugestellt; gelesen wird beim nächsten Schritt — ungelesen kommt sie nach dem Zug noch einmal als normale Nachricht)' };
  }
  // Plan 274 (D4a): ein anderer Strang arbeitet gerade im selben Worktree → nicht jetzt (sonst blockieren sich beide).
  if (!d.shared) {
    const k = worktreeKonflikt([worktreeVon(d.cwd)], (await belegte(u, id)).filter((a) => a.status === 'running'));
    if (k) throw err(409, `${konfliktText(k)} Die Nachricht an ${id} später noch einmal senden.`);
  }
  const sentAt = await deliver(u, d.conv, msg);
  if (via === 'leitstand') {
    // Teil B, G3: review_ready-Stand wandert nach prevReview (Auto-Fortsetzen und Wecken laufen wieder); Knuts Karte bleibt
    // (doneAt/knutReviewedAt unberührt); eine Ablage durch den Leitstand selbst hebt er damit auf.
    await runs().updateOne({ _id: d._id }, { $set: { lastSentAt: sentAt, lastSentText: msg.slice(0, 40_000), reviewReadyAt: null, review: null, ...(d.review ? { prevReview: { review: d.review, at: d.reviewReadyAt ?? new Date() } } : {}), ...(d.reviewedBy === 'leitstand' ? { reviewedAt: null, reviewedBy: null } : {}) }, $inc: { sends: 1, autoStreak: 1 } });
    return { id, conv: d.conv, url: d.url, ...(await bestaetigen(u, d.conv, sentAt, o.warteMs)) };
  }
  // Handnachricht: der Deckel beginnt neu, Stopp und review_ready sind aufgehoben (Council R1, Bedingung 4).
  // Teil B, F6: auch Karte, DoD-Tabellen und Knuts Prüfung sind damit weg (nach erneutem „fertig“ keine alte Tabelle).
  await runs().updateOne({ _id: d._id }, { $set: { lastSentAt: sentAt, lastSentText: msg.slice(0, 40_000), gruendlichAt: null, reviewedAt: null, reviewedBy: null, knutReviewedAt: null, reviewReadyAt: null, review: null, prevReview: null, doneAt: null, autoStreak: 0, autoStopped: null, ...(/^Nacharbeit nach Review:/.test(msg) ? { reworkAt: new Date(), reworkText: msg.slice(0, 500) } : {}) }, $inc: { sends: 1 } });
  await questions().updateMany({ userId: u.id, kind: 'auto-weiter', 'strand.id': d._id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date() } });
  return { id, conv: d.conv, url: d.url, ...(await bestaetigen(u, d.conv, sentAt, o.warteMs)) };
}

/** Wie lange `orch send` (CLI, Hauptchat) auf die Bestätigung wartet: ORCH_SEND_BESTAETIGEN_MS, Vorgabe 15 s. Knöpfe warten nicht. */
export const sendWarteMs = (env = process.env) => (env.ORCH_SEND_BESTAETIGEN_MS !== undefined && Number(env.ORCH_SEND_BESTAETIGEN_MS) >= 0 ? Number(env.ORCH_SEND_BESTAETIGEN_MS) : 15_000);

/** Bestätigung der Brücke abwarten (höchstens warteMs; 0 = nur einmal nachsehen). */
async function bestaetigen(u: User, conv: string, sentAt: Date, warteMs = 0): Promise<{ bestaetigt: boolean; zustellung: string }> {
  const ms = Math.max(0, warteMs);
  const bis = Date.now() + ms;
  let b: Bestaetigung = 'unterwegs';
  for (;;) {
    try { b = bestaetigung((await strandStates(u)).get(conv), sentAt.getTime()); } catch { /* Brücke weg: unterwegs */ }
    if (b !== 'unterwegs' || Date.now() >= bis) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { bestaetigt: b !== 'unterwegs', zustellung: BESTAETIGUNG_TEXT[b] };
}

/** „jetzt gründlich“ (Live-Modus, Plan 274 D1): der eine volle Durchlauf vor dem Push — Knopf, CLI und Hauptchat. */
export async function gruendlichOrch(u: User, id: string, via: 'hand' | 'leitstand' = 'hand') {
  const d = await ownRun(u, id);
  if (d.tiefe !== 'live') throw err(409, `Strang ${id} läuft nicht im Live-Modus (Tiefe ${d.tiefe ?? 'regular'}) — „jetzt gründlich“ gibt es nur dort.`);
  // Einmal je Runde (Doppelklick, Pass C): erst eine neue Handnachricht (neue Runde) setzt gruendlichAt zurück.
  const anspruch = await runs().updateOne({ _id: d._id, gruendlichAt: null }, { $set: { gruendlichAt: new Date() } });
  if (!anspruch.modifiedCount) throw err(409, `„Jetzt gründlich“ ist für ${id} schon angestoßen — der Durchlauf läuft.`);
  let r;
  try { r = await sendOrch(u, id, GRUENDLICH_TEXT, via); }
  catch (e) { await runs().updateOne({ _id: d._id }, { $set: { gruendlichAt: null } }); throw e; }
  await runs().updateOne({ _id: d._id }, { $set: { gruendlichAt: new Date() } });   // die Handnachricht hat es eben zurückgesetzt
  return { ...r, gruendlich: true };
}

// ---------- Nachreichen (docs/plan-hauptchat-monitor.md, S1) ----------

/** Nachricht an den laufenden Zug einer eigenen Unterhaltung nachreichen (Brücke, person:chat). */
export async function injectBridge(u: User, conv: string, text: string): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const r = await fetch(`${cfg.bridgeUrl}/internal/inject`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ userId: u.id, conv, text }), signal: AbortSignal.timeout(5000) });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: String(j.id) } : { ok: false, status: r.status, error: String(j.error ?? `Brücke antwortet mit ${r.status}`) };
}

/** Stand einer nachgereichten Nachricht: zugestellt | gelesen | ungelesen, null = unbekannt (z. B. nach einem Neustart der Brücke). */
export async function injectStateBridge(u: User, id: string): Promise<{ state: string; conv: string } | null> {
  const r = await fetch(`${cfg.bridgeUrl}/internal/inject/${encodeURIComponent(id)}?user=${encodeURIComponent(u.id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(4000) });
  if (r.status === 404) return null;
  if (!r.ok) throw err(502, `Brücke antwortet mit ${r.status}`);
  return (await r.json()) as any;
}

/**
 * Nachgereichte Nachricht an einen Strang, die der Zug nicht mehr gelesen hat (Abbruch, Zeitlimit, Frist): als normale Nachricht
 * nachsenden, sobald der Strang frei ist — genau einmal (Anspruch über lastInject.done). true = gesendet (dann kein „weiter“).
 */
async function nachzuegler(u: User, d: any, s: any, deps: AutoDeps): Promise<boolean> {
  if (s?.running) return false;
  // Plan 274 (D4b): alle offenen Nachreichungen, nicht nur die letzte; unbekannt (Brücke neu gestartet) wird mit Hinweis nachgesendet.
  const offen = injectsVon(d);
  if (!offen.length) return false;
  const staende = [];
  for (const li of offen) {
    const st = await injectStateBridge(u, li.id).catch(() => undefined);
    if (st === undefined) return false;   // Brücke weg: nächster Takt (nichts abhaken)
    if (st?.state === 'zugestellt') continue;   // noch offen (für den nächsten Versuch aufgehoben) — blockiert die anderen nicht (Pass C)
    staende.push({ li, st });
  }
  const nach: string[] = [];
  for (const { li, st } of staende) {
    const state = st?.state ?? 'unbekannt';
    const r1 = await runs().updateOne({ _id: d._id, 'nachreichungen.id': li.id }, { $set: { 'nachreichungen.$.done': true, 'nachreichungen.$.state': state } });
    const r2 = await runs().updateOne({ _id: d._id, 'lastInject.id': li.id, 'lastInject.done': false }, { $set: { 'lastInject.done': true, 'lastInject.state': state } });
    if (!r1.modifiedCount && !r2.modifiedCount) continue;   // ein anderer Takt war schneller
    if (nachsenden(st?.state ?? null)) nach.push(li.text);
  }
  if (!nach.length) return false;
  const text = `${NACHGEREICHT_HINWEIS}\n\n${nach.join('\n\n---\n\n')}`;
  // Vor dem Senden festhalten (wie autoOne): scheitert die Zustellung, schickt „nicht angekommen“ nach 3 min denselben Text noch einmal.
  await runs().updateOne({ _id: d._id }, { $set: { lastSentAt: new Date(), lastSentText: text.slice(0, 40_000) }, $inc: { sends: 1 } });
  deps.log?.('orch nachgereicht ungelesen → nachgesendet', { id: d._id, n: nach.length });
  await deliver(u, d.conv, text);
  return true;
}

/**
 * Nachgereichtes aus einem Chat, den Knut während des Zugs verlassen hat (Fix 17d, Fund 1): als nächste Nachricht GENAU in diese
 * Unterhaltung (nicht in den gerade offenen Chat). 409, solange dort ein Zug läuft oder eine Rückfrage wartet (der Client fragt
 * später erneut) — nie als Antwort auf eine ja/nein-Rückfrage. 404 = keine eigene Unterhaltung.
 */
export async function nachsendenInChat(u: User, conv: string, text: string): Promise<void> {
  const t = String(text ?? '').trim();
  if (!/^[0-9a-f-]{36}$/.test(conv)) throw err(400, 'Ungültige Unterhaltung.');
  if (!t) throw err(400, 'Nachricht fehlt.');
  if (t.length > 20_000) throw err(400, 'Nachricht zu lang (höchstens 20 000 Zeichen).');
  // Prüfen und Zustellen in einem Schritt je Unterhaltung: eine zweite gleichzeitige Zustellung sieht den Zug der ersten.
  return nacheinander(conv, async () => {
    const r = await fetch(`${cfg.bridgeUrl}/sessions?user=${encodeURIComponent(u.id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!r?.ok) throw err(502, `Brücke antwortet nicht (${r?.status ?? 'Netz'}).`);
    const s = (((await r.json().catch(() => ({}))) as any).sessions ?? []).find((x: any) => x.conv === conv);
    if (s && s.status !== 'bereit') throw err(409, s.status === 'wartet auf ja' ? 'Der Chat wartet auf „ja“ oder „nein“.' : 'In diesem Chat läuft noch ein Zug.');
    if (!(await lastMessage(u, conv))) throw err(404, 'Unterhaltung nicht gefunden.');
    await deliverNow(u, conv, t);
  }).then(() => undefined);
}

// Fix 17d, Fund 6: Zustellungen je Unterhaltung nacheinander (Weckruf, „weiter“, Nachzügler, Handnachricht, Nachsenden). Sonst
// lesen zwei gleichzeitige dieselbe letzte Nachricht als Eltern und hängen als Geschwister im Baum — LibreChat zeigt nur einen Zweig.
const zustellung = new Map<string, Promise<unknown>>();
function nacheinander<T>(conv: string, f: () => Promise<T>): Promise<T> {
  const vor = zustellung.get(conv) ?? Promise.resolve();
  const p = vor.catch(() => {}).then(f);
  const fertig = p.catch(() => {});
  zustellung.set(conv, fertig);
  void fertig.then(() => { if (zustellung.get(conv) === fertig) zustellung.delete(conv); });
  return p;
}

/**
 * Nachricht an den Chat hängen (Elternnachricht = letzte gespeicherte); LibreChat 409 = Zug noch nicht abgeschlossen. Liefert die
 * Sendezeit VOR dem erfolgreichen Senden (Plan 274, D4b): danach gemessen lag der Zugbeginn bei langsamem Speichern mehr als
 * 5 s davor — und die angekommene Nachricht galt nach dem Zug als „nicht angekommen“ (e422ab42: 16:13:57.458 vs. 16:14:02.574).
 */
export function deliver(u: User, conv: string, msg: string): Promise<Date> {
  return nacheinander(conv, () => deliverNow(u, conv, msg));
}
async function deliverNow(u: User, conv: string, msg: string): Promise<Date> {
  for (let i = 0; ; i++) {
    const last = await lastMessage(u, conv);
    if (!last) throw err(409, 'Im Chat ist noch keine Nachricht gespeichert.');
    try {
      const messageId = randomUUID();
      const sentAt = new Date();
      await createLibreChat(u, msg, { conversationId: conv, parentMessageId: last.id, messageId });
      // Erst weiter, wenn LibreChat die Nachricht gespeichert hat — die nächste Zustellung nimmt sie dann als Eltern (höchstens 5 s).
      for (let k = 0; k < 50 && !(await lc().collection('messages').findOne({ messageId, conversationId: conv }, { projection: { _id: 1 } })); k++) await new Promise((r) => setTimeout(r, 100));
      return sentAt;
    } catch (e: any) {
      if (e.status === 409 && i < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw err(e.status ?? 502, String(e.message ?? e));
    }
  }
}

export interface AutoDeps { userById: (id: string) => Promise<User | null>; accountFree: (u: User) => Promise<boolean>; log?: (msg: string, data: Record<string, unknown>) => void;
  /** Plan 274 (D4a): läuft ein anderer Strang im selben Worktree? Dann wartet das automatische „weiter“. */
  belegt?: (u: User, d: any) => Promise<boolean> }

let ticking = false;

/** Ein Durchgang über alle offenen Stränge (alle Personen). Läuft nie doppelt im Prozess (Council R1, Bedingung 3). */
export async function autoWeiterTick(deps: AutoDeps) {
  if (ticking) return;
  ticking = true;
  try {
    const docs: any[] = await runs().find({ ...STRANDS, reviewedAt: null, reviewReadyAt: null, startError: null, autoStopped: null, conv: { $ne: null }, status: { $ne: 'blocked_g0' }, startedAt: { $gt: new Date(Date.now() - 14 * 86400_000) } }).toArray();
    const byUser = new Map<string, any[]>();
    for (const d of docs) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
    for (const [userId, list] of byUser) {
      const u = await deps.userById(userId).catch(() => null);
      if (!u) continue;
      let states: Map<string, any>;
      try { states = await strandStates(u); } catch { continue; }   // Brücke weg: nichts entscheiden
      for (const d of list) {
        try { if (!(await nachzuegler(u, d, states.get(d.conv), deps))) await autoOne(u, d, states.get(d.conv), deps); } catch (e: any) { deps.log?.('orch-auto-weiter fehler', { id: d._id, error: String(e?.message ?? e).slice(0, 200) }); }
      }
    }
  } finally { ticking = false; }
}

async function autoOne(u: User, d: any, s: any, deps: AutoDeps) {
  if (s?.running) return;
  const last = await lastMessage(u, d.conv);
  const st = orchStatus(d, s, last);
  if (!st.cause) return;
  // Nur die Deckel-Frage hält an (Plan 154, G8). Sammel-Rückfragen des Hauptchats zum Strang nicht: ein technisches Zugende
  // heißt „mitten in der Arbeit“, Stränge warten nie auf eine Rückfrage (am 12.10. standen so vier Stränge still).
  const openQuestion = (await questions().countDocuments({ userId: u.id, 'strand.id': d._id, kind: 'auto-weiter', status: 'offen' })) > 0;
  const accountFree = st.cause === 'rate_limit' ? await deps.accountFree(u).catch(() => false) : false;
  const max = autoMaxFuer(tiefeOf(d.tiefe), autoMax());   // Plan 205: Budget je Tiefe
  const dec = autoWeiter(d, st, s, last, { now: Date.now(), openQuestion, accountFree, max });
  if (dec.action === 'stop') {
    const at = new Date();
    const r = await runs().updateOne({ _id: d._id, autoStopped: null }, { $set: { autoStopped: { at, reason: dec.why, cause: st.cause } } });
    if (!r.modifiedCount) return;
    // Eintrag in „Heute“: eine Rückfrage zum Strang (zählt in „Heute (n)“, blockiert weitere Fortsetzungen).
    let qid: string;
    do { qid = 'q-' + randomUUID().slice(0, 6); } while (await questions().findOne({ _id: qid as any }));
    await questions().insertOne({
      _id: qid, userId: u.id, kind: 'auto-weiter', title: `Strang „${d.title}“: ${dec.why}`.slice(0, 140),
      context: `Der Strang ${d._id} wurde ${max}-mal ohne Zutun fortgesetzt (zuletzt: ${CAUSE_TEXT[st.cause]}) und hält jetzt an. Arbeitsordner: ${d.cwd}.`,
      options: [{ label: 'Fortsetzen', consequence: 'Schickt „weiter“; der Zähler für den Deckel beginnt neu.' }, { label: 'Anhalten', consequence: 'Der Strang gilt als geprüft und läuft nicht weiter.' }],
      recommendation: 'Chat ansehen: kommt der Strang voran, „Fortsetzen“; dreht er sich im Kreis, „Anhalten“ und den Auftrag schärfen.',
      strand: { id: d._id, title: d.title, url: d.url }, link: d.url, plan: d.plan ?? null, createdAt: at, status: 'offen', answer: null,
    } as any);
    deps.log?.('orch-auto-weiter deckel', { id: d._id, max });
    return;
  }
  // Nicht fortgesetzt trotz technischem Zugende: Grund am Strang festhalten (einmal je Zug + Grund) — der Hauptchat liest
  // ihn in der Meldung „hängt“ (Plan 154, S3). Vorher blieb so ein Halt ohne jede Spur.
  if (dec.action === 'none' && (d.autoHold?.why !== dec.why || d.autoHold?.turn !== (s?.turn?.start ?? null))) {
    await runs().updateOne({ _id: d._id }, { $set: { autoHold: { why: dec.why, cause: st.cause, at: new Date(), turn: s?.turn?.start ?? null } } });
    deps.log?.('orch-auto-weiter halt', { id: d._id, cause: st.cause, why: dec.why });
  }
  if (dec.action !== 'send') return;
  // Plan 274 (D4a): arbeitet gerade ein anderer Strang im selben Worktree, wartet das „weiter“ (eingereiht bis zum nächsten Takt).
  if (!d.shared && deps.belegt && await deps.belegt(u, d)) return;
  // Anspruch (atomar, überlebt den Neustart) — mit lastSentAt: kommt die Nachricht nie an, greift nach 3 min „lost“ (Bedingung 2).
  const n = (d.autoStreak ?? 0) + 1;
  // lastSentAt unverändert (Council 154, Bedingung 5): hat inzwischen der Hauptchat oder Knut geschrieben, kein zweites „weiter“.
  // Plan 274 (D4b): „nicht angekommen“ → derselbe Text noch einmal (vorher nur „weiter“ — die eigentliche Nachricht war dann weg).
  const text = fortsetzText(st.cause, d.lastSentText, n, max);
  const r = await runs().updateOne({ _id: d._id, autoFor: d.autoFor ?? null, autoStopped: null, lastSentAt: d.lastSentAt ?? null },
    { $set: { autoFor: dec.key, lastSentAt: new Date(), lastSentText: text.slice(0, 40_000), autoLastAt: new Date(), autoLastCause: st.cause }, $inc: { autoTotal: 1, autoStreak: 1, sends: 1 } });
  if (!r.modifiedCount) return;
  deps.log?.('orch-auto-weiter', { id: d._id, cause: st.cause, n });
  await deliver(u, d.conv, text);
}

/** Für AutoDeps.belegt: läuft gerade ein anderer Strang im Worktree dieses Strangs? */
export async function worktreeBelegt(u: User, d: any): Promise<boolean> {
  return !!worktreeKonflikt([worktreeVon(d.cwd)], (await belegte(u, String(d._id))).filter((a) => a.status === 'running'));
}

/** Takt für autoWeiterTick (aus main.ts); ORCH_AUTO_WEITER=off schaltet ab. */
export function startAutoWeiter(deps: AutoDeps) {
  if (process.env.ORCH_AUTO_WEITER === 'off') return null;
  const ms = Math.max(200, Number(process.env.ORCH_AUTO_WEITER_TICK_MS) || 20_000);
  return setInterval(() => { autoWeiterTick(deps).catch((e) => deps.log?.('orch-auto-weiter fehler', { error: String(e?.message ?? e).slice(0, 200) })); }, ms);
}

/** Themen-Gruppe in der Seitenleiste von Hand setzen (Plan 154, S2); „auto“/leer = wieder automatisch. */
export async function setThema(u: User, id: string, thema: unknown) {
  const d = await ownRun(u, id);
  const t = cleanThema(thema);
  await runs().updateOne({ _id: d._id }, { $set: { thema: t } });
  return { id, thema: themaOf({ ...d, thema: t }), hand: !!t };
}

/** Geprüft: von Knut (CLI der Hauptsitzung, „Passt“, „Anhalten“) → knutReviewedAt; vom Leitstand → nur abgelegt (Teil B, G2). */
export async function reviewOrch(u: User, id: string, note = '', by: 'knut' | 'leitstand' = 'knut', expect: Record<string, unknown> = {}) {
  const d = await ownRun(u, id);
  const now = new Date();
  // expect: der gesehene Stand („Passt“ auf „Heute“) — hat er sich geändert, nichts tun (Council Teil B, Zeitfenster).
  const r = await runs().updateOne({ _id: d._id, ...expect }, { $set: { reviewedAt: now, reviewNote: String(note).slice(0, 500), ...(by === 'knut' ? { knutReviewedAt: now, reviewedBy: 'knut' } : { reviewedBy: 'leitstand' }) } });
  if (!r.matchedCount) throw err(409, 'Der Strang hat sich inzwischen geändert — Seite neu laden.');
  return { id, reviewed: true, by };
}

// ---------- Stand je Strang festschreiben (Teil B, G1) ----------
// „Heute“, der Zähler und die Übersicht lesen nur Mongo; dieser Takt schreibt den Stand aller offenen Stränge (auch abgelegter,
// review_ready- und gedeckelter), unabhängig vom Auto-Fortsetzen. Brücke oder LibreChat weg → nichts überschreiben.

let statusTicking = false;
export async function statusTick(deps: Pick<AutoDeps, 'userById' | 'log'>, now = Date.now()) {
  if (statusTicking) return;
  statusTicking = true;
  try {
    const docs: any[] = await runs().find({ ...STRANDS, ...OPEN, startError: null, conv: { $ne: null }, status: { $ne: 'blocked_g0' }, startedAt: { $gt: new Date(now - 14 * 86400_000) } }).toArray();
    const byUser = new Map<string, any[]>();
    for (const d of docs) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
    for (const [userId, list] of byUser) {
      const u = await deps.userById(userId).catch(() => null);
      if (!u) continue;
      let states: Map<string, any>;
      try { states = await strandStates(u); } catch { continue; }
      // Plan 213 S1b: offene Rückfragen je Unter-Chat (für „wartet auf dich“) und der Stand der Nachforderungen heute.
      const fragenJe = new Map<string, number>();
      for (const q of await questions().find({ userId, status: 'offen', 'strand.id': { $ne: null } }, { projection: { strand: 1 } }).toArray().catch(() => [] as any[])) {
        const k = String((q as any).strand?.id ?? ''); if (k) fragenJe.set(k, (fragenJe.get(k) ?? 0) + 1);
      }
      const heuteWien = wienDatum(now);
      const tagBeginn = wienUm(heuteWien, 0);   // Wiener Mitternacht, nicht die Zeitzone des Servers (Pass C)
      let nachgefordertHeute = statusNeu() ? await runs().countDocuments({ userId, 'standNachgefordert.at': { $gte: tagBeginn } }).catch(() => 0) : 0;
      const seit = statusNeu() ? await statusNeuSeit(now) : now;
      for (const d of list) {
        // Schon fertig nach der letzten Nachricht an den Strang: ohne neue Nachricht ändert sich nichts (Last, Council Teil B).
        // … aber nur, wenn seitdem kein Zug lief (Knut schreibt direkt im Chat) und der Bericht schon gefunden ist (Council-Diff B R2).
        // Teil C (H2): Bericht-Kopf, Diagramm, Commit-Abgleich und Vorschau-Links — auch für fertige Stränge, vor dem Übersprung.
        // Plan 274 (D8): falsch zugeordneten Bericht auf das eigene Paket umstellen (einmalig, danach stimmt es).
        const heil = paketHeilung(d);
        if (heil && (await runs().updateOne({ _id: d._id }, { $set: heil }).catch(() => null))?.modifiedCount) { Object.assign(d, heil); deps.log?.('bericht neu zugeordnet', { id: d._id, paket: heil.paket }); }
        try { const ks = await kopfPflege(d, now); if (Object.keys(ks).length) { await runs().updateOne({ _id: d._id }, { $set: ks }); Object.assign(d, ks); } }
        catch (e: any) { deps.log?.('bericht-kopf fehler', { id: d._id, error: String(e?.message ?? e).slice(0, 160) }); }
        const sd = states.get(d.conv);
        if (d.lastStatus === 'done' && d.doneAt && d.bericht && new Date(d.doneAt).getTime() > new Date(d.lastSentAt ?? d.startedAt).getTime() && !sd?.running && (sd?.turn?.end ?? 0) <= new Date(d.doneAt).getTime()) {
          // Plan 213 S1b: „done“ heißt Marke „fertig“ — der Zustand fehlt nur bei Unter-Chats von vor der Umstellung.
          // Eine später gestellte Rückfrage macht aus „fertig“ wieder „wartet“ (und umgekehrt) — je Takt neu, nicht eingefroren (Pass C).
          const soll = (fragenJe.get(String(d._id)) ?? 0) > 0 ? 'wartet' : 'fertig';
          if (d.zustand !== soll && d.zustand !== 'erledigt') await runs().updateOne({ _id: d._id, zustand: d.zustand ?? null }, { $set: { zustand: soll, zustandGrund: soll === 'wartet' ? 'Rückfrage an dich' : 'Agent meldet „fertig“', marke: 'fertig' } }).catch(() => {});
          continue;
        }
        try {
          const s = states.get(d.conv);
          const last = await lastMessage(u, d.conv);
          const st = orchStatus(d, s, last, now);
          const set: Record<string, unknown> = { lastStatus: st.status, lastReason: st.reason, statusAt: new Date(now),
            lastActivity: new Date(Math.max(s?.turn?.end ?? 0, s?.turn?.start ?? 0, last?.at ?? 0) || now), lastExcerpt: last && !last.fromUser ? excerpt(last.text, 600) : '' };
          // Tatsächlich gelaufenes Modell des letzten Zugs (Plan 162, S4) für den Strang-Kopf.
          if (typeof s?.turn?.modell === 'string') set.lastModell = s.turn.modell.slice(0, 100);
          // Plan 205: zuletzt gemeldete ETA festhalten — eine Antwort ohne ETA-Zeile löscht sie nicht.
          const eta = last && !last.fromUser ? etaMark(last.text, last.at) : null;
          if (eta && eta !== new Date(d.eta?.at ?? 0).getTime()) set.eta = { at: new Date(eta), gemeldetAt: new Date(last!.at) };
          // „fertig“ zählt nur mit einer Antwort NACH der letzten Nachricht an den Strang (G1: nach Nacharbeit nicht die alte).
          if (st.status === 'done' && last && last.at > new Date(d.lastSentAt ?? d.startedAt).getTime() && (!d.doneAt || new Date(d.doneAt).getTime() < last.at)) set.doneAt = new Date(last.at);
          // Ohne eigenes Paket: der Bericht aus review_ready, sonst der zuletzt genannte in der Antwort (Vorarbeit steht meist vorne).
          if (!d.bericht) { const b = findBericht([...(d.review?.artefakte ?? [])]) ?? findBericht([last && !last.fromUser ? last.text : ''], true); if (b) set.bericht = b; }
          // Plan 213 S1b: neuer Zustand (eine Statusquelle) — im Schattenbetrieb nur berechnet und verglichen (P2).
          const marke = last && !last.fromUser ? statusMark(last.text) : null;
          const zugEnde = typeof s?.turn?.end === 'number' ? s.turn.end : null;
          // Nachgefordert und seitdem keine Antwort MIT Marke → offen (zählt für „hängt?“ nach 30 min und gegen eine zweite Nachforderung).
          const offenNach = !!d.standNachgefordert && !marke;
          const nachAt = offenNach ? new Date(d.standNachgefordert.at).getTime() : null;
          const z = zustandAus({ status: st.status, reason: st.reason, cause: st.cause, queued: s?.queued ?? null, marke, offeneFragen: fragenJe.get(String(d._id)) ?? 0, nachgefordertAt: nachAt }, now);
          set.zustand = z.zustand; set.zustandGrund = z.grund; set.marke = marke;
          if (marke && d.standNachgefordert) set.standNachgefordert = null;   // wieder eine Marke: nächste Lücke darf nachgefordert werden
          const ab = abweichung(st.status, z.zustand);
          if (ab) await wb().collection('meta').updateOne({ _id: `status_schatten:${heuteWien}` as any }, { $addToSet: { [`paare.${ab}`]: String(d._id) } }, { upsert: true }).catch(() => {});
          // Nur, wenn inzwischen keine neue Nachricht an den Strang ging (sonst käme mit der alten Antwort ein altes doneAt zurück).
          await runs().updateOne({ _id: d._id, lastSentAt: d.lastSentAt ?? null }, { $set: set });
          // „Stand fehlt“ → den Stand nachfordern (nur neuer Modus, nie rückwirkend, ≤ 10/Tag, je Unter-Chat einmal bis zur nächsten
          // Marke; nie in die Inbox — K2). Der Vermerk erst nach erfolgreichem Senden (Pass C).
          if (nachfordern({ zustand: z.zustand, neu: statusNeu(), zugEnde, seit, schonFuerZug: d.standNachgefordert?.zug ?? null, heute: nachgefordertHeute, offen: offenNach })) {
            try {
              await sendOrch(u, String(d._id), NACHFORDER_TEXT, 'leitstand');
              await runs().updateOne({ _id: d._id }, { $set: { standNachgefordert: { zug: zugEnde, at: new Date(now) } } });
              nachgefordertHeute++;
              deps.log?.('stand nachgefordert', { id: d._id });
            } catch (e: any) { deps.log?.('stand nachfordern fehler', { id: d._id, error: String(e?.message ?? e).slice(0, 160) }); }
          }
        } catch (e: any) { deps.log?.('orch-status fehler', { id: d._id, error: String(e?.message ?? e).slice(0, 160) }); }
      }
    }
  } finally { statusTicking = false; }
}

/** Seit wann der neue Zustand gilt (beim ersten Takt im neuen Modus festgehalten) — nichts davor wird nachgefordert (P2). */
export async function statusNeuSeit(now = Date.now()): Promise<number> {
  const r: any = await wb().collection('meta').findOneAndUpdate({ _id: 'status_neu' as any }, { $setOnInsert: { seit: new Date(now) } }, { upsert: true, returnDocument: 'after' });
  return new Date((r?.value ?? r)?.seit ?? now).getTime();
}

/** Schattenbetrieb (P2): je Tag, welche Unter-Chats alt und neu verschieden einordnen („wartet→stand-fehlt“: n). */
export async function statusSchatten(tage = 7, now = Date.now()) {
  const ab = wienDatum(now - tage * 86400_000);
  const docs: any[] = await wb().collection('meta').find({ _id: { $gte: `status_schatten:${ab}`, $lt: 'status_schatten;' } as any }).toArray();
  return docs.map((d) => ({ tag: String(d._id).slice(16), paare: Object.fromEntries(Object.entries(d.paare ?? {}).map(([k, v]) => [k, (v as string[]).length])) })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Takt für statusTick (aus main.ts), unabhängig von ORCH_AUTO_WEITER; ORCH_STATUS=off schaltet ab. */
export function startStatusTick(deps: Pick<AutoDeps, 'userById' | 'log'>) {
  if (process.env.ORCH_STATUS === 'off') return null;
  const ms = Math.max(200, Number(process.env.ORCH_AUTO_WEITER_TICK_MS) || 20_000);
  return setInterval(() => { statusTick(deps).catch((e) => deps.log?.('orch-status fehler', { error: String(e?.message ?? e).slice(0, 200) })); }, ms);
}

// ---------- Rückfragen an Knut (Knut, 09.10.2026: „Wenn du Fragen hast, kannst du mir über die Werkbank eine
// Notification senden — für alle Dinge, wo du wirklich Input brauchst“) ----------
//
// Der Orchestrator legt eine Entscheidungsfrage an (Titel, Kontext, Optionen mit Folgen, Empfehlung, Bezug zu Strang/
// Plan). Sie erscheint in der Werkbank unter Heute → „Wartet auf dich“ und zählt in „Heute (n)“; Knut antwortet
// dort (Option und/oder Freitext); der Orchestrator liest die Antwort über die CLI. Regel: nur, was wirklich Knuts
// Entscheidung ist — nichts, was der Orchestrator selbst klären, nachlesen oder sicher entscheiden kann.

export interface AskInput { title: string; context: string; options?: { label: string; consequence?: string }[]; recommendation: string; strand?: string | null; link?: string | null; plan?: string | null;
  /** Stabiler Schlüssel (z. B. `<slug>#G0`): offen oder beantwortet → keine zweite Frage (409). */
  key?: string | null;
  /** Herkunft; für Automaten (`drift`) höchstens AUTO_PRO_TAG neue Fragen je Tag (429). */
  quelle?: string | null;
  g0?: { kriterien: string[]; ergebnis: string; belege?: string[] } | null;
  /** Wichtigkeit (Knut 17.10.): „wichtig“ = Knut muss selbst entscheiden; „normal“ stuft eine Regel-Einstufung nie herunter (stufe.ts). */
  stufe?: 'wichtig' | 'normal' | null }

export const AUTO_PRO_TAG = 5;

export const questions = () => wb().collection('orchestrator_questions');

export async function askKnut(u: User, inp: AskInput) {
  const title = String(inp.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const context = String(inp.context ?? '').trim().slice(0, 2000);
  const recommendation = String(inp.recommendation ?? '').trim().slice(0, 600);
  if (!title || !context || !recommendation) throw err(400, 'Rückfrage braucht Titel, Kontext und Empfehlung (Regel: nur echte Entscheidungen, mit eigener Empfehlung).');
  const options = (Array.isArray(inp.options) ? inp.options : []).slice(0, 6).map((o) => ({ label: String(o?.label ?? '').trim().slice(0, 120), consequence: String(o?.consequence ?? '').trim().slice(0, 400) })).filter((o) => o.label);
  if (new Set(options.map((o) => o.label)).size !== options.length) throw err(400, 'Optionen müssen verschieden heißen.');
  let strand: { id: string; title: string; url: string } | null = null;
  if (inp.strand) {
    const r: any = await runs().findOne({ _id: String(inp.strand) as any, userId: u.id, ...STRANDS });
    if (!r) throw err(404, `Strang ${inp.strand} gibt es nicht.`);
    strand = { id: r._id, title: r.title, url: r.url };
  }
  const link = inp.link ? String(inp.link).slice(0, 500) : null;
  if (link && !/^(https?:\/\/|\/)/.test(link)) throw err(400, 'Link muss mit http(s):// oder / beginnen.');
  const key = inp.key ? String(inp.key).trim() : null;
  if (key && !/^[\w.-]{2,100}#[\w-]{1,20}$/.test(key)) throw err(400, 'Schlüssel hat die Form <slug>#<kennung>, z. B. kohorte-laufender-monat#G0.');
  const quelle = inp.quelle ? String(inp.quelle).slice(0, 30) : null;
  if (key) {
    const da: any = await questions().findOne({ userId: u.id, keyActive: key });
    if (da) throw Object.assign(err(409, `Schlüssel ${key} ist schon ${da.status} (${da._id}) — keine zweite Frage.`), { existing: String(da._id) });
  }
  if (quelle === 'drift') {
    const n = await questions().countDocuments({ userId: u.id, quelle, day: vienna().date });
    if (n >= AUTO_PRO_TAG) throw err(429, `Tageskappe: schon ${n} neue Rückfragen von „${quelle}“ heute (höchstens ${AUTO_PRO_TAG}).`);
  }
  let id: string;
  do { id = 'q-' + randomUUID().slice(0, 6); } while (await questions().findOne({ _id: id as any }));
  const doc: any = { _id: id, userId: u.id, title, context, options, recommendation, strand, link, plan: inp.plan ? String(inp.plan).slice(0, 500) : null, createdAt: new Date(), status: 'offen', answer: null,
    ...(key ? { key, keyActive: key } : {}), ...(quelle ? { quelle, day: vienna().date } : {}), ...(inp.g0 ? { g0: inp.g0 } : {}), ...(inp.stufe === 'wichtig' || inp.stufe === 'normal' ? { stufe: inp.stufe } : {}) };
  try { await questions().insertOne(doc); }
  catch (e: any) { if (e?.code === 11000) throw err(409, `Schlüssel ${key} ist schon vergeben — keine zweite Frage.`); throw e; }
  return publicQuestion(doc);
}

export function publicQuestion(d: any) {
  return { id: String(d._id), kind: d.kind ?? 'frage', title: d.title, context: d.context, options: d.options ?? [], recommendation: d.recommendation, strand: d.strand ?? null, link: d.link ?? null, plan: d.plan ?? null, createdAt: d.createdAt, status: d.status, answer: d.answer ?? null, key: d.key ?? null, quelle: d.quelle ?? null, stufe: d.stufe ?? null };
}

export async function listQuestions(u: User, opts: { open?: boolean; limit?: number } = {}) {
  const docs = await questions().find({ userId: u.id, ...(opts.open ? { status: 'offen' } : {}) }).sort({ createdAt: -1 }).limit(opts.limit ?? 50).toArray();
  return docs.map(publicQuestion);
}

export async function getQuestion(u: User, id: string) {
  const d = await questions().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, `Rückfrage ${id} gibt es nicht.`);
  return publicQuestion(d);
}

/** Knut antwortet (Werkbank-Oberfläche): Option und/oder Freitext. Eine beantwortete Frage bleibt beantwortet. */
export async function answerQuestion(u: User, id: string, a: { option?: string | null; text?: string | null; by?: string }) {
  const d: any = await questions().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, 'Diese Rückfrage gibt es nicht.');
  if (d.status !== 'offen') throw err(409, d.status === 'beantwortet' ? 'Schon beantwortet.' : 'Vom Orchestrator zurückgezogen.');
  const option = a.option ? String(a.option) : null;
  const text = String(a.text ?? '').trim().slice(0, 4000);
  if (option && !(d.options ?? []).some((o: any) => o.label === option)) throw err(400, 'Unbekannte Option.');
  if (!option && !text) throw err(400, 'Option wählen oder Antwort schreiben.');
  const answer = { option, text, at: new Date(), by: a.by ?? u.email };
  const r = await questions().updateOne({ _id: id as any, status: 'offen' }, { $set: { status: 'beantwortet', answer } });
  if (!r.modifiedCount) throw err(409, 'Schon beantwortet.');
  // G0: jeder gewählte Knopf ins Protokoll (Fehlalarme, Kriterium „anderer Autor“ gesondert — DoD 13, 25).
  if (typeof d.key === 'string' && d.key.endsWith('#G0')) protokolliere({ art: 'knopf', slug: d.key.slice(0, -3), knopf: option ?? 'Freitext', text: text.slice(0, 200), kriterien: d.g0?.kriterien ?? [], ergebnis: d.g0?.ergebnis ?? null, frage: id, durch: u.email });
  // Deckel der automatischen Fortsetzung: die Antwort wirkt sofort auf den Strang.
  let action: string | null = null;
  if (d.kind === 'auto-weiter' && d.strand?.id && option) {
    try {
      if (option === 'Fortsetzen') { await sendOrch(u, d.strand.id, 'weiter'); action = 'fortgesetzt'; }
      if (option === 'Anhalten') { await reviewOrch(u, d.strand.id, 'angehalten nach dem Deckel der automatischen Fortsetzung'); action = 'angehalten'; }
    } catch (e: any) { action = `nicht ausgeführt: ${String(e.message ?? e).slice(0, 200)}`; }
  }
  // Budget je Strang (Plan 209, S3.2): „Weiter mit +50 %“ hebt das Budget und setzt fort, „Anhalten“ legt den Strang ab.
  if (d.kind === 'budget' && d.strand?.id && option) {
    try {
      if (option.startsWith('Weiter')) {
        const r: any = await runs().findOne({ _id: d.strand.id as any });
        const alt = budgetVon(r);   // dasselbe Budget, an dem der Strang angehalten hat (inkl. Faktor der Tiefe)
        await runs().updateOne({ _id: d.strand.id as any }, { $set: { budgetTokens: Math.ceil(alt * 1.5), autoStopped: null, 'budget.stopAt': null } });
        await sendOrch(u, d.strand.id, 'weiter (Budget um 50 % erhöht)'); action = 'fortgesetzt';
      }
      if (option === 'Anhalten') { await reviewOrch(u, d.strand.id, 'angehalten: Budget erreicht'); action = 'angehalten'; }
    } catch (e: any) { action = `nicht ausgeführt: ${String(e.message ?? e).slice(0, 200)}`; }
  }
  // Regel-Vorschlag aus den Reviews (Plan 274, Zusatz A): „Übernehmen“ schreibt die Regel für das Pre-Push-Gate fest.
  if (d.kind === 'regel-vorschlag' && d.regel && option === 'Übernehmen') {
    try { action = regelBestaetigen({ ...d.regel, key: d.key ?? undefined, frage: id }, a.by ?? u.email) ? 'übernommen' : 'nicht ausgeführt: WERKBANK_REGEL_DIR fehlt'; }
    catch (e: any) { action = `nicht ausgeführt: ${String(e.message ?? e).slice(0, 200)}`; }
  }
  // Leitstand-Deckel (Plan 132, A4): „Fortsetzen“ zählt ab jetzt neu; die Antwort selbst wird sofort zugestellt (leitstand.ts).
  if ((d.kind === 'leitstand-deckel' || d.kind === 'leitstand-weiter') && option === 'Fortsetzen') {
    await runs().updateOne({ userId: u.id, kind: 'leitstand', endedAt: null }, { $set: d.kind === 'leitstand-deckel' ? { capResetAt: new Date() } : { weiterStreak: 0, weiterStopped: null } });
    action = 'fortgesetzt';
  }
  return { ...publicQuestion({ ...d, status: 'beantwortet', answer }), ...(action ? { action } : {}) };
}

export async function withdrawQuestion(u: User, id: string) {
  // Deckel-Fragen entscheidet nur Knut (Council-Diff R1): der Leitstand darf sie nicht über orch_questions wegräumen.
  const q: any = await questions().findOne({ _id: id as any, userId: u.id });
  if (q && /^(auto-weiter|budget|leitstand-)/.test(String(q.kind ?? ''))) throw err(409, 'Diese Rückfrage entscheidet nur Knut (Deckel) — zurückziehen nicht möglich.');
  const r = await questions().updateOne({ _id: id as any, userId: u.id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date() }, $unset: { keyActive: '' } });
  if (!r.matchedCount) throw err(409, 'Keine offene Rückfrage mit dieser Kennung.');
  return { id, status: 'zurückgezogen' };
}

// ---------- G0-Tor (docs/plan-vorbau-check.md) ----------
//
// Vor jedem Code-Bau (orch start --code, Nachtbau): vorbau-check. frei/fortsetzen → bauen, die Belege stehen im Chat.
// Treffer oder Stopp → kein Bau und EINE Rückfrage `<slug>#G0` mit den Knöpfen; gebaut wird danach nur über Knuts Antwort
// in der Werkbank („trotzdem bauen“, „auf Vorhandenem aufsetzen“, tagsüber „ohne PR-Prüfung bauen“), protokolliert.
// Nachts baut ein Stopp nie (Nachtbau aus) und fragt nicht je Item — der Nachtbau legt einen einzigen Morgeneintrag an.

export interface G0Public { ergebnis: string; text: string; belege: { text: string; pr?: string; sha?: string }[]; kriterien: string[]; stopp: string | null; question: string | null }
export interface G0Tor { go: boolean; slug: string; text: string; ergebnis: VorbauErgebnis; question: string | null; public: G0Public }
const BAUEN = new Set(['trotzdem bauen', 'auf Vorhandenem aufsetzen']);

/** Repos im Umfang: das Repo des Arbeitsordners und WERKBANK_VORBAU_REPOS (Komma), ohne Dubletten. */
export function g0Repos(cwd: string | null, env = process.env): string[] {
  const out = new Set<string>();
  for (const d of [cwd, ...(env.WERKBANK_VORBAU_REPOS ?? '').split(',')].map((x) => (x ?? '').trim()).filter(Boolean)) { try { out.add(realpathSync(d)); } catch { out.add(d); } }
  return [...out];
}

/** Kennungen der Treffer-Belege (PR-Link, sonst SHA, sonst Repo:Pfad) — woran eine Antwort gebunden ist. */
export const belegIds = (r: VorbauErgebnis) => r.belege.filter((b) => b.wirkung === 'treffer').map((b) => b.pr ?? b.sha ?? `${b.repo}:${b.pfad ?? b.branch ?? b.text}`);
/** Dasselbe aus einem Fragetext (Rückfragen von drift über `orch ask`, ohne strukturierte Belege). */
export const belegIdsAusText = (t: string) => [...t.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|\b[0-9a-f]{40}\b|[\w.-]+:(?:plans|docs)\/[\w.-]+\.md/g)].map((m) => m[0]);

/** Slug aus --slug oder dem Plan (`spec:`, sonst **Spec:**, sonst Plan-Slug). */
export function g0Slug(slug: string | null | undefined, plan: string | null | undefined): string {
  if (slug && String(slug).trim()) return String(slug).trim();
  if (plan) { try { const p = parsePlan(readFileSync(plan, 'utf8'), plan); return p.spec ?? p.specHeader ?? p.planSlug ?? ''; } catch { /* unten */ } }
  return '';
}

export async function g0Tor(u: User, o: { slug: string | null; plan: string | null; cwd: string | null; aufrufer: string; nachts?: boolean; strand?: string | null; title?: string }): Promise<G0Tor> {
  const slug = g0Slug(o.slug, o.plan);
  if (!slug) throw err(400, 'G0 (Prüfung vor dem Bau) braucht --slug <spec-slug> oder eine Plandatei mit `spec:` — ohne Identität kein Code-Bau.');
  const repos = g0Repos(o.cwd);
  let r = await pruefe({ slug, planDatei: o.plan, repos, aufrufer: o.aufrufer });
  const key = `${slug}#G0`;
  const mk = (go: boolean, text: string, q: string | null): G0Tor => ({ go, slug, text, ergebnis: r, question: q, public: { ergebnis: r.ergebnis, text: g0Text(r), belege: r.belege.map((b) => ({ text: b.text, pr: b.pr, sha: b.sha })), kriterien: r.kriterien, stopp: r.stopp?.grund ?? null, question: q } });
  if (r.ergebnis === 'frei' || r.ergebnis === 'fortsetzen') return mk(true, g0Text(r), null);
  if (o.nachts && r.ergebnis === 'stopp') return mk(false, `G0 nachts nicht prüfbar (${r.stopp!.grund}) — Nachtbau aus. ${r.stopp!.text}`, null);
  let da: any = await questions().findOne({ userId: u.id, keyActive: key });
  // Eine Antwort gilt nur für die Belege, die Knut gesehen hat: neue Treffer-Belege → die alte Frage ist überholt,
  // es gibt eine neue (sonst würde ein altes „trotzdem bauen“ einen später aufgetauchten fremden PR durchwinken).
  if (da?.status === 'beantwortet' && r.ergebnis === 'treffer') {
    const gesehen = new Set<string>(da.g0?.belege ?? belegIdsAusText(String(da.context ?? '')));
    if (belegIds(r).some((x) => !gesehen.has(x))) {
      await questions().updateOne({ _id: da._id, keyActive: key }, { $unset: { keyActive: '' }, $set: { ueberholtAt: new Date() } });
      da = null;
    }
  }
  if (da?.status === 'beantwortet') {
    const opt = da.answer?.option ?? '';
    const qid = String(da._id);
    const h = vienna().hour;
    if (opt === OHNE_PR && r.stopp?.grund === 'pr-api' && !o.nachts && h >= 6 && h < 22) {   // nur tagsüber
      r = await pruefe({ slug, planDatei: o.plan, repos, aufrufer: o.aufrufer, ohnePr: true });
      if (r.ergebnis === 'frei' || r.ergebnis === 'fortsetzen') { protokolliere({ art: 'override', slug, knopf: opt, aufrufer: o.aufrufer, frage: qid }); return mk(true, `${g0Text(r)}\nKnut hat „${OHNE_PR}“ gewählt (Rückfrage ${qid}, protokolliert).`, qid); }
      return mk(false, `G0: auch ohne PR-Prüfung ein Treffer, Rückfrage ${qid} ist aber schon beantwortet — kein Bau.\n${g0Text(r)}`, qid);
    }
    if (BAUEN.has(opt)) {
      protokolliere({ art: 'override', slug, knopf: opt, aufrufer: o.aufrufer, frage: qid });
      return mk(true, `${g0Text(r)}\nKnut hat „${opt}“ gewählt (Rückfrage ${qid}, protokolliert)${opt === 'auf Vorhandenem aufsetzen' ? ' — auf dem gefundenen Branch/PR aufsetzen, nicht neu bauen.' : '.'}`, qid);
    }
    return mk(false, `G0: Knut hat auf Rückfrage ${qid} „${opt || 'Freitext'}“ geantwortet — kein Bau.${da.answer?.text ? ` (${String(da.answer.text).slice(0, 200)})` : ''}`, qid);
  }
  if (da) return mk(false, `G0 ${r.ergebnis === 'stopp' ? 'Stopp' : 'Treffer'} — Rückfrage ${da._id} wartet noch auf Knut.\n${g0Text(r)}`, String(da._id));
  const treffer = r.ergebnis === 'treffer';
  const q = await askKnut(u, {
    key, quelle: o.aufrufer.split(' ')[0], strand: o.strand ?? null, plan: o.plan,
    title: treffer ? `Schon gebaut oder in Arbeit? „${o.title || slug}“` : `Vor dem Bau nicht prüfbar: „${o.title || slug}“`,
    context: `${o.title ? `Auftrag: ${o.title}\n` : ''}Spec: ${slug}\n${g0Text(r)}`,
    options: g0Optionen(r, o.nachts),
    recommendation: treffer
      ? (r.belege.some((b) => b.wirkung === 'treffer' && (b.art === 'baut' || b.art === 'autor')) ? 'auf Vorhandenem aufsetzen — erst mit dem anderen PR abstimmen' : 'Spec nachziehen/abräumen — die Arbeit liegt schon vor')
      : r.stopp!.knopf ? `${OHNE_PR}, wenn es eilt — sonst warten, bis die PR-API wieder antwortet` : 'warten, bis das neue Lesetoken da ist; „trotzdem bauen“ nur, wenn es eilt',
    g0: { kriterien: r.kriterien, ergebnis: r.ergebnis, belege: belegIds(r) },
  }).catch((e: any) => { if (e.status === 409) return null; throw e; });
  return mk(false, `G0 ${treffer ? 'Treffer' : 'Stopp'} — kein Bau. Rückfrage ${q?.id ?? key} im OLAF Workspace (Heute → Wartet auf dich).\n${g0Text(r)}`, q?.id ?? null);
}

// ---------- Nachtbau (DoD 9, 17, 24) ----------
//
// Aufrufer: `scripts/orch nachtbau --queue <datei>` (Cron, Patch in review-pakete/129-vorbau-check/patches/). Die Datei
// hält die von Knut freigegebenen Items (JSONL: slug, title, cwd, plan, prompt). Je Item G0; Treffer → Strang `blocked_g0`
// (sichtbar in „Heute“, mit der Rückfrage `<slug>#G0`) und weiter mit dem nächsten Item. Ist G0 nicht prüfbar
// (Lesetoken, Fetch, PR-API) → kein Bau, und genau EIN Morgeneintrag „G0 nachts nicht prüfbar“ je Nacht.

/** Für „Heute“: vor dem Bau gestoppte Stränge mit Belegen und dem Stand ihrer Rückfrage. */
export async function g0Blocked(u: User) {
  const docs: any[] = await runs().find({ userId: u.id, status: 'blocked_g0', reviewedAt: null }).sort({ startedAt: -1 }).limit(20).toArray();
  const out = [];
  for (const d of docs) {
    const q: any = d.question ? await questions().findOne({ _id: d.question, userId: u.id }) : null;
    out.push({ id: String(d._id), title: d.title, slug: d.slug, origin: d.origin ?? null, startedAt: d.startedAt, g0: d.g0 ?? null,
      question: q ? { id: String(q._id), status: q.status, option: q.answer?.option ?? null } : null });
  }
  return out;
}

export interface NachtItem { slug?: string | null; title: string; prompt: string; cwd: string; plan?: string | null }
export type NachtStatus = 'gestartet' | 'blocked_g0' | 'verworfen' | 'nicht geprüft' | 'fehler';

export async function nachtbau(u: User, items: NachtItem[], datum = vienna().date) {
  if (vorbauAus()) throw err(409, 'G0 ist abgeschaltet (WERKBANK_VORBAU_CHECK=off) — der Nachtbau baut ohne Prüfung nicht.');
  const out: { slug: string; title: string; status: NachtStatus; id?: string; question?: string | null; text: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const slug = g0Slug(it.slug, it.plan);
    const title = String(it.title ?? '').slice(0, 80);
    let tor: G0Tor;
    try { tor = await g0Tor(u, { slug: it.slug ?? null, plan: it.plan ?? null, cwd: it.cwd, aufrufer: 'nachtbau', nachts: true, title }); }
    catch (e: any) { out.push({ slug, title, status: 'fehler', text: String(e.message ?? e).slice(0, 300) }); continue; }
    if (!tor.go && tor.ergebnis.ergebnis === 'stopp') {
      // Nicht prüfbar: dieses und alle folgenden Items bleiben liegen; ein Eintrag je Nacht, nicht je Item.
      const rest = items.slice(i);
      const q = await askKnut(u, {
        key: `g0-nachts#${datum}`, quelle: 'nachtbau', title: `G0 nachts nicht prüfbar — ${rest.length} Item(s) nicht gebaut`,
        context: `${tor.ergebnis.stopp!.text}\n\nNicht gebaut (bleiben in der Warteschlange):\n${rest.map((x) => `- ${x.title}${x.slug ? ` (${x.slug})` : ''}`).join('\n')}`,
        recommendation: tor.ergebnis.stopp!.grund === 'lesetoken' ? 'GitHub-Lesetoken prüfen (WERKBANK_GITHUB_TOKEN oder Vaultwarden „View only github API“, dasselbe wie der PR-Ticker); die Items laufen in der nächsten Nacht.' : 'Ursache beheben; die Items laufen in der nächsten Nacht.',
      }).catch((e: any) => { if (e.status === 409) return null; throw e; });
      for (const x of rest) out.push({ slug: g0Slug(x.slug, x.plan), title: String(x.title ?? '').slice(0, 80), status: 'nicht geprüft', question: q?.id ?? null, text: 'G0 nachts nicht prüfbar' });
      break;
    }
    if (!tor.go) {
      const q: any = tor.question ? await questions().findOne({ _id: tor.question as any, userId: u.id }) : null;
      if (q?.status === 'beantwortet') {
        await runs().updateMany({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null }, { $set: { reviewedAt: new Date(), reviewNote: `verworfen: ${q.answer?.option ?? 'Freitext'}` } });
        out.push({ slug, title, status: 'verworfen', question: tor.question, text: tor.text });
        continue;
      }
      const open: any = await runs().findOne({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null });
      const id = open?._id ?? await newId();
      const set = { userId: u.id, conv: null, url: null, title, cwd: it.cwd, plan: it.plan ?? null, prompt: String(it.prompt ?? '').slice(0, 500), status: 'blocked_g0', slug, g0: tor.public, question: tor.question, origin: 'nachtbau', reviewedAt: null };
      if (open) await runs().updateOne({ _id: id }, { $set: set });
      else await runs().insertOne({ _id: id, ...set, startedAt: new Date(), lastSentAt: new Date(), sends: 0 } as any);
      if (tor.question) await questions().updateOne({ _id: tor.question as any, strand: null }, { $set: { strand: { id, title, url: null } } });
      out.push({ slug, title, status: 'blocked_g0', id, question: tor.question, text: tor.text });
      continue;
    }
    try {
      const r = await startOrch(u, { title, prompt: it.prompt, cwd: it.cwd, plan: it.plan ?? null, code: true, slug: tor.slug, aufrufer: 'nachtbau', g0: tor });
      // Ein früher blockierter Strang derselben Spec ist damit erledigt.
      await runs().updateMany({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null }, { $set: { reviewedAt: new Date(), reviewNote: `gestartet als ${r.id}` } });
      out.push({ slug, title, status: 'gestartet', id: r.id, question: tor.question, text: tor.text });
    } catch (e: any) { out.push({ slug, title, status: 'fehler', text: String(e.message ?? e).slice(0, 300) }); }
  }
  return out;
}
