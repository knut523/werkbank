// Kontingent auf einen Blick (R31 Nachtrag 2, Knut 02.11.2026: „wenn Melious so niedrig läuft, müssen wir das sehen“) und die
// automatische Modellwahl (`auto` in WERKBANK_REGULAR_MODELL / _QUICK_MODELL / WERKBANK_ZUARBEIT, tiefe.ts modellVorgaben).
// Melious: Rest in % aus dem Füllstand (echt aus dem Dashboard, sonst geschätzt) bzw. dem Monatsdeckel; Sperre = 0.
// Claude: je Konto (Reihenfolge der Person: Chat-Schlüssel → weitere) erschöpft bis … / frei, Züge heute aus zug_log.
// Jede Umschaltung von auto geht als Meldung an den Hauptchat und steht in der Anzeige — nie still.

import { wb } from './db.ts';
import type { User } from './auth.ts';
import { autoWahl, kontingentSchwelle, modellVorgaben, type KontingentLage, type Zuarbeit } from './tiefe.ts';

export interface MeliousTeil { restProzent: number | null; geschaetzt: boolean; sperre: string | null; monat: { model: string; energie: number; turns: number }[]; monatProzent: number | null; fuellProzent?: number | null; heuteEnergie?: number | null; nachfuellungTag?: number | null }
export interface KontoTeil { id: string; label: string; erschoepftBis: number | null; zuegeHeute: number }
export interface Kontingent { melious: MeliousTeil | null; claude: KontoTeil[]; schwelle: number; wahl: Zuarbeit; auto: string[]; zeile: string }

/** Melious-Rest in % (rein) aus meliousUsage: Sperre → 0, sonst Füllstand, sonst Monatsdeckel. */
export function meliousRestProzent(use: { sperre?: string | null; energie?: { fuell?: number | null } | null; monat?: { pct?: number } | null } | null): number | null {
  if (!use) return null;
  if (use.sperre) return 0;
  const f = use.energie?.fuell;
  if (typeof f === 'number' && Number.isFinite(f)) return Math.max(0, Math.min(100, Math.round(f * 100)));
  const p = use.monat?.pct;
  return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, 100 - p)) : null;
}

/** Council 07.11. (3): Luft vor dem Strangstart (rein) — frei, solange ein Claude-Konto nicht erschöpft ist; ohne Kontenliste frei. */
export function claudeLuft(konten: { id: string; label: string }[], ex: Record<string, number>, now: number): { frei: boolean; bis: number | null; text: string | null } {
  if (!konten.length) return { frei: true, bis: null, text: null };
  const bis = konten.map((k) => ex[k.id] ?? 0);
  if (bis.some((t) => !(t > now))) return { frei: true, bis: null, text: null };
  const frueh = Math.min(...bis);
  return { frei: false, bis: frueh, text: `Kein Claude-Konto frei (alle erschöpft, das erste wieder ab ${uhr(frueh)}) — Strang nicht gestartet, damit er nicht gleich am Deckel hängt. Ab dann neu starten oder ausdrücklich mit Melious (modell melious:…).` };
}
export const luftPruefungAn = (env: Record<string, string | undefined> = process.env) => String(env.WERKBANK_KONTINGENT_PRUEFUNG ?? '').trim().toLowerCase() !== 'aus';

export interface ClaudeAuslastung { fuenfH: number | null; siebenT: number | null; reset: string | null }
/**
 * Release 2.0 (B3, Knut 07.11.): Warnungen für 2.0 (rein) — Melious hart aus, gesperrt (Deckel oder Untergrenze), Energie unter
 * 10 %, und Claude unter 20 % frei (5-h- oder Wochenfenster laut cswap ≥ 80 % verbraucht) bzw. alle Konten erschöpft.
 */
