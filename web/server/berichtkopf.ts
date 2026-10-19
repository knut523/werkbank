// Bericht-Kopf (docs/plan-leitstand.md, Teil C, D1): fester YAML-Kopf oben im bericht.md, den Strang, Leitstand und „Heute“ gleich
// lesen. Der Kopf ist Selbstauskunft des Strangs (Council C R1, H1) — er bestimmt, wo eine Karte steht, aber „Auf GitHub“ zählt
// nur mit einer Freigabe aus der Werkbank. Alles hier ist rein (testbar), ohne Datei- oder Netzzugriff.
import { parse as parseYaml } from 'yaml';

export type KopfStatus = 'bereit_fuer_github' | 'wartet_auf_knut' | 'blockiert';
export interface KopfReview { titel: string; url?: string; login?: string; screenshot?: string; pr_text?: string }
export interface KopfFrage { id: string; frage: string; empfehlung: string; antwort: string; stufe?: 'wichtig' | 'normal'; worum?: string; optionen?: string[] }
export interface KopfGithub { repo: string; zweig: string; commit: string; was?: string; pr_text?: string; pr?: string }
// Exec Summary (C.7): titel, worum, anders; „Was du tun musst“ ist `offen`.
export interface Kopf { status: KopfStatus; titel: string; worum: string; anders: string[]; offen: string[]; review: KopfReview[]; fragen: KopfFrage[]; github: KopfGithub[] }

const STATUS = new Set<KopfStatus>(['bereit_fuer_github', 'wartet_auf_knut', 'blockiert']);
const str = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n) : '');
const httpUrl = (v: unknown) => { const s = str(v, 500); return /^https?:\/\/[^\s"'<>`]+$/i.test(s) ? s : ''; };
// Bild-/Textpfade nur relativ im Paket (kein /, kein .., kein Schema).
const relPath = (v: unknown) => { const s = str(v, 200); return s && !/^[\/~]|^[a-z][a-z0-9+.-]*:|(^|\/)\.\.(\/|$)|\\/i.test(s) ? s : ''; };

/** YAML-Kopf (zwischen den ersten `---`-Zeilen) → Kopf | { fehler } | null (kein Kopf). Unbekanntes wird verworfen, Längen begrenzt. */
export function berichtKopf(text: string | null | undefined): Kopf | { fehler: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text ?? ''));
  if (!m) return null;
  let y: any;
  try { y = parseYaml(m[1], { maxAliasCount: 0 }); } catch (e: any) { return { fehler: `YAML unlesbar: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}` }; }
  if (!y || typeof y !== 'object' || Array.isArray(y)) return { fehler: 'Kopf ist kein Objekt.' };
  if (!STATUS.has(y.status)) return { fehler: `status muss bereit_fuer_github, wartet_auf_knut oder blockiert sein (steht: ${str(y.status, 40) || 'leer'}).` };
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const offen = list(y.offen).map((x) => str(x, 200)).filter(Boolean).slice(0, 5);
  const anders = list(y.anders).map((x) => str(x, 200)).filter(Boolean).slice(0, 4);
  const review: KopfReview[] = list(y.review).slice(0, 12).map((r: any) => {
    if (!r || typeof r !== 'object') return null;
    const e: KopfReview = { titel: str(r.titel, 120) };
    const url = httpUrl(r.url), login = httpUrl(r.login), screenshot = relPath(r.screenshot), pr = relPath(r.pr_text);
    if (url) e.url = url; if (login) e.login = login; if (screenshot) e.screenshot = screenshot; if (pr) e.pr_text = pr;
    return e.url || e.login || e.screenshot || e.pr_text ? e : null;
  }).filter((x): x is KopfReview => !!x);
  const fragen: KopfFrage[] = list(y.fragen).slice(0, 10).map((f: any, i: number) => {
    if (!f || typeof f !== 'object') return null;
    const frage = str(f.frage, 600);
    if (!frage) return null;
    const id = /^(D\d{1,3}|E-\d{1,4}-\d{1,3}|F\d{1,3})$/.test(str(f.id, 20)) ? str(f.id, 20) : `F${i + 1}`;
    // Entscheidungsseite (Knut 19.10.): worum = 2–4 Sätze ohne Codes, optionen = Liste — beides optional.
    const worum = str(f.worum, 800), optionen = list(f.optionen).slice(0, 6).map((o: unknown) => str(o, 200)).filter(Boolean);
    return { id, frage, empfehlung: str(f.empfehlung, 600), antwort: str(f.antwort, 600), ...(f.stufe === 'wichtig' || f.stufe === 'normal' ? { stufe: f.stufe } : {}), ...(worum ? { worum } : {}), ...(optionen.length ? { optionen } : {}) };
  }).filter((x): x is KopfFrage => !!x);
  const github: KopfGithub[] = list(y.github).slice(0, 6).map((g: any) => {
    if (!g || typeof g !== 'object') return null;
    const repo = str(g.repo, 120), zweig = str(g.zweig, 160), commit = str(g.commit, 40).toLowerCase();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    const e: KopfGithub = { repo, zweig, commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : '' };
    const was = str(g.was, 160); if (was) e.was = was;
    const pt = relPath(g.pr_text); if (pt) e.pr_text = pt;
    const pr = str(g.pr, 300); if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr)) e.pr = pr;
    return e;
  }).filter((x): x is KopfGithub => !!x);
  return { status: y.status, titel: str(y.titel, 200), worum: str(y.worum, 600), anders, offen, review, fragen, github };
}

