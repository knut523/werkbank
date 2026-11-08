// Einhängepunkt für Best-of-N im OC2-Strang (sessions.ts strangOc2): beide Flash-Bauer bauen in eigenen Unter-Worktrees (subWorktree),
// der Sieger-Diff landet im Strang-Worktree. Alles Äußere (Zug, Prüfungen) wird injiziert, damit der Test ohne Modelle läuft.
// null = alter Pfad (Best-of-N aus, kein Git, abgeschaltet). Schutzzone (aus den Pfaden im Auftrag) → { ok: false } → Claude baut.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bestofnAn, inSchutzzone, inSonnetzone, bauerFuer, rennen, nachAblehnung, abgeschaltet, statistikLaden, statistikSpeichern, emittiereLauf, pruefSemaphor, pruefLauf, type Lauf, type Schnell, type Deps, type Statistik } from './bauerrennen.ts';
import { budgetGrund } from './kapazitaet.ts';
import { subWorktree, removeWorktree, run } from './delegation.ts';
import { GLM } from './modellwahl.ts';

type Env = Record<string, string | undefined>;
export interface StrangRennen {
  cwd: string; id: string; prompt: string; statistikPfad?: string | null; env?: Env;
  /** Nutzer-Konto: gesetzt → Melious-Budget entscheidet über die Sonnet-Klasse (Melious leer → Sonnet baut). */
  userId?: string;
  /** Ein Bauer-Zug in einem Unter-Worktree (OC2 über denselben Pool wie der normale Strang-Zug). */
  zug(dir: string, modell: string, prompt: string): Promise<{ ok: boolean; text: string; grund: string }>;
  /** Prüfbefehle des Repos (tsc/lint = schnell, alles = voll) im Worktree; die Semaphor-Klammer setzt dieses Modul. */
  pruefe(dir: string, base: string, art: 'schnell' | 'voll'): Promise<{ ok: boolean; log: string; tsc?: boolean; lint?: boolean }>;
  status?(t: string): void;
}
export type StrangAusgang = { ok: boolean; text: string; grund: string; modell?: string } | null;

const pfade = (text: string) => [...new Set(text.match(/\.env[\w.]*|[\w.@-]+(?:\/[\w.@*-]+)+/g) ?? [])];
const kurz = (m: string) => m.replace(/[^\w]+/g, '-').slice(0, 24);
const geschlossen = new Map<string, { cwd: string; lauf: Lauf; patch: string; patches: Record<string, string> }>();