export function warnungenAus(o: { melious: MeliousTeil | null; hartAus: boolean; konten: KontoTeil[]; auslastung: ClaudeAuslastung | null; now: number }): string[] {
  const w: string[] = [];
  if (o.hartAus) w.push('Melious ist hart ausgeschaltet (WERKBANK_MELIOUS=aus) — alles läuft auf Claude.');
  const m = o.melious;
  if (m?.sperre) w.push(`Melious gesperrt: ${m.sperre}.`);
  // Hauptsitzung 07.11.: Verbrauch heute über dem Tagesnachladen → der Topf sinkt (Notgrenze 5 % ist die einzige harte Sperre).
  if (m && typeof m.heuteEnergie === 'number' && typeof m.nachfuellungTag === 'number' && m.nachfuellungTag > 0 && m.heuteEnergie > m.nachfuellungTag)
    w.push(`Melious-Verbrauch heute ${Math.round(m.heuteEnergie).toLocaleString('de-DE')} Energie liegt über dem Tagesnachladen (${m.nachfuellungTag.toLocaleString('de-DE')}) — der Topf sinkt.`);
  if (m && typeof m.fuellProzent === 'number' && m.fuellProzent < 10) w.push(`Melious-Energie ${m.geschaetzt ? 'geschätzt ' : ''}bei ${m.fuellProzent} % (unter 10 %) — nachladen.`);
  if (o.konten.length && o.konten.every((k) => k.erschoepftBis && k.erschoepftBis > o.now)) w.push(`Alle Claude-Konten erschöpft — das erste wieder ab ${uhr(Math.min(...o.konten.map((k) => k.erschoepftBis!)))}.`);
  else {
    const a = o.auslastung;
    const knapp = [a?.fuenfH != null && a.fuenfH >= 80 ? `5 h ${a.fuenfH} %` : null, a?.siebenT != null && a.siebenT >= 80 ? `Woche ${a.siebenT} %` : null].filter(Boolean);
    if (knapp.length) w.push(`Claude-Kontingent knapp (unter 20 % frei): ${knapp.join(' · ')} verbraucht${a?.reset ? `, 5 h frei ab ${a.reset}` : ''} — neue Stränge wechseln bei rate_limit sofort aufs nächste Konto.`);
  }
  return w;
}

/** Lage für die automatische Wahl (rein). */
export const lageAus = (mel: MeliousTeil | null, konten: KontoTeil[], now: number): KontingentLage => ({
  meliousRest: mel ? mel.restProzent : null,
  claudeFrei: konten.some((k) => !(k.erschoepftBis && k.erschoepftBis > now)),
});

const uhr = (t: number) => new Date(t).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

/** Eine Zeile für Kopfleiste und Werkzeug `auslastung` (rein). */
export function kontingentZeile(k: Omit<Kontingent, 'zeile'>, now: number): string {
  const m = k.melious;
  const mel = !m ? 'Melious: nicht eingerichtet'
    : m.sperre ? `Melious: gesperrt (${m.sperre})`
    : `Melious: ${m.restProzent === null ? 'Rest unbekannt' : `${m.restProzent} % Rest${m.geschaetzt ? ' (geschätzt)' : ''}`}${m.restProzent !== null && m.restProzent < k.schwelle ? ` — unter der Schwelle ${k.schwelle} %` : ''}`;
  const cl = k.claude.length
    ? `Claude: ${k.claude.map((c) => `${c.label} ${c.erschoepftBis && c.erschoepftBis > now ? `erschöpft bis ${uhr(c.erschoepftBis)}` : 'frei'} (${c.zuegeHeute} Züge heute)`).join(' · ')}`
    : 'Claude: kein Konto';
  const wahl = k.auto.length ? ` · auto (${k.auto.join(', ')}) → ${k.wahl === 'melious' ? 'Melious' : 'Claude'}` : '';
  return `${mel} · ${cl}${wahl}`;
}

/** Umschalttext, wenn sich die automatische Wahl ändert (rein); null = keine Änderung. */
export function umschaltText(vorher: Zuarbeit | null, jetzt: Zuarbeit, l: KontingentLage, schwelle: number): string | null {
  if (!vorher || vorher === jetzt) return null;
  const grund = jetzt === 'claude'
    ? `Melious-Rest ${l.meliousRest ?? '?'} % liegt unter der Schwelle ${schwelle} %`
    : !l.claudeFrei ? 'alle Claude-Konten sind erschöpft' : `Melious-Rest ${l.meliousRest} % liegt wieder über der Schwelle ${schwelle} %`;
  return `Modellwahl automatisch umgeschaltet: ${vorher === 'melious' ? 'Melious' : 'Claude'} → ${jetzt === 'melious' ? 'Melious' : 'Claude'} (${grund}). Gilt für neue Stränge und die Zuarbeit; laufende Stränge behalten ihr Modell.`;
}

