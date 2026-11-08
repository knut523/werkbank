// Einhängepunkt für Best-of-N im OC2-Strang (sessions.ts strangOc2): beide Flash-Bauer bauen in eigenen Unter-Worktrees (subWorktree),
// der Sieger-Diff landet im Strang-Worktree. Alles Äußere (Zug, Prüfungen) wird injiziert, damit der Test ohne Modelle läuft.
// null = alter Pfad (Best-of-N aus, kein Git, abgeschaltet). Schutzzone (aus den Pfaden im Auftrag) → { ok: false } → Claude baut.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mitDeckel, bauerDeckelMs, abbruchFristMs, DECKEL_LOG, bestofnAn, inSchutzzone, inSonnetzone, bauerFuer, rennen, nachAblehnung, abgeschaltet, statistikLaden, statistikSpeichern, emittiereLauf, SONNET, pruefSemaphor, pruefLauf, type Lauf, type Schnell, type Deps, type Statistik } from './bauerrennen.ts';
import { budgetGrund } from './kapazitaet.ts';
import { pruefSchleife, BAUER_REGELN, type Phase } from './strangpruefung.ts';
import { FLASH, DEEPSEEK } from './modellwahl.ts';
import { subWorktree, removeWorktree, run } from './delegation.ts';

type Env = Record<string, string | undefined>;
export interface StrangRennen {
  cwd: string; id: string; prompt: string; statistikPfad?: string | null; env?: Env;
  /** Nutzer-Konto: gesetzt → Melious-Budget entscheidet über die Sonnet-Klasse (Melious leer → Sonnet baut). */
  userId?: string;
  /** Ein Bauer-Zug in einem Unter-Worktree (OC2 über denselben Pool wie der normale Strang-Zug). */
  zug(dir: string, modell: string, prompt: string, signal?: AbortSignal): Promise<{ ok: boolean; text: string; grund: string }>;
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

/** Grund der Sonnet-Klasse — dieselbe Übergabe an Sonnet auf Claude (bauZug → ok:false → Claude-Rückfall) für Klasse, rote Rennen und Eskalation. */
export const SONNET_GRUND = 'Sonnet-Klasse (Geld/Konten) oder Melious leer — Sonnet baut, kein Best-of-N';
const sonnetUebergabe = () => ({ ok: false as const, text: '', grund: SONNET_GRUND });

export async function bestofnStrang(o: StrangRennen): Promise<StrangAusgang> {
  const env = o.env ?? process.env;
  if (!bestofnAn(env)) return null;
  const stat: Statistik = o.statistikPfad ? statistikLaden(o.statistikPfad) : { laeufe: 0, zweitSiege: 0 };
  if (abgeschaltet(stat, env)) return null;
  const dateien = pfade(o.prompt);
  if (inSchutzzone(dateien, env)) return { ok: false, text: '', grund: 'Schutzzone (Migration/Auth/Billing/Workflow/.env) — Opus baut, kein Best-of-N' };
  // Sonnet-Klasse (wb21/i-f-sonnet-glm): Geld/Konten oder Melious leer → Sonnet baut, kein Best-of-N. Abschalten: BRIDGE_SONNETKLASSE=aus.
  const meliousLeer = o.userId ? budgetGrund(o.userId, 'bauer', Date.now(), env) !== '' : false;
  if (bauerFuer(dateien, env, undefined, meliousLeer)[0] === 'sonnet') return sonnetUebergabe();
  let zone = false;
  const schleifeAn = String(env.BRIDGE_STRANGPRUEFUNG ?? '').trim().toLowerCase() !== 'aus';   // L2-Schalter, Standard an
  const subs = new Map<string, { dir: string; base: string }>(), texte = new Map<string, string>();
  // Jeder Versuch hat eigene Worktree-Identität (Zähler je Bauer): der Retry des ersten Bauers kollidiert nicht mit dessen Rennversuch.
  // subs = jüngster Versuch je Bauer (schnell/voll prüfen den Kandidaten direkt nach dem Bauen); alle = jeder Versuch, für das Aufräumen.
  const versuche = new Map<string, number>(), alle: { bauer: string; dir: string; branch: string }[] = [];
  const laufend: { bauer: string; p: Promise<unknown>; offen: () => boolean }[] = [];
  const bauenInner: Deps['bauen'] = async (bauer, a, op) => {
      const n = versuche.get(bauer) ?? 0; versuche.set(bauer, n + 1);
      const anlegen = subWorktree(o.cwd, `${o.id}-${kurz(bauer)}-${n}`); op?.vorbereitung?.(anlegen);   // Deckel-Uhr startet erst, wenn der Worktree steht
      const s = await anlegen;
      if ('error' in s) return { bauer, ok: false, diff: '', log: s.error };
      subs.set(bauer, { dir: s.dir, base: s.base }); alle.push({ bauer, dir: s.dir, branch: s.branch });
      o.status?.(`⏳ Best-of-N: ${bauer} baut in eigenem Worktree …`);
      const plan = schleifeAn ? `${a.plan}\n\n${BAUER_REGELN}` : a.plan;   // L2: lean Test-first-Regeln nur mit Strang-Prüfung
      const p = op?.fehlerlogs?.length ? `${plan}\n\n## Fehlerlogs der vorigen Bauer (nicht wiederholen)\n${op.fehlerlogs.join('\n---\n').slice(-6000)}` : plan;
      const r = await o.zug(s.dir, bauer, p, op?.signal);
      texte.set(bauer, r.text);
      await git(s.dir, 'add', '-A');
      const diff = (await git(s.dir, 'diff', '--cached', '--binary', '--no-color', s.base)).out;
      // Schutzzone am tatsächlichen Diff (nicht nur an Pfaden im Plantext): berührt der Kandidat sie, darf er nicht gewinnen. Abschalten: BRIDGE_DIFFZONE=aus.
      if (String(env.BRIDGE_DIFFZONE ?? '').trim().toLowerCase() !== 'aus') {
        const namen = (await run('git', ['-C', s.dir, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--no-renames', s.base], { cwd: s.dir, max: 1e7 })).out.split('\n').filter(Boolean);
        if (inSchutzzone(namen, env)) { zone = true; return { bauer, ok: false, diff: '', log: 'Schutzzone im Diff' }; }
      }
      return { bauer, ok: r.ok && !!diff.trim(), diff, log: r.ok ? 'keine Änderung' : r.grund };
    
  };
  // ---- L2: Strang-Prüfung. Prüfer = das andere Modell, Fixer = Siegermodell; jeder Aufruf mit 10-min-Deckel über das Abort-Signal (mitDeckel). ----
  let phasen: Phase[] | undefined, ledgerEvent: Parameters<NonNullable<Deps['ledger']>>[0] | undefined;
  const gateLog: string[] = [], geschleift = new WeakSet<object>();
  const prueferMs = (() => { const n = Number(env.BRIDGE_PRUEFER_DECKEL_S); return Number.isFinite(n) && n > 0 ? n * 1000 : 600_000; })();
  const gedeckelt = async (dir: string, modell: string, prompt: string): Promise<string> => {
    let text = '';
    const r = await mitDeckel(async (signal) => { const z = await o.zug(dir, modell, prompt, signal); text = z.text; return { bauer: modell, ok: z.ok, diff: '', log: z.ok ? '' : z.grund }; }, modell, prueferMs, abbruchFristMs(env)).catch(() => null);
    return !r || r.log === DECKEL_LOG ? '' : text;
  };
  const diffVon = async (dir: string, base: string) => { await git(dir, 'add', '-A'); return (await git(dir, 'diff', '--cached', '--binary', '--no-color', base)).out; };
  const neueTests = async (dir: string) => (await git(dir, 'ls-files', '-o', '--exclude-standard')).out.split('\n').filter((f) => /\.test\.[cm]?[jt]s$/.test(f));
  async function testLauf(dir: string, f: string): Promise<{ ok: boolean; log: string }> {
    let d = dirname(f); while (d !== '.' && !existsSync(join(dir, d, 'package.json'))) d = dirname(d);
    return pruefLauf(join(dir, d), 'env', ['-u', 'NODE_TEST_CONTEXT', 'node', '--test', d === '.' ? f : f.slice(d.length + 1)]);
  }
  /** Der Prüfer darf nur NEUE Testdateien schreiben: alles andere (geänderte/gelöschte getrackte Dateien, neue Nicht-Tests) wird auf den Stand vor dem Prüfer zurückgesetzt (Index = Stand nach diffVon). */
  async function nurTests(dir: string): Promise<void> {
    const zeilen = (await git(dir, '-c', 'core.quotepath=false', 'status', '--porcelain', '-uall')).out.split('\n').filter((z) => z.length > 3);
    const weg: string[] = [];
    for (const z of zeilen) {
      const x = z[0], y = z[1], f = z.slice(3);
      if (y === 'M' || y === 'D' || y === 'T') { await git(dir, 'checkout', '--', f); weg.push(f); }
      else if (x === '?' && !/\.test\.[cm]?[jt]s$/.test(f)) { rmSync(join(dir, f), { force: true }); weg.push(f); }
    }
    if (weg.length) gateLog.push(`Prüfer änderte Nicht-Test: ${weg.join(', ')}, verworfen`);
  }
  const pruefTests = new Set<string>();
  /** Prüfschleife am Kandidaten (in dessen Unter-Worktree), danach voller Lauf erneut. Rot/ohne Ergebnis/Deckel → { ok: false }. Setzt k.diff auf den Diff samt Fix und Prüfer-Tests. */
  async function strangPruefen(k: { bauer: string; diff: string }): Promise<{ ok: boolean; log: string }> {
    const s = subs.get(k.bauer)!; geschleift.add(k);
    const pruefer = k.bauer === DEEPSEEK ? FLASH : DEEPSEEK;
    o.status?.(`⏳ Best-of-N: Strang-Prüfung (${pruefer} prüft ${k.bauer}) …`);
    const e = await pruefSchleife({
      pruefen: async (linse) => {
        const dif = (await diffVon(s.dir, s.base)).slice(0, 60_000);
        const tests = [...new Set([...dif.matchAll(/^diff --git a\/\S+ b\/(\S+\.test\.[cm]?[jt]s)$/gm)].map((m) => m[1]))];
        const text = await gedeckelt(s.dir, pruefer, `${linse}\n\n## DoD\n${o.prompt}\n\n## Diff\n${dif}\n\n## Tests im Diff\n${tests.join('\n') || '(keine)'}`);
        await nurTests(s.dir);
        const neu = await neueTests(s.dir); neu.forEach((t) => pruefTests.add(t));
        return { text, tests: neu };
      },
      rotAufHead: async (tests) => {
        const rot: string[] = [], logs: string[] = [];
        for (const f of tests) { const r = await testLauf(s.dir, f); if (!r.ok) { rot.push(f); logs.push(`${f}\n${r.log.slice(-2000)}`); } }
        return { rot, log: logs.join('\n---\n') };
      },
      fixen: async (fehler) => {
        const vorher = new Map([...pruefTests].map((t): [string, Buffer | null] => [t, existsSync(join(s.dir, t)) ? readFileSync(join(s.dir, t)) : null]));
        await gedeckelt(s.dir, k.bauer, `## Fixrunde\nDie Bridge hat Tests des Prüfers auf deinem Stand laufen lassen; diese sind rot. Behebe den Fehler im Produktcode, ändere die Tests nicht.\n\n${BAUER_REGELN}\n\n## DoD\n${o.prompt}\n\n## Rote Tests\n${fehler.slice(-6000)}`);
        const geaendert = [...vorher].filter(([t, inhalt]) => inhalt && !(existsSync(join(s.dir, t)) && readFileSync(join(s.dir, t)).equals(inhalt)));
        if (!geaendert.length) return;
        for (const [t, inhalt] of geaendert) { mkdirSync(dirname(join(s.dir, t)), { recursive: true }); writeFileSync(join(s.dir, t), inhalt!); }
        gateLog.push(`Fixer änderte Prüfer-Test: ${geaendert.map(([t]) => t).join(', ')}, zurückgesetzt`);
        return 'manipuliert';
      },
    });
    phasen = e.phasen;
    gateLog.push(`Strang-Prüfung: ${e.ende}, ${e.runden} Runde(n), rot gesehen: ${e.roteTests.join(', ') || '-'}, offen: ${e.offen.join(', ') || '-'}`);
    if (e.ende !== 'konvergiert') return { ok: false, log: `Strang-Prüfung ${e.ende}; offen: ${e.offen.join(', ')}` };
    k.diff = await diffVon(s.dir, s.base);
    if (String(env.BRIDGE_DIFFZONE ?? '').trim().toLowerCase() !== 'aus') {
      const namen = (await run('git', ['-C', s.dir, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--no-renames', s.base], { cwd: s.dir, max: 1e7 })).out.split('\n').filter(Boolean);
      if (inSchutzzone(namen, env)) { zone = true; gateLog.push('Schutzzone im Diff nach der Strang-Prüfung'); return { ok: false, log: 'Schutzzone im Diff' }; }
    }
    const v = await pruefSemaphor.run(() => o.pruefe(s.dir, s.base, 'voll'));
    gateLog.push(`voll nach Schleife: ${v.ok ? 'grün' : `rot ${v.log.slice(-300)}`}`);
    return v;
  }
  const deps: Deps = {
    bauen(bauer, a, op) {
      let fertig = false;
      const p = bauenInner(bauer, a, op).finally(() => { fertig = true; });
      laufend.push({ bauer, p, offen: () => !fertig });
      return p;
    },
    async schnell(k): Promise<Schnell> {
      const s = subs.get(k.bauer)!;
      const p = await pruefSemaphor.run(() => o.pruefe(s.dir, s.base, 'schnell'));
      const t = p.ok ? await betroffeneTests(s.dir, k.diff) : { ok: true, log: '' };
      return { tsc: p.tsc ?? p.ok, lint: p.lint ?? p.ok, tests: p.ok && t.ok, log: p.ok ? t.log : p.log };
    },
    async voll(k) {
      const s = subs.get(k.bauer)!;
      const v = await pruefSemaphor.run(() => o.pruefe(s.dir, s.base, 'voll'));
      return v.ok && schleifeAn ? strangPruefen(k) : v;   // L2: Sieger-Kandidat durch die Prüfschleife; rot → Rangfolge/L3-Kette in rennen()
    },
    ledger: schleifeAn ? (e) => { ledgerEvent = e; } : emittiereLauf,
  };
  const lauf = await rennen(deps, { id: o.id, plan: o.prompt, dateien }, { env, stat });
  // Ein Retry-Sieger (L3c) läuft in rennen() nicht durch voll: hier nachholen; rot → Kette erschöpft → Sonnet.
  if (schleifeAn && lauf.sieger && !geschleift.has(lauf.sieger) && subs.has(lauf.sieger.bauer)) {
    const v = await strangPruefen(lauf.sieger).catch((e) => ({ ok: false, log: String(e) }));
    if (!v.ok) { lauf.logs.push(`${lauf.sieger.bauer}: Strang-Prüfung rot\n${v.log.slice(-1500)}`); lauf.sieger = null; lauf.verlierer = undefined; if (!zone) lauf.weiter = 'sonnet'; if (ledgerEvent) ledgerEvent.sieger = null; }
  }
  if (ledgerEvent) emittiereLauf({ ...ledgerEvent, ...(phasen ? { phasen } : {}), gateLog });
  if (o.statistikPfad) statistikSpeichern(o.statistikPfad, stat);
  const patches = Object.fromEntries([...subs.keys()].map((b): [string, string] => [b, '']));
  const sieger = lauf.sieger;
  const ok = !zone && !!sieger && await anwenden(o.cwd, sieger.diff);
  if (ok) {
    for (const k of [sieger!.bauer, lauf.verlierer?.bauer].filter(Boolean) as string[]) patches[k] = k === sieger!.bauer ? sieger!.diff : lauf.verlierer!.diff;
    geschlossen.set(o.id, { cwd: o.cwd, lauf, patch: sieger!.diff, patches });
    for (const k of geschlossen.keys()) { if (geschlossen.size <= 50) break; geschlossen.delete(k); }   // bounded: oldest out (loser retry only matters for 24 h)
  }
  // Council 6: ein Bauer, der den Abbruch nicht bestätigt hat (Gnadenfrist um), behält seinen Worktree, bis sein Promise endet.
  const weg = (x: { dir: string; branch: string }) => removeWorktree(x.dir).catch(() => {}).then(() => git(o.cwd, 'branch', '-D', x.branch)).catch(() => {});
  for (const s of alle) {
    const l = laufend.find((x) => x.bauer === s.bauer && x.offen());
    if (!l) { await weg(s); continue; }
    o.status?.(`⚠️ Best-of-N: Abbruch unbestätigt — ${s.bauer} läuft noch, Worktree ${s.dir} bleibt bis zu seinem Ende`);
    void l.p.catch(() => {}).then(() => weg(s));
  }
  if (lauf.weiter === 'sonnet' && !zone) return sonnetUebergabe();   // L3b: alle Bauer rot (auch der Retry) → Sonnet auf Claude, nie 'sonnet' auf OC2
  if (zone) return { ok: false, text: '', grund: 'Schutzzone (Diff berührt Migration/Auth/Billing/Workflow/.env) — Opus baut, Sieger nicht angewendet' };
  if (lauf.zerlegen) return { ok: false, text: '', grund: 'Punkt zu groß (Deckel überschritten) — im Plan kleiner schneiden' };
  if (!ok) return { ok: false, text: '', grund: sieger ? 'Best-of-N: Sieger-Diff ließ sich nicht anwenden' : 'Best-of-N: kein Bauer lieferte einen sauberen Diff' };
  return { ok: true, text: texte.get(sieger!.bauer) ?? '', grund: '', modell: `${sieger!.bauer} (Best-of-N)` };
}

/** Review hat den Sieger abgelehnt: Verlierer-Diff (24 h) anwenden → { art: 'verlierer' }; nach 2 Fixrunden → { art: 'eskalation' } (Sonnet mit allen Logs, nie glm-5.3); sonst null (normaler Fix). */
export async function bestofnAblehnung(id: string, grund: string, jetzt = Date.now()): Promise<{ art: 'verlierer'; bauer: string } | { art: 'eskalation'; modell: string; fehlerlogs: string[] } | null> {
  const g = geschlossen.get(id);
  if (!g) return null;
  const f = nachAblehnung(g.lauf, grund, jetzt);
  if (f.art === 'verlierer') {
    if (await anwenden(g.cwd, g.patch, true) && await anwenden(g.cwd, f.diff)) { g.patch = f.diff; return { art: 'verlierer', bauer: f.bauer }; }
    await anwenden(g.cwd, g.patch);   // zurück auf den Sieger, falls der Tausch halb ging
    return null;
  }
  return f.art === 'sonnet' ? { art: 'eskalation', modell: SONNET, fehlerlogs: f.fehlerlogs } : null;
}

/** Rein: wohin nach einer Review-Ablehnung? Eskalation (Sonnet) → Sonnet-Klassen-Übergabe (ok:false → Zug läuft mit Claude), sonst null (OC2 baut weiter). */
export const ablehnungsZiel = (f: Awaited<ReturnType<typeof bestofnAblehnung>>): StrangAusgang => (f?.art === 'eskalation' ? sonnetUebergabe() : null);