/** Was der Exec Summary fehlt (C.7) — Hinweis auf der Karte, kein Fehler. */
export function kopfMaengel(kopf: Kopf | { fehler: string } | null | undefined, diagramm: string | null | undefined): string[] {
  if (!kopf || !('status' in kopf)) return [];
  const m: string[] = [];
  if (!kopf.titel) m.push('titel');
  if (!kopf.worum) m.push('worum');
  if (!kopf.anders.length) m.push('anders');
  if (kopf.github.some((g) => !g.was)) m.push('github.was');
  if (!diagramm) m.push('Mermaid-Diagramm');
  return m;
}

export type PrStand = 'offen' | 'gemergt' | 'geschlossen' | 'fehlt' | 'unbekannt';
export interface PrCheck { url: string; stand: PrStand; titel?: string }
export interface PrZeile { repo: string; label: string; url: string | null; was: string; stand: PrStand | 'lokal'; text: string }

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;
/** github.com/<owner>/<repo>/pull/<n> → Teile; sonst null. */
export function prTeile(url: string | null | undefined): { owner: string; name: string; nr: number } | null {
  const m = PR_URL.exec(String(url ?? ''));
  return m ? { owner: m[1], name: m[2], nr: Number(m[3]) } : null;
}

const STAND_TEXT: Record<PrStand | 'lokal', string> = {
  offen: 'offen', gemergt: 'gemergt', geschlossen: 'geschlossen (nicht gemergt)', fehlt: 'gibt es auf GitHub nicht (oder kein Lesezugriff)',
  unbekannt: 'Stand nicht geprüft', lokal: 'lokal, nicht auf GitHub',
};

/**
 * PR-Tabelle der Exec Summary (C.7, B2/B3): je `github`-Eintrag eine Zeile. Der Stand kommt nur aus der Prüfung gegen GitHub
 * (`checks`), nie aus dem Bericht; ohne PR-Link „lokal, nicht auf GitHub“; ein PR, den GitHub nicht kennt, bekommt keinen Link.
 * `freigabePr` = PR-URL einer gepushten Werkbank-Freigabe (gilt für den ersten Eintrag, wenn der Bericht noch keinen nennt).
 */
