// Evaluations-Harness Planer–Umsetzer (Plan 183, Council 180 P6). Drei Arme je PR, je N Läufe:
//   flash-ohne  jcode + glm-5.3-flash mit einfachem Review-Auftrag (wie Kalibrierung 178 „allein“)
//   flash-mit   glm-5.3 plant → jcode + Flash → Zitatprüfung → glm-5.3 prüft (derselbe Kern wie der Schattenbetrieb)
//   opus        Referenz: das vorhandene Opus-Review (Datei per --opus), wird NICHT neu gerechnet
// Kosten Melious-Energie. Volles Set (25 PRs + 10 Recherche) erst mit Knuts Go; zum Testen `--nur 343 --laeufe 1`.
//
//   MELIOUS_KEY=sk-mel-… node scripts/planer-eval.ts --set docs/planer-eval/regression.json --nur 343 \
//     --arme flash-ohne,flash-mit --laeufe 1 --dir 343=<worktree am Kopf> [--opus 343=<kommentar.md>] --out <ordner>
//
// Fallstricke: der Startwert stammt aus #343 selbst — für den PR, aus dem ein Fallstrick stammt, wird er NICHT mitgegeben
// (sonst misst der Lauf nur, ob der Planer die Lösung abschreibt).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  planerReview, realJcode, passendeFallstricke, nachbarRepos, FALLSTRICKE_START, WORKER_MODELL, WORKER_TOOLS, type ChatFn,
} from '../web/server/planer.ts';
import { energieOf, FAKTOREN_VORGABE } from '../web/server/melious.ts';
import { bewerte, bewertungsText, zusammenfassen, evalMarkdown, type RegPr, type Lauf } from '../web/server/planereval.ts';

const arg = (k: string, d = '') => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const paare = (k: string) => Object.fromEntries(arg(k).split(',').filter(Boolean).map((p) => p.split('=')).filter((p) => p.length === 2)) as Record<string, string>;
const set: { prs: RegPr[] } = JSON.parse(readFileSync(arg('set', 'docs/planer-eval/regression.json'), 'utf8'));
const nur = arg('nur').split(',').filter(Boolean);
const arme = arg('arme', 'flash-ohne,flash-mit,opus').split(',');
const laeufe = Math.max(1, Math.min(5, Number(arg('laeufe', '2'))));
const dirs = paare('dir'), opusDatei = paare('opus');
const out = resolve(arg('out', '.'));
const key = process.env.MELIOUS_KEY ?? '';
const base = process.env.MELIOUS_BASE_URL || 'https://api.melious.ai';
if (arme.some((a) => a.startsWith('flash')) && !/^sk-mel-/.test(key)) { console.error('MELIOUS_KEY fehlt (sk-mel-…).'); process.exit(2); }
// Cache-Preise aus der Preisliste vom 15.10. (Council 180: glm-5.3-flash 0,02 €/M Cache; glm-5.3 0,20 €/M) — die Vorgabe kennt sie nicht.
const faktoren = { ...FAKTOREN_VORGABE, 'glm-5.3-flash': { in: 1000, out: 4000, cache: 200 }, 'glm-5.3': { in: 10_000, out: 30_000, cache: 2000 } };

const chat: ChatFn = async (body) => {
  try {
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(290_000) });
    const j: any = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j?.error?.code ?? `HTTP ${r.status}` };
  } catch { return null; }
};
const git = (dir: string, a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });

// Beide Flash-Arme ohne Shell (wie der Schattenweg, WORKER_TOOLS) — Kalibrierung 178 lief noch mit bash, die Zahlen sind nicht 1:1 vergleichbar.
const EINFACH = (diffDatei: string) => `Code-Review eines PRs. Der Arbeitsordner ist der PR-Stand, der Diff gegen die Basis liegt in \`${diffDatei}\` (mit read lesen; nur read/agentgrep, nichts ändern). Prüfe Korrektheit, Annahmen über Daten anderer Apps/Repos, Randfälle, Tests. `
  + 'Erste Zeile genau `Empfehlung: approve|request-changes|comment`, dann die Befunde mit Schwere (hoch/mittel/niedrig), Datei:Zeile, Fehlerszenario, Fix. Deutsch, max. 450 Wörter.';
const empfehlungAus = (t: string) => /Empfehlung:\s*\**\s*(approve|request[- ]changes|comment)/i.exec(t)?.[1].toLowerCase().replace(' ', '-') ?? null;