const git = (cwd: string, ...a: string[]) => run('git', ['-C', cwd, ...a], { cwd, max: 50_000_000, timeoutMs: 300_000 });
async function anwenden(cwd: string, diff: string, rueck = false): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'bauer-patch-'));
  try { const f = join(dir, 'p.diff'); writeFileSync(f, diff.endsWith('\n') ? diff : diff + '\n'); return (await git(cwd, 'apply', '--binary', ...(rueck ? ['-R'] : []), f)).code === 0; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Betroffene Tests: geänderte *.test.ts mit `node --test` im nächsten Ordner mit package.json (über den Semaphor). */
async function betroffeneTests(dir: string, diff: string): Promise<{ ok: boolean; log: string }> {
  const dateien = [...diff.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((m) => m[1]).filter((f) => /\.test\.[cm]?[jt]s$/.test(f));
  const nach = new Map<string, string[]>();
  for (const f of dateien) { let o = dirname(f); while (o !== '.' && !existsSync(join(dir, o, 'package.json'))) o = dirname(o); (nach.get(o) ?? nach.set(o, []).get(o)!).push(f); }
  for (const [o, fs] of nach) {
    const rel = fs.map((f) => (o === '.' ? f : f.slice(o.length + 1)));
    const r = await pruefLauf(join(dir, o), 'node', ['--test', ...rel]);
    if (!r.ok) return r;
  }
  return { ok: true, log: '' };
}

export async function bestofnStrang(o: StrangRennen): Promise<StrangAusgang> {
  const env = o.env ?? process.env;
  if (!bestofnAn(env)) return null;
  const stat: Statistik = o.statistikPfad ? statistikLaden(o.statistikPfad) : { laeufe: 0, zweitSiege: 0 };
  if (abgeschaltet(stat, env)) return null;
  const dateien = pfade(o.prompt);
  if (inSchutzzone(dateien, env)) return { ok: false, text: '', grund: 'Schutzzone (Migration/Auth/Billing/Workflow/.env) — Opus baut, kein Best-of-N' };
  // Sonnet-Klasse (wb21/i-f-sonnet-glm): Geld/Konten oder Melious leer → Sonnet baut, kein Best-of-N. Abschalten: BRIDGE_SONNETKLASSE=aus.
  const meliousLeer = o.userId ? budgetGrund(o.userId, 'bauer', Date.now(), env) !== '' : false;
  if (bauerFuer(dateien, env, undefined, meliousLeer)[0] === 'sonnet') return { ok: false, text: '', grund: 'Sonnet-Klasse (Geld/Konten) oder Melious leer — Sonnet baut, kein Best-of-N' };
  let zone = false;
  const subs = new Map<string, { dir: string; base: string }>(), texte = new Map<string, string>();
  const deps: Deps = {
    async bauen(bauer, a, op) {
      const s = await subWorktree(o.cwd, `${o.id}-${kurz(bauer)}`);
      if ('error' in s) return { bauer, ok: false, diff: '', log: s.error };
      subs.set(bauer, { dir: s.dir, base: s.base });
      o.status?.(`⏳ Best-of-N: ${bauer} baut in eigenem Worktree …`);
      const p = op?.fehlerlogs?.length ? `${a.plan}\n\n## Fehlerlogs der vorigen Bauer (nicht wiederholen)\n${op.fehlerlogs.join('\n---\n').slice(-6000)}` : a.plan;
      const r = await o.zug(s.dir, bauer, p);
      texte.set(bauer, r.text);
      await git(s.dir, 'add', '-A');
      const diff = (await git(s.dir, 'diff', '--cached', '--binary', '--no-color', s.base)).out;
      // Schutzzone am tatsächlichen Diff (nicht nur an Pfaden im Plantext): berührt der Kandidat sie, darf er nicht gewinnen. Abschalten: BRIDGE_DIFFZONE=aus.
      if (String(env.BRIDGE_DIFFZONE ?? '').trim().toLowerCase() !== 'aus') {
        const namen = (await run('git', ['-C', s.dir, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--no-renames', s.base], { cwd: s.dir, max: 1e7 })).out.split('\n').filter(Boolean);
        if (inSchutzzone(namen, env)) { zone = true; return { bauer, ok: false, diff: '', log: 'Schutzzone im Diff' }; }
      }
      return { bauer, ok: r.ok && !!diff.trim(), diff, log: r.ok ? 'keine Änderung' : r.grund };
    },
    async schnell(k): Promise<Schnell> {
      const s = subs.get(k.bauer)!;
      const p = await pruefSemaphor.run(() => o.pruefe(s.dir, s.base, 'schnell'));
      const t = p.ok ? await betroffeneTests(s.dir, k.diff) : { ok: true, log: '' };
      return { tsc: p.tsc ?? p.ok, lint: p.lint ?? p.ok, tests: p.ok && t.ok, log: p.ok ? t.log : p.log };
    },
    async voll(k) { const s = subs.get(k.bauer)!; return pruefSemaphor.run(() => o.pruefe(s.dir, s.base, 'voll')); },
    ledger: emittiereLauf,
  };
  const lauf = await rennen(deps, { id: o.id, plan: o.prompt, dateien }, { env, stat });
  if (o.statistikPfad) statistikSpeichern(o.statistikPfad, stat);
  const patches = Object.fromEntries([...subs.keys()].map((b): [string, string] => [b, '']));
  const sieger = lauf.sieger;
  const ok = !zone && !!sieger && await anwenden(o.cwd, sieger.diff);
  if (ok) {
    for (const k of [sieger!.bauer, lauf.verlierer?.bauer].filter(Boolean) as string[]) patches[k] = k === sieger!.bauer ? sieger!.diff : lauf.verlierer!.diff;
    geschlossen.set(o.id, { cwd: o.cwd, lauf, patch: sieger!.diff, patches });
    for (const k of geschlossen.keys()) { if (geschlossen.size <= 50) break; geschlossen.delete(k); }   // bounded: oldest out (loser retry only matters for 24 h)
  }
  for (const s of subs.values()) await removeWorktree(s.dir).catch(() => {});
  if (zone) return { ok: false, text: '', grund: 'Schutzzone (Diff berührt Migration/Auth/Billing/Workflow/.env) — Opus baut, Sieger nicht angewendet' };
  if (lauf.zerlegen) return { ok: false, text: '', grund: 'Punkt zu groß (Deckel überschritten) — im Plan kleiner schneiden' };
  if (!ok) return { ok: false, text: '', grund: sieger ? 'Best-of-N: Sieger-Diff ließ sich nicht anwenden' : 'Best-of-N: kein Bauer lieferte einen sauberen Diff' };
  return { ok: true, text: texte.get(sieger!.bauer) ?? '', grund: '', modell: `${sieger!.bauer} (Best-of-N)` };
}

/** Review hat den Sieger abgelehnt: Verlierer-Diff (24 h) anwenden → { art: 'verlierer' }; nach 2 Fixrunden → { art: 'eskalation' } (glm-5.3 mit allen Logs); sonst null (normaler Fix). */
export async function bestofnAblehnung(id: string, grund: string, jetzt = Date.now()): Promise<{ art: 'verlierer'; bauer: string } | { art: 'eskalation'; modell: string; fehlerlogs: string[] } | null> {
  const g = geschlossen.get(id);
  if (!g) return null;
  const f = nachAblehnung(g.lauf, grund, jetzt);
  if (f.art === 'verlierer') {
    if (await anwenden(g.cwd, g.patch, true) && await anwenden(g.cwd, f.diff)) { g.patch = f.diff; return { art: 'verlierer', bauer: f.bauer }; }
    await anwenden(g.cwd, g.patch);   // zurück auf den Sieger, falls der Tausch halb ging
    return null;
  }
  return f.art === 'eskalation' ? { art: 'eskalation', modell: GLM, fehlerlogs: f.fehlerlogs } : null;
}
