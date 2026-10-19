// PR-Gedächtnis (forge-Abgleich 172 §11 #14, Knut 17.10.): ein kleiner Index früherer Review-Kommentare je Datei, damit das
// Review sieht „das wurde an dieser Datei schon bemängelt“. Billig: eine Seite der GitHub-API je Repo und Tag (Lesetoken),
// gecacht in Mongo; im Vorlauf höchstens 3 Kommentare je geänderter Datei, gekürzt und als fremder Text gezäunt.
// Gemessen wird der Nutzen über `gedaechtnis: true` an Befunden (befunde.ts) und die Zahlen im Vorlauf.
import { zaeune } from './reviewmotor.ts';

export interface AlterKommentar { pfad: string; zeile: number | null; pr: number; text: string; at: string }

/** GitHub-Antwort (pulls/comments) → schlanke Einträge; Kommentare des aktuellen PR zählen nicht. */
export function ausApi(roh: unknown): AlterKommentar[] {
  if (!Array.isArray(roh)) return [];
  return roh.map((c: any) => {
    const pr = Number(/\/pulls\/(\d+)$/.exec(String(c?.pull_request_url ?? ''))?.[1] ?? NaN);
    const pfad = typeof c?.path === 'string' ? c.path : '';
    if (!pfad || !Number.isInteger(pr)) return null;
    return { pfad, zeile: Number.isInteger(c?.line) ? c.line : Number.isInteger(c?.original_line) ? c.original_line : null, pr,
      text: String(c?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 240), at: String(c?.created_at ?? '') };
  }).filter((x): x is AlterKommentar => !!x && !!x.text);
}

/** Je geänderter Datei die jüngsten früheren Kommentare (anderer PRs). */
export function gedaechtnisFuer(dateien: string[], kommentare: AlterKommentar[], o: { pr: number; jeDatei?: number }): Map<string, AlterKommentar[]> {
  const n = o.jeDatei ?? 3;
  const out = new Map<string, AlterKommentar[]>();
  const set = new Set(dateien);
  for (const k of [...kommentare].sort((a, b) => b.at.localeCompare(a.at))) {
    if (k.pr === o.pr || !set.has(k.pfad)) continue;
    const l = out.get(k.pfad) ?? [];
    if (l.length < n) { l.push(k); out.set(k.pfad, l); }
  }
  return out;
}

/** Abschnitt für vorlauf.md: Zahlen oben (für die Messung), Texte gezäunt (fremder Text, keine Anweisung). */
export function gedaechtnisMd(g: Map<string, AlterKommentar[]>, o: { stand: string | null }): string {
  const n = [...g.values()].reduce((s, l) => s + l.length, 0);
  const z = ['## PR-Gedächtnis', '', `Frühere Review-Kommentare an geänderten Dateien: ${g.size} Dateien, ${n} Kommentare${o.stand ? ` (Index vom ${o.stand})` : ''}.`,
    'Steht ein Befund im Zusammenhang mit einem früheren Kommentar, setz `gedaechtnis: true` am Befund (befunde.json) — so messen wir den Nutzen.', ''];
  if (!g.size) { z.push('Keine früheren Kommentare an diesen Dateien.'); return z.join('\n'); }
  for (const [pfad, l] of g) {
    z.push(`- \`${pfad}\``);
    for (const k of l) z.push(`  - #${k.pr}${k.zeile ? ` Zeile ${k.zeile}` : ''}: ${zaeune(k.text, `Kommentar #${k.pr}`)}`);
  }
  return z.join('\n');
}

export type Holen = (url: string) => Promise<unknown>;
export interface Cache { lese(repo: string): Promise<{ at: Date; kommentare: AlterKommentar[] } | null>; schreibe(repo: string, kommentare: AlterKommentar[]): Promise<void> }

/** Index eines Repos: aus dem Cache, wenn jünger als `maxAlterMs`, sonst eine API-Seite (100 jüngste Kommentare). Fehler → null. */
export async function index(repo: string, o: { holen: Holen; cache: Cache; now?: number; maxAlterMs?: number }): Promise<{ kommentare: AlterKommentar[]; stand: Date } | null> {
  const now = o.now ?? Date.now();
  const c = await o.cache.lese(repo).catch(() => null);
  if (c && now - new Date(c.at).getTime() < (o.maxAlterMs ?? 24 * 3600_000)) return { kommentare: c.kommentare, stand: new Date(c.at) };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  try {
    const k = ausApi(await o.holen(`https://api.github.com/repos/${repo}/pulls/comments?sort=created&direction=desc&per_page=100`)).slice(0, 500);
    await o.cache.schreibe(repo, k).catch(() => {});
    return { kommentare: k, stand: new Date(now) };
  } catch { return c ? { kommentare: c.kommentare, stand: new Date(c.at) } : null; }
}