async function armLauf(pr: RegPr, arm: string, n: number): Promise<Lauf> {
  const t0 = Date.now();
  if (arm === 'opus') {
    const f = opusDatei[pr.id];
    if (!f || !existsSync(f)) return { pr: pr.id, arm, lauf: n, empfehlung: pr.opus.empfehlung, text: '', energie: pr.opus.energie ?? 0, aufrufe: 0, ms: 0, fehler: 'Opus-Text fehlt (--opus) — nur Empfehlung aus dem Set' };
    const t = readFileSync(f, 'utf8');
    return { pr: pr.id, arm, lauf: n, empfehlung: empfehlungAus(t) ?? pr.opus.empfehlung, text: t, energie: pr.opus.energie ?? 0, aufrufe: 0, ms: 0 };
  }
  const dir = dirs[pr.id];
  if (!dir || !existsSync(join(dir, '.git'))) return { pr: pr.id, arm, lauf: n, empfehlung: null, text: '', energie: 0, aufrufe: 0, ms: 0, fehler: `Worktree fehlt (--dir ${pr.id}=…)` };
  const kopf = git(dir, ['rev-parse', 'HEAD']).trim();
  if (kopf !== pr.head) return { pr: pr.id, arm, lauf: n, empfehlung: null, text: '', energie: 0, aufrufe: 0, ms: 0, fehler: `Worktree steht auf ${kopf.slice(0, 7)}, nicht ${pr.head.slice(0, 7)}` };
  const basis = git(dir, ['merge-base', 'HEAD', pr.basis_ref]).trim();
  if (arm === 'flash-ohne') {
    const diffDatei = join(out, `${pr.id}-pr.diff`);
    writeFileSync(diffDatei, git(dir, ['diff', `${basis}...HEAD`]));
    const w = await realJcode({ cwd: dir, prompt: EINFACH(diffDatei), model: WORKER_MODELL, key, tools: WORKER_TOOLS, timeoutS: 1500 });
    return { pr: pr.id, arm, lauf: n, empfehlung: empfehlungAus(w.text), text: w.text, energie: energieOf(w.usage, WORKER_MODELL, faktoren), aufrufe: w.aufrufe, ms: Date.now() - t0, ...(w.code !== 0 ? { fehler: `Exit ${w.code} ${w.stderr}` } : {}) };
  }
  const diff = git(dir, ['diff', `${basis}...HEAD`]);
  const fallstricke = passendeFallstricke(FALLSTRICKE_START.filter((f) => f.id !== pr.fallstrick_aus_diesem_pr), pr.repo, diff);
  const r = await planerReview({ chat, jcode: realJcode, key, faktoren, timeoutS: 1500 }, {
    dir, basis, diff, diffStat: git(dir, ['diff', '--stat', `${basis}...HEAD`]), ziel: `Code-Review ${pr.repo}#${pr.number}: ${pr.titel}`, fallstricke, nachbarn: nachbarRepos(pr.repo),
  });
  const text = bewertungsText(r);
  writeFileSync(join(out, `${pr.id}-${arm}-${n}.json`), JSON.stringify(r, null, 1));
  return { pr: pr.id, arm, lauf: n, empfehlung: r.empfehlung ?? null, text, energie: r.stufen.reduce((a, s) => a + s.energie, 0), aufrufe: r.stufen.reduce((a, s) => a + s.aufrufe, 0), ms: Date.now() - t0, ...(r.status !== 'fertig' ? { fehler: r.fehler ?? r.status } : {}) };
}

mkdirSync(out, { recursive: true });
const prs = set.prs.filter((p) => !nur.length || nur.includes(p.id));
const bewertungen = [];
for (const pr of prs) for (const arm of arme) for (let n = 1; n <= (arm === 'opus' ? 1 : laeufe); n++) {
  const l = await armLauf(pr, arm, n);
  if (l.text && arm !== 'opus') writeFileSync(join(out, `${pr.id}-${arm}-${n}.md`), l.text);
  const b = bewerte(pr, l);
  bewertungen.push(b);
  console.log(`#${pr.id} ${arm} ${n}: ${b.empfehlung ?? '—'}${b.falschApprove ? ' FALSCH-APPROVE' : ''} · ${b.treffer.map((t) => `${t.id} ${t.gefunden ? '✓' : '✗'}`).join(', ') || 'keine Kernbefunde'} · ${b.energie} Energie · ${b.s} s${b.fehler ? ` · ${b.fehler}` : ''}`);
}
const sum = zusammenfassen(bewertungen, prs);
writeFileSync(join(out, 'eval.json'), JSON.stringify({ arme, laeufe, prs: prs.map((p) => p.id), bewertungen, sum }, null, 1));
writeFileSync(join(out, 'eval.md'), evalMarkdown(bewertungen, sum, `${prs.map((p) => '#' + p.id).join(' ')} · ${arme.join(', ')} · ${laeufe}× · ${new Date().toISOString().slice(0, 16)}`));
for (const s of sum) console.log(`${s.arm}: Falsch-Approve ${s.falschApprove}/${s.blockerLaeufe} · Recall ${s.recall === null ? '—' : Math.round(s.recall * 100) + ' %'} · ${s.energieMittel} Energie/Lauf · Freigabe ${s.freigabe}`);