/** Beginn des heutigen Tages in Wien (für „Züge heute“). */
export function wienTagesbeginn(now: number): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const vergangen = (+p.hour * 60 + +p.minute) * 60_000 + (now % 60_000);
  return new Date(now - vergangen);
}

export interface KontingentDeps {
  konten: (u: User) => Promise<{ id: string; label: string }[]>;
  erschoepft: (u: User) => Promise<Record<string, number>>;
  meliousUsage: (u: User) => Promise<any | null>;
  /** Hauptchat-Meldung bei einer Umschaltung (meldeLeitstand). */
  melde: (u: User, text: string) => Promise<void>;
  /** Claude-Auslastung (cswap über die Brücke); fehlt = unbekannt. */
  auslastung?: () => Promise<ClaudeAuslastung | null>;
  env?: Record<string, string | undefined>;
}

const stand = () => wb().collection('kontingent_wahl');

/** Kontingent der Person; prüft die automatische Wahl und meldet eine Umschaltung (einmal je Wechsel, über den Neustart hinweg). */
export async function kontingent(u: User, d: KontingentDeps, now = Date.now()): Promise<Kontingent> {
  const env = d.env ?? process.env;
  const [liste, ex, use] = await Promise.all([d.konten(u).catch(() => []), d.erschoepft(u).catch(() => ({} as Record<string, number>)), d.meliousUsage(u).catch(() => null)]);
  const ab = wienTagesbeginn(now);
  const zuege: any[] = await wb().collection('zug_log').aggregate([
    { $match: { userId: u.id, anbieter: 'claude', at: { $gte: ab } } }, { $group: { _id: '$konto', n: { $sum: 1 } } },
  ]).toArray().catch(() => []);
  const proLabel = Object.fromEntries(zuege.map((z) => [String(z._id), z.n as number]));
  const claude: KontoTeil[] = liste.map((a) => ({ id: a.id, label: a.label, erschoepftBis: ex[a.id] > now ? ex[a.id] : null, zuegeHeute: proLabel[a.label] ?? 0 }));
  const melious: MeliousTeil | null = use ? {
    restProzent: meliousRestProzent(use), geschaetzt: !!use.energie?.geschaetzt, sperre: use.sperre ?? null,
    monat: (use.modelle ?? []).filter((m: any) => m.energie > 0 || m.turns > 0).map((m: any) => ({ model: m.model, energie: m.energie, turns: m.turns })),
    monatProzent: typeof use.monat?.pct === 'number' ? use.monat.pct : null,
    fuellProzent: typeof use.energie?.fuell === 'number' ? Math.round(use.energie.fuell * 100) : null,
    heuteEnergie: typeof use.heute?.energie === 'number' ? use.heute.energie : null, nachfuellungTag: typeof use.energie?.nachfuellungTag === 'number' ? Math.round(use.energie.nachfuellungTag) : null,
  } : null;
  const schwelle = kontingentSchwelle(env);
  const lage = lageAus(melious, claude, now);
  const v = modellVorgaben(env, lage);
  const wahl = autoWahl(lage, schwelle);
  const basis = { melious, claude, schwelle, wahl, auto: v.auto };
  if (v.auto.length) {
    const alt: any = await stand().findOne({ _id: u.id as any }).catch(() => null);
    if (!alt || alt.wahl !== wahl) {
      // Gegenprüfung R31: nur melden, wenn genau DIESER Wechsel gespeichert wurde (kein Endlos-Melden bei DB-Fehlern,
      // keine Doppelmeldung bei parallelen Aufrufen — Bedingung auf den alten Wert).
      const geschrieben = await stand().updateOne(alt ? { _id: u.id as any, wahl: alt.wahl } : { _id: u.id as any }, { $set: { wahl, at: new Date(now) } }, { upsert: !alt })
        .then((r) => r.modifiedCount + r.upsertedCount > 0, () => false);
      const text = umschaltText(alt?.wahl ?? null, wahl, lage, schwelle);
      if (geschrieben && text) await d.melde(u, text).catch(() => {});
    }
  }
  return { ...basis, zeile: kontingentZeile(basis, now) };
}

