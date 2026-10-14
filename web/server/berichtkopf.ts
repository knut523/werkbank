// Bericht-Kopf (docs/plan-leitstand.md, Teil C, D1): fester YAML-Kopf oben im bericht.md, den Strang, Leitstand und „Heute“ gleich
// lesen. Der Kopf ist Selbstauskunft des Strangs (Council C R1, H1) — er bestimmt, wo eine Karte steht, aber „Auf GitHub“ zählt
// nur mit einer Freigabe aus der Werkbank. Alles hier ist rein (testbar), ohne Datei- oder Netzzugriff.
import { parse as parseYaml } from 'yaml';

export type KopfStatus = 'bereit_fuer_github' | 'wartet_auf_knut' | 'blockiert';
export interface KopfReview { titel: string; url?: string; login?: string; screenshot?: string; pr_text?: string }
export interface KopfFrage { id: string; frage: string; empfehlung: string; antwort: string }
export interface KopfGithub { repo: string; zweig: string; commit: string; pr_text?: string; pr?: string }
export interface Kopf { status: KopfStatus; offen: string[]; review: KopfReview[]; fragen: KopfFrage[]; github: KopfGithub[] }

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
    return { id, frage, empfehlung: str(f.empfehlung, 600), antwort: str(f.antwort, 600) };
  }).filter((x): x is KopfFrage => !!x);
  const github: KopfGithub[] = list(y.github).slice(0, 6).map((g: any) => {
    if (!g || typeof g !== 'object') return null;
    const repo = str(g.repo, 120), zweig = str(g.zweig, 160), commit = str(g.commit, 40).toLowerCase();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    const e: KopfGithub = { repo, zweig, commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : '' };
    const pt = relPath(g.pr_text); if (pt) e.pr_text = pt;
    const pr = str(g.pr, 300); if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr)) e.pr = pr;
    return e;
  }).filter((x): x is KopfGithub => !!x);
  return { status: y.status, offen, review, fragen, github };
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
export function spalte(kopf: Kopf | { fehler: string } | null | undefined, opts: { offeneFragen: number; freigabe: boolean }): Spalte {
  if (kopf && 'status' in kopf && (kopf.status === 'blockiert' || opts.offeneFragen > 0)) return 'entscheiden';
  if (opts.freigabe) return 'github';
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
