// scripts/review-eval — Eval-Satz der Auto-Reviews (Paket 223; revieweval.ts).
//
//   review-eval vorbereiten <fall|alle> <variante>   Worktree am Kopf (lokaler Klon, kein Fetch), Kontext bis zur Stichzeit,
//                                                   Diff gegen die merge-base, Live-Auftrag + Replay-Zusatz → <paket>/auftrag.md
//   review-eval richter <fall> <variante>            Bewertungsauftrag (gold/schein + kommentar.md) → <paket>/richter.txt
//   review-eval auswerten <variante> [<variante>…]   urteil.json je Fall → Tabelle Recall / Fehlalarme
// Ordner: <review-pakete>/223-review-verlaesslich/eval/replay/<fall>-<variante> (WERKBANK_EVAL_PAKET überschreibt den Teil
// nach review-pakete/); Worktrees unter WERKBANK_EVAL_WT (Vorgabe <pr-reviews>/_eval). Kontext braucht WERKBANK_GITHUB_TOKEN
// (Lesetoken; scripts/review-eval holt ihn wie ghr). Nichts wird gepostet.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reviewDir } from './bericht.ts';
import { klonPfad, realGit, prKontextVia, kontextMd, verknuepft, reviewPrompt, etaMinuten, prReviewDir, type DiffMaterial } from './prreview.ts';
import { ladeFaelle, kontextBis, REPLAY_ZUSATZ, richterPrompt, urteilAus, kennzahlen, type Fall } from './revieweval.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PAKET = process.env.WERKBANK_EVAL_PAKET || '223-review-verlaesslich/eval/replay';
// Im Klon über realGit (Lesetoken wie live): ein Teilklon (--filter=blob:none) lädt fehlende Inhalte nach.
const kgit = async (args: string[], cwd: string) => String(await realGit(args, cwd, 600_000));
const die = (m: string): never => { process.stderr.write(`review-eval: ${m}\n`); process.exit(2); };

const [cmd, ...rest] = process.argv.slice(2);
const faelle = ladeFaelle(ROOT);
const fall = (id: string) => faelle.find((f) => f.id === id || f.id.startsWith(id + '-')) ?? die(`Fall ${id} unbekannt (${faelle.map((f) => f.id).join(', ')})`);
const paketVon = (f: Fall, v: string) => `${PAKET}/${f.id}-${v}`;

async function vorbereiten(f: Fall, v: string) {
  const klon = klonPfad(f.repo);
  if (!existsSync(klon)) die(`kein lokaler Klon ${klon}`);
  const wtBase = process.env.WERKBANK_EVAL_WT || join(prReviewDir(), '_eval');
  const wt = join(wtBase, `${f.id}-${f.head.slice(0, 7)}`);
  // Wie live (prepareWorktree): eigener Worktree des Klons am Kopf; fehlende Inhalte des Teilklons holt realGit nach.
  if (!existsSync(join(wt, '.git'))) { mkdirSync(wtBase, { recursive: true }); await kgit(['worktree', 'add', '--detach', wt, f.head], klon); }
  const token = process.env.WERKBANK_GITHUB_TOKEN || die('WERKBANK_GITHUB_TOKEN fehlt (scripts/review-eval holt ihn)');
  const k0 = await prKontextVia(token, f.repo, f.number) ?? die('PR-Kontext nicht lesbar');
  const k = kontextBis(k0, f.cutoff);
  const basis = await kgit(['merge-base', `refs/remotes/origin/${k.baseRefName}`, f.head], klon);
  const paket = paketVon(f, v);
  const dir = join(reviewDir(), paket);
  mkdirSync(dir, { recursive: true });
  const stat = await kgit(['diff', '--stat=200', basis, f.head], klon);
  const zeilen = [...(await kgit(['diff', '--shortstat', basis, f.head], klon)).matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const dm: DiffMaterial = { basis, zeilen, delta: null, hinweis: [], dateien: {
    'diff-stat.txt': `git diff --stat ${basis.slice(0, 7)}..${f.head.slice(0, 7)} (merge-base mit origin/${k.baseRefName})\n\n${stat}\n`,
    'diff.patch': await kgit(['diff', basis, f.head], klon),
  } };
  for (const [n, t] of Object.entries(dm.dateien)) writeFileSync(join(dir, n), t);
  const r = { repo: f.repo, number: f.number, title: k.title, url: `https://github.com/${f.repo}/pull/${f.number}`, head: f.head, by: 'knut523', trigger: 'tag' };
  const v2 = verknuepft(k);
  writeFileSync(join(dir, 'kontext.md'), kontextMd(r, k, v2));
  const prompt = reviewPrompt(r, wt, paket, { tiefe: 'regular', eta: etaMinuten('regular', zeilen), kontext: true, dm, verknuepft: v2 }) + '\n' + REPLAY_ZUSATZ;
  writeFileSync(join(dir, 'auftrag.md'), prompt + '\n');
  console.log(JSON.stringify({ fall: f.id, paket, wt, basis: basis.slice(0, 7), zeilen, kommentare: k.comments.length, reviews: k.reviews.length }));
}

function richter(f: Fall, v: string) {
  const dir = join(reviewDir(), paketVon(f, v));
  const k = existsSync(join(dir, 'kommentar.md')) ? readFileSync(join(dir, 'kommentar.md'), 'utf8') : die(`${dir}/kommentar.md fehlt`);
  writeFileSync(join(dir, 'richter.txt'), richterPrompt(f, k));
  console.log(join(dir, 'richter.txt'));
}

function auswerten(varianten: string[]) {
  const zeilen: any[] = [];
  for (const v of varianten) for (const f of faelle) {
    const p = join(reviewDir(), paketVon(f, v), 'urteil.json');
    if (!existsSync(p)) continue;
    const u = urteilAus(readFileSync(p, 'utf8'));
    if (!u) { zeilen.push({ variante: v, fall: f.id, fehler: 'urteil.json nicht lesbar' }); continue; }
    const kz = kennzahlen(f, u);
    zeilen.push({ variante: v, ...kz, recall: Math.round(kz.recall * 100) + ' %', gewichtet: Math.round(kz.gewichtet * 100) + ' %' });
  }
  console.table(zeilen);
}

if (cmd === 'vorbereiten') { const [id, v] = rest; if (!id || !v) die('vorbereiten <fall|alle> <variante>'); for (const f of id === 'alle' ? faelle : [fall(id)]) await vorbereiten(f, v); }
else if (cmd === 'richter') { const [id, v] = rest; if (!id || !v) die('richter <fall> <variante>'); richter(fall(id), v); }
else if (cmd === 'auswerten') { if (!rest.length) die('auswerten <variante> …'); auswerten(rest); }
else die('Befehle: vorbereiten | richter | auswerten');
