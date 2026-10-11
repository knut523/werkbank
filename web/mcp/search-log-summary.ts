// Auswertung des Such-Protokolls (search-log.ts): node web/mcp/search-log-summary.ts <dir> [--tage N] [--json]
// Fehlgriff = Suche mit Treffern, nach der die Unterhaltung (bis zur nächsten Suche) eine Notiz liest, die NICHT unter
// den Treffern war. Ungelesen = Suche mit Treffern, danach nichts gelesen. Lese-Rang = Platz der gelesenen Notiz.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Row { ts: string; user: string; conv: string; tool: string; terms?: string[]; results?: string[]; hits?: number; via?: string; note?: string }

export function summarize(rows: Row[]) {
  const byTool: Record<string, number> = {};
  const q = new Map<string, { n: number; hits: number; zero: number }>();
  const misses: { query: string; read: string }[] = [];
  const ranks: Record<string, number> = { '1': 0, '2-3': 0, '4-10': 0, '>10': 0 };
  let unread = 0, searches = 0;
  const convs = new Map<string, Row[]>();
  for (const r of rows) {
    byTool[r.tool] = (byTool[r.tool] ?? 0) + 1;
    (convs.get(r.conv) ?? convs.set(r.conv, []).get(r.conv)!).push(r);
    if (r.tool !== 'search') continue;
    searches++;
    const k = (r.terms ?? []).join(' ') || '(leer)';
    const e = q.get(k) ?? { n: 0, hits: 0, zero: 0 };
    e.n++; e.hits += r.hits ?? 0; if (!r.hits) e.zero++;
    q.set(k, e);
  }
  for (const list of convs.values()) {
    list.sort((a, b) => a.ts.localeCompare(b.ts));
    list.forEach((r, i) => {
      if (r.tool !== 'search' || !r.hits) return;
      const reads: string[] = [];
      for (const x of list.slice(i + 1)) { if (x.tool === 'search') break; if ((x.tool === 'read_note' || x.tool === 'outline') && x.note) reads.push(x.note); }
      if (!reads.length) { unread++; return; }
      const hit = reads.map((p) => (r.results ?? []).indexOf(p)).filter((x) => x >= 0);
      if (hit.length) { const rk = Math.min(...hit) + 1; ranks[rk === 1 ? '1' : rk <= 3 ? '2-3' : rk <= 10 ? '4-10' : '>10']++; }
      else misses.push({ query: (r.terms ?? []).join(' '), read: reads[0] });
    });
  }
  const top = [...q.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([query, e]) => ({ query, n: e.n, avgHits: +(e.hits / e.n).toFixed(1) }));
  const zero = [...q.entries()].filter(([, e]) => e.zero).sort((a, b) => b[1].zero - a[1].zero).map(([query, e]) => ({ query, n: e.zero }));
  const ts = rows.map((r) => r.ts).sort();
  return { from: ts[0] ?? null, to: ts.at(-1) ?? null, calls: rows.length, byTool, people: new Set(rows.map((r) => r.user)).size, conversations: convs.size, searches, top, zero, misses, unread, readRank: ranks };
}

export function load(dir: string, days?: number): Row[] {
  const cut = days ? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10) : '';
  const out: Row[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => /^search-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(7, 17) >= cut).sort(); } catch { return out; }
  for (const n of names) for (const line of readFileSync(join(dir, n), 'utf8').split('\n')) { if (line.trim()) try { out.push(JSON.parse(line)); } catch { /* kaputte Zeile */ } }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, ...rest] = process.argv.slice(2);
  const ti = rest.indexOf('--tage');
  const s = summarize(load(dir, ti >= 0 ? Number(rest[ti + 1]) : undefined));
  if (rest.includes('--json')) { console.log(JSON.stringify(s, null, 1)); process.exit(0); }
  console.log(`Such-Protokoll ${dir}\n${s.from?.slice(0, 16) ?? '–'} bis ${s.to?.slice(0, 16) ?? '–'} · ${s.calls} Aufrufe (${Object.entries(s.byTool).map(([k, v]) => `${k} ${v}`).join(', ') || 'keine'}) · ${s.people} Personen · ${s.conversations} Unterhaltungen`);
  console.log(`\nTop-Anfragen (Suchwörter · Anzahl · Ø Treffer):`); for (const t of s.top) console.log(`  ${t.n}×  ${t.query}  (Ø ${t.avgHits})`);
  console.log(`\nNulltreffer (${s.zero.reduce((a, z) => a + z.n, 0)}):`); for (const z of s.zero) console.log(`  ${z.n}×  ${z.query}`);
  console.log(`\nFehlgriffe — gesucht, dann etwas anderes gelesen (${s.misses.length}):`); for (const m of s.misses) console.log(`  „${m.query}“ → ${m.read}`);
  console.log(`\nLese-Rang der gelesenen Treffer: ${Object.entries(s.readRank).map(([k, v]) => `${k}: ${v}`).join(' · ')} · Treffer, danach nichts gelesen: ${s.unread} von ${s.searches} Suchen`);
}