export function prTabelle(kopf: Kopf | { fehler: string } | null | undefined, checks: PrCheck[] | null | undefined, freigabePr?: string | null): PrZeile[] {
  if (!kopf || !('status' in kopf)) return [];
  const byUrl = new Map((checks ?? []).map((c) => [c.url, c]));
  return kopf.github.map((g, i) => {
    const url = g.pr ?? (i === 0 && prTeile(freigabePr) ? freigabePr! : null);
    const t = prTeile(url);
    if (!url || !t) return { repo: g.repo, label: `${g.repo.split('/').pop()} · ${g.zweig || '?'}`, url: null, was: g.was ?? '', stand: 'lokal' as const, text: STAND_TEXT.lokal };
    const stand: PrStand = byUrl.get(url)?.stand ?? 'unbekannt';
    return { repo: g.repo, label: `${t.name}#${t.nr}`, url: stand === 'fehlt' ? null : url, was: g.was ?? '', stand, text: STAND_TEXT[stand] };
  });
}

/** Erstes ```mermaid-Diagramm im Bericht (Text, höchstens 20 000 Zeichen) — für „Diagramm ansehen“ auf der Karte. */
export function ersterMermaid(text: string | null | undefined): string | null {
  const m = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/m.exec(String(text ?? ''));
  return m ? m[1].slice(0, 20_000) : null;
}

export type Spalte = 'entscheiden' | 'ansehen' | 'github';

/**
 * Spalte einer Karte auf „Heute“ (C4, H1/H3): offene Fragen oder blockiert → Entscheiden; aktive oder gepushte Freigabe → Auf GitHub;
 * sonst Ansehen (auch `bereit_fuer_github` ohne Freigabe — Selbstauskunft allein reicht nicht).
 */
export function spalte(kopf: Kopf | { fehler: string } | null | undefined, opts: { offeneFragen: number; freigabe: boolean; pr?: boolean }): Spalte {
  // pr = ein PR, den GitHub als offen oder gemergt meldet (C.7) — ein Link im Bericht allein zählt nicht.
  if (kopf && 'status' in kopf && (kopf.status === 'blockiert' || opts.offeneFragen > 0)) return 'entscheiden';
  if (opts.freigabe || opts.pr) return 'github';
  return 'ansehen';
}

/** Offene Fragen: im Kopf ohne Antwort und für diesen Bericht-Stand noch nicht über die Werkbank beantwortet (H3). */
export function offeneFragen(kopf: Kopf | { fehler: string } | null | undefined, beantwortet: { berichtHash?: string; ids?: string[] } | null | undefined, hash: string | null | undefined): KopfFrage[] {
  if (!kopf || !('status' in kopf)) return [];
  const schon = beantwortet && beantwortet.berichtHash === hash ? new Set(beantwortet.ids ?? []) : new Set<string>();
  return kopf.fragen.filter((f) => !f.antwort && !schon.has(f.id));
}

/** Stimmt der Commit im Kopf (Präfix ≥ 7) mit dem echten Kopf des Zweigs überein? null = nichts zu vergleichen. */
export function commitPasst(kopfCommit: string | null | undefined, head: string | null | undefined): boolean | null {
  if (!kopfCommit || !head || kopfCommit.length < 7) return null;
  return head.toLowerCase().startsWith(kopfCommit.toLowerCase());
}

/** Exec Summary eines Strangs (C.7) für Karte und Berichtsanzeige: Kopf, PR-Tabelle mit GitHub-Stand (Mongo), Mängel. */
export function execSummary(d: any, freigabe?: { pr?: string | null } | null) {
  const raw = d.berichtKopf ?? null;
  const kopf = raw && 'status' in raw ? raw : null;
  return {
    kopf: kopf ? { status: kopf.status, titel: kopf.titel ?? '', worum: kopf.worum ?? '', anders: kopf.anders ?? [], offen: kopf.offen, review: kopf.review, github: kopf.github } : null,
    prs: prTabelle(kopf ? { anders: [], titel: '', worum: '', ...kopf } : null, d.prCheck ?? [], freigabe?.pr ?? null),
    prsAt: d.prsAt ?? null,
    maengel: kopf ? kopfMaengel({ anders: [], titel: '', worum: '', ...kopf }, d.berichtDiagramm ?? null) : [],
  };
}
