// Paket 436, Runde 7 (Knut 04.11.: „Mir fehlt das Topic-Clustering … je Thema eine Seite (offen · läuft · fertig · Dokumente · PRs ·
// Roadmap-Items)“). Roadmap-Items sind die Spec-Seiten im olaf-Vault unter
// `olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/<Thema>/<n-Zustand>/*.md` (Zustand = Ordner: 1-Backlog … 5-Live, siehe Skill
// olaf-produkt-roadmap). Thema = Ordnername (über themaVon, damit „Service-View“ wie überall „Service“ heißt). Nur lesen.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RoadmapItem { thema: string; titel: string; path: string; stand: string; standNr: number; mtime: number }

export const ROADMAP_WURZEL = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
const ZUSTAND = /^(\d)-([\w-]+)$/;
const STAND_TEXT: Record<string, string> = { Backlog: 'Backlog', 'Pre-Plan': 'Pre-Plan', Plan: 'geplant', Review: 'im Review', Live: 'live' };

/** Titel aus dem Frontmatter (`title: "…"`), sonst aus dem Dateinamen. */
export function titelAus(text: string, datei: string): string {
  const m = /^---\n[\s\S]*?^title:\s*"?(.*?)"?\s*$/m.exec(text.slice(0, 2000));
  const t = (m?.[1] ?? '').replace(/^olaf\s*[—-]\s*/i, '').replace(/^Spec:\s*/i, '').trim();
  return t || datei.replace(/\.md$/, '').replace(/-/g, ' ');
}

/** Alle Roadmap-Items unter dem Vault (`vaultDir`); `themaVon` ordnet den Ordnernamen einem Thema zu. */
export function roadmapItems(vaultDir: string, themaVon: (ordner: string) => string): RoadmapItem[] {
  const wurzel = join(vaultDir, ROADMAP_WURZEL);
  const out: RoadmapItem[] = [];
  const ls = (d: string) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  for (const t of ls(wurzel)) {
    if (!t.isDirectory() || /^0-/.test(t.name)) continue;
    const thema = themaVon(t.name);
    for (const z of ls(join(wurzel, t.name))) {
      const m = z.isDirectory() ? ZUSTAND.exec(z.name) : null;
      if (!m) continue;
      for (const f of ls(join(wurzel, t.name, z.name))) {
        if (!f.isFile() || !f.name.endsWith('.md')) continue;
        const p = join(wurzel, t.name, z.name, f.name);
        let text = '', mtime = 0;
        try { text = readFileSync(p, 'utf8'); mtime = statSync(p).mtimeMs; } catch { continue; }
        out.push({ thema, titel: titelAus(text, f.name), path: `${ROADMAP_WURZEL}/${t.name}/${z.name}/${f.name}`, stand: STAND_TEXT[m[2]] ?? m[2], standNr: Number(m[1]), mtime });
      }
    }
  }
  return out.sort((a, b) => a.thema.localeCompare(b.thema, 'de') || a.standNr - b.standNr || b.mtime - a.mtime);
}
