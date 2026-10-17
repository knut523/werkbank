// Arbeit › Unter-Chats (Plan 213 S4a): eine Tabelle statt Karten — Zustand aus der einen Statusquelle (S1b), Tiefe, ETA,
// zuletzt aktiv; „Erledigt“ als Filter (automatisch weggeräumt oder abgehakt, 14 Tage, mit Zurückholen). Dazu „Neuer Unter-Chat“
// aus der Oberfläche: Auftrag, Repo (aus der Liste WERKBANK_ARBEIT_REPOS, sonst WERKBANK_VORBAU_REPOS), Tiefe — das Review-Paket
// bekommt die nächste freie Nummer. Gestartet wird über denselben Weg wie `orch start` (G0, frischer Worktree, Tiefe/ETA).

import { readdirSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { etaFuer, istTiefe, TIEFEN, type Tiefe } from './tiefe.ts';
import { themaOf } from './themen.ts';
import { ZUSTAND_TEXT, type Zustand } from './zustand.ts';

const ALT: Record<string, Zustand> = { running: 'laeuft', done: 'fertig', failed: 'haengt', waiting: 'wartet', blocked_g0: 'blockiert' };
const sicher = (u: unknown) => (/^https?:\/\//.test(String(u ?? '')) ? String(u) : null);

/** Eine Zeile der Tabelle (rein). */
export function zeile(d: any, o: { mediane?: Record<Tiefe, number | null> | null; now?: number } = {}) {
  const zustand: Zustand = d.reviewedAt && (d.reviewedBy === 'auto' || d.knutReviewedAt) ? 'erledigt' : (d.zustand as Zustand) ?? ALT[d.lastStatus] ?? 'laeuft';
  const fertig = zustand === 'fertig' || zustand === 'erledigt';
  const eta = etaFuer(d, { fertig, mediane: o.mediane ?? null, now: o.now });
  return {
    id: String(d._id), titel: String(d.title ?? '(ohne Titel)'), thema: themaOf(d), zustand, zustandText: ZUSTAND_TEXT[zustand], grund: String(d.zustandGrund ?? d.lastReason ?? ''),
    tiefe: istTiefe(d.tiefe) ? d.tiefe : 'regular', eta: fertig ? null : { text: eta.text, ueberfaellig: eta.ueberfaellig },
    zuletzt: d.lastActivity ?? d.statusAt ?? d.startedAt ?? null, chat: sicher(d.url), paket: d.paket ?? null, bericht: !!d.bericht,
    autoWeg: d.reviewedBy === 'auto', abgehakt: !!d.knutReviewedAt,
  };
}

/** Reihenfolge: was dich braucht zuerst, dann was hängt, dann was läuft; innerhalb nach „zuletzt“. */
const RANG: Record<Zustand, number> = { wartet: 0, blockiert: 1, fertig: 2, haengt: 3, 'stand-fehlt': 4, schlange: 5, laeuft: 6, erledigt: 7 };
export function sortiere<T extends { zustand: Zustand; zuletzt: any }>(z: T[]): T[] {
  return [...z].sort((a, b) => RANG[a.zustand] - RANG[b.zustand] || +new Date(b.zuletzt ?? 0) - +new Date(a.zuletzt ?? 0));
}

/** Repos für „Neuer Unter-Chat“: nur aus der Konfiguration, nie aus der Anfrage (der Server nimmt den Pfad aus dieser Liste). */
export function repos(env = process.env): { name: string; pfad: string }[] {
  const liste = (env.WERKBANK_ARBEIT_REPOS || env.WERKBANK_VORBAU_REPOS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out: { name: string; pfad: string }[] = [];
  for (const p of liste) { try { const r = realpathSync(p); if (!out.some((x) => x.pfad === r)) out.push({ name: basename(r), pfad: r }); } catch { /* fehlt: weglassen */ } }
  return out;
}

/** Nächste freie Paketnummer und ein Ordnername aus dem Titel („214-workspace-ablage“). */
export function naechstesPaket(reviewDir: string, titel: string): string {
  let max = 0;
  try { for (const n of readdirSync(reviewDir)) { const m = /^(\d{1,4})-/.exec(n); if (m) max = Math.max(max, Number(m[1])); } } catch { /* leer */ }
  const slug = titel.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'auftrag';
  return `${max + 1}-${slug}`;
}

/** Eingaben für „Neuer Unter-Chat“ prüfen und in einen Start für startOrch übersetzen. */
export function startEingabe(b: any, o: { repos: { name: string; pfad: string }[]; reviewDir: string }): { title: string; prompt: string; cwd: string; code: boolean; tiefe: Tiefe; paket: string } {
  const auftrag = String(b?.auftrag ?? '').trim();
  if (auftrag.length < 10) throw Object.assign(new Error('Schreib in ein, zwei Sätzen, was fertig sein soll.'), { status: 400 });
  if (auftrag.length > 8000) throw Object.assign(new Error('Auftrag zu lang (höchstens 8000 Zeichen) — Details als Datei ins Paket.'), { status: 400 });
  const repo = o.repos.find((r) => r.name === String(b?.repo ?? ''));
  if (!repo) throw Object.assign(new Error('Repo aus der Liste wählen.'), { status: 400 });
  const tiefe = String(b?.tiefe ?? 'regular');
  if (!istTiefe(tiefe)) throw Object.assign(new Error(`Tiefe: ${TIEFEN.join(', ')}.`), { status: 400 });
  const title = String(b?.titel ?? '').trim().slice(0, 100) || auftrag.split('\n')[0].replace(/\s+/g, ' ').slice(0, 80);
  const paket = naechstesPaket(o.reviewDir, title);
  const prompt = `${auftrag}\n\nPaket: \`~/work/knut/review-pakete/${paket}/\` (gestartet aus dem Workspace, Arbeit › Neuer Unter-Chat).`;
  return { title, prompt, cwd: repo.pfad, code: true, tiefe: tiefe as Tiefe, paket };
}
