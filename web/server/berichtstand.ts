// Stand des Bericht-Kopfs je Strang festschreiben (docs/plan-leitstand.md, Teil C, C7/H1/H2/H5): der Status-Takt ruft das vor dem
// Übersprung fertiger Stränge auf — „Heute“ liest danach nur Mongo. Der Bericht wird nur bei geänderter Größe/Zeit neu gelesen; der
// echte Kopf des Strang-Repos und die Vorschau-Links werden höchstens alle 5 min geprüft.
import { statSync } from 'node:fs';
import { paketDatei, readBericht } from './bericht.ts';
import { berichtKopf, ersterMermaid } from './berichtkopf.ts';
import { berichtHash, freigaben, pruefeVorschau, repoFakten, strandRepo, vorschauAusLink } from './freigabe.ts';
import { prStaende } from './github.ts';
import { githubReadToken } from './creds.ts';
import type { PrCheck } from './berichtkopf.ts';

const ALLE_5_MIN = 5 * 60_000;
const ALLE_10_MIN = 10 * 60_000;
const TOT = new Set(['antwortet nicht', 'Proxy läuft, Ziel antwortet nicht', 'Fehler']);

export interface KopfDeps { pruefe?: typeof pruefeVorschau; repo?: (d: any) => { head: string }; prs?: (urls: string[]) => Promise<PrCheck[]>; freigabePrs?: (d: any) => Promise<string[]> }

/** C.7: PR-Stand von GitHub (Lesetoken der Werkbank). Kein Token oder Fehler → „unbekannt“ (nie „fehlt“). */
async function prsVonGithub(urls: string[]): Promise<PrCheck[]> {
  const unbekannt = () => urls.map((url) => ({ url, stand: 'unbekannt' as const }));
  const token = await githubReadToken().catch(() => null);
  if (!token) return unbekannt();
  try { return await prStaende(token, urls); } catch { return unbekannt(); }
}
const freigabePrsAusDb = async (d: any) => (await freigaben().find({ strand: String(d._id), pr: { $type: 'string' } }, { projection: { pr: 1 } }).limit(6).toArray()).map((f: any) => String(f.pr));

/** Felder zum $set am Strang (leer = nichts geändert). Fehler beim Lesen ändern nichts. */
export async function kopfPflege(d: any, now = Date.now(), deps: KopfDeps = {}): Promise<Record<string, unknown>> {
  const pfad = paketDatei(d, 'bericht');
  if (!pfad) return {};
  let meta: string;
  try { const st = statSync(pfad); meta = `${st.size}:${Math.floor(st.mtimeMs)}`; } catch { return {}; }
  const set: Record<string, unknown> = {};
  let kopf = d.berichtKopf ?? null;
  const neu = meta !== d.berichtMeta;
  if (neu) {
    const text = readBericht(pfad);
    if (text === null) return {};
    kopf = berichtKopf(text);
    Object.assign(set, { berichtMeta: meta, berichtKopf: kopf, berichtDiagramm: ersterMermaid(text), berichtHash: berichtHash(text), berichtAt: new Date(now) });
  }
  const ok = kopf && 'status' in kopf;
  // H1: Commit im Kopf gegen den echten Kopf des Strang-Repos.
  if (ok && kopf.github?.some((g: any) => g.commit) && (neu || now - new Date(d.headAt ?? 0).getTime() > ALLE_5_MIN)) {
    try { set.repoHead = (deps.repo ?? ((x: any) => repoFakten(strandRepo(x))))(d).head; } catch { set.repoHead = null; }
    set.headAt = new Date(now);
  }
  // H5: Review-/Login-Links (nur Coder-Muster, gesperrte Ports raus) — tot → Warnung auf der Karte.
  if (ok && (neu || now - new Date(d.linksAt ?? 0).getTime() > ALLE_5_MIN)) {
    const out: { titel: string; url: string; ergebnis: string; tot: boolean }[] = [];
    for (const r of kopf.review ?? []) {
      for (const url of [r.login, r.url].filter(Boolean) as string[]) {
        const v = vorschauAusLink(url, r.titel);
        if (!v || out.some((x) => x.url === url)) continue;
        const p = await (deps.pruefe ?? pruefeVorschau)(v);
        out.push({ titel: r.titel || url, url, ergebnis: p.ergebnis, tot: TOT.has(p.ergebnis) });
      }
    }
    Object.assign(set, { linkCheck: out.slice(0, 12), linksAt: new Date(now) });
  }
  // C.7: PR-Links (Kopf + gepushte Freigaben) gegen GitHub — der Stand im Bericht zählt nicht.
  if (ok && (neu || now - new Date(d.prsAt ?? 0).getTime() > ALLE_10_MIN)) {
    let urls = (kopf.github ?? []).map((g: any) => g.pr).filter(Boolean) as string[];
    try { urls = [...new Set([...urls, ...await (deps.freigabePrs ?? freigabePrsAusDb)(d)])]; } catch { /* nur Kopf */ }
    Object.assign(set, { prCheck: urls.length ? (await (deps.prs ?? prsVonGithub)(urls)).slice(0, 12) : [], prsAt: new Date(now) });
  }
  return set;
}