/** Echte Quellen (dynamisch importiert: creds/leitstand/orchestrator importieren dieses Modul selbst). */
export function standardDeps(): KontingentDeps {
  return {
    konten: async (u) => (await import('./creds.ts')).listClaudeAccounts(u),
    erschoepft: async (u) => {
      const [{ cfg }, { internalHeaders }] = await Promise.all([import('./config.ts'), import('./orchestrator.ts')]);
      const r = await fetch(`${cfg.bridgeUrl}/internal/accounts-state?user=${encodeURIComponent(u.id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(1500) });
      return r.ok ? (((await r.json()) as any).exhausted ?? {}) : {};
    },
    meliousUsage: async (u) => {
      const m = await import('./melious.ts');
      const s = await m.meliousSettings(u);
      return s.configured && s.enabled ? m.meliousUsage(u) : null;
    },
    melde: async (u, text) => { await (await import('./leitstand.ts')).meldeLeitstand(u, { _id: 'kontingent', title: 'Kontingent' }, text); },
    auslastung: async () => {
      const [{ cfg }, { internalHeaders }] = await Promise.all([import('./config.ts'), import('./orchestrator.ts')]);
      const r = await fetch(`${cfg.bridgeUrl}/internal/auslastung-stand`, { headers: internalHeaders(), signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
      const j: any = await r.json();
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return { fuenfH: n(j.fuenfH), siebenT: n(j.siebenT), reset: typeof j.reset === 'string' ? j.reset.slice(0, 20) : null };
    },
  };
}

/** Release 2.0 (B3): Warnungen der Person für 2.0; bei Fehlern leer (Warnungen blockieren nie eine Seite). */
export async function warnungenFuer(u: User, d: KontingentDeps = standardDeps(), now = Date.now()): Promise<string[]> {
  try {
    const [k, a, m] = await Promise.all([kontingent(u, d, now), (d.auslastung ? d.auslastung() : Promise.resolve(null)).catch(() => null), import('./melious.ts')]);
    return warnungenAus({ melious: k.melious, hartAus: m.meliousHartAus(d.env ?? process.env), konten: k.claude, auslastung: a, now });
  } catch { return []; }
}

/** Wird `auto` irgendwo genutzt? Nur dann braucht der Strangstart die (langsamere) Lage. */
export const autoAktiv = (env: Record<string, string | undefined> = process.env) =>
  [env.WERKBANK_REGULAR_MODELL, env.WERKBANK_QUICK_MODELL, env.WERKBANK_ZUARBEIT].some((v) => String(v ?? '').trim() === 'auto');

/** Lage für den Strangstart/die Brücke; null bei Fehlern (modellVorgaben fällt dann auf Melious zurück). */
export async function lageFuer(u: User, d: KontingentDeps = standardDeps(), now = Date.now()): Promise<KontingentLage | null> {
  try { const k = await kontingent(u, d, now); return lageAus(k.melious, k.claude, now); } catch { return null; }
}

/** R32 (Nachtrag 4): Lage für das Routing nach Klassen — mit Sperre und echt/geschätzt; null bei Fehlern (dann gilt die alte Vorgabe). */
export async function routingLageFuer(u: User, d: KontingentDeps = standardDeps(), now = Date.now()): Promise<{ meliousRest: number | null; claudeFrei: boolean; meliousSperre: boolean; geschaetzt: boolean } | null> {
  try { const k = await kontingent(u, d, now); const l = lageAus(k.melious, k.claude, now); return { meliousRest: l.meliousRest, claudeFrei: l.claudeFrei, meliousSperre: !!k.melious?.sperre, geschaetzt: !!k.melious?.geschaetzt }; } catch { return null; }
}
/** Letzter Anbieter je Person für die Hysterese (Lesen) — wird bei jeder Routing-Entscheidung festgehalten. */
export async function letzterAnbieter(userId: string, neu?: 'claude' | 'melious'): Promise<'claude' | 'melious' | null> {
  const col = wb().collection('routing_zuletzt');
  if (neu) { await col.updateOne({ _id: userId as any }, { $set: { anbieter: neu, at: new Date() } }, { upsert: true }).catch(() => {}); return neu; }
  const d: any = await col.findOne({ _id: userId as any }).catch(() => null);
  return d?.anbieter === 'claude' || d?.anbieter === 'melious' ? d.anbieter : null;
}
