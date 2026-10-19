// Ein Review-Motor (Plan 213 S6, Paket 172 D2/D6): eine Prüfliste (templates/review/pruefliste.md), ein deterministischer
// Vorlauf ohne Modell nach dem Handwerk von forge — Grounding (Repo-Regeln wörtlich, geänderte Dateien ohne Lockfiles,
// Erreichbarkeit neuer Dateien, Tests in CI), SAST nur auf hinzugefügten Zeilen, Zäunung fremder Texte — und ein festes
// Ergebnisformat (englischer Kommentar, deutscher Bericht, ehrlich „incomplete“). Der Vorlauf schreibt `vorlauf.md` ins
// Review-Paket; der Review-Auftrag verweist darauf. Nichts hier führt Code aus dem PR aus (das macht nur der Läufer, S7).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GIT_SAFE } from './gitsafe.ts';

const run = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Die eine Prüfliste (Pfad im Werkbank-Repo). */
export function pruefliste(root = REPO): string {
  return readFileSync(join(root, 'templates', 'review', 'pruefliste.md'), 'utf8');
}

/** Fremden Text einzäunen: Daten, keine Anweisung (forge untrusted.py). Schließende Marken im Text werden entschärft. */
export function zaeune(text: string, quelle: string, id = randomBytes(4).toString('hex')): string {
  const sauber = String(text ?? '').replace(/<\/?\s*untrusted-data/gi, (m) => m.replace('<', '‹'));
  return `<untrusted-data source="${quelle.replace(/[^\w .:/#-]/g, '')}" id="${id}">\n${sauber}\n</untrusted-data id="${id}">`;
}

/** Lockfiles, Gebautes, Generiertes: nicht vors Modell (forge pr_review.py). */
export const RAUSCHEN = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|Cargo\.lock|poetry\.lock|go\.sum)$|(^|\/)(dist|build|coverage|node_modules|\.next)\/|\.min\.(js|css)$|\.snap$|(^|\/)generated?\//;
export const istRauschen = (f: string) => RAUSCHEN.test(f);

export interface Treffer { datei: string; zeile: number; regel: string; schwere: 'hoch' | 'mittel'; text: string }

/** Eingebaute SAST-Muster (Rückfall ohne semgrep) — nur auf hinzugefügten Zeilen, Treffer sind Kandidaten, kein Urteil. */
const REGELN: { id: string; schwere: 'hoch' | 'mittel'; re: RegExp }[] = [
  { id: 'geheimnis-im-code', schwere: 'hoch', re: /\b(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|xox[abp]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'eval', schwere: 'hoch', re: /\beval\s*\(|new\s+Function\s*\(/ },
  { id: 'shell-mit-variablen', schwere: 'hoch', re: /\b(exec|execSync)\s*\(\s*`[^`]*\$\{/ },
  { id: 'sql-zusammengesetzt', schwere: 'hoch', re: /\b(query|execute|raw)\s*\(\s*`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i },
  { id: 'html-ungefiltert', schwere: 'mittel', re: /dangerouslySetInnerHTML|\.innerHTML\s*=(?!=)/ },
  { id: 'tls-aus', schwere: 'hoch', re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/ },
  { id: 'cors-offen', schwere: 'mittel', re: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/ },
  { id: 'debug-ausgabe-geheimnis', schwere: 'mittel', re: /console\.(log|info|debug)\([^)]*(token|password|passwort|secret|apikey|api_key)/i },
];

/** Hinzugefügte Zeilen aus einem `git diff -U0` (Datei, neue Zeilennummer, Text). */
export function hinzugefuegt(patch: string): { datei: string; zeile: number; text: string }[] {
  const out: { datei: string; zeile: number; text: string }[] = [];
  let datei = '', n = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+++ ')) { datei = l.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { n = Number(h[1]); continue; }
    if (l.startsWith('+') && !l.startsWith('+++') && datei && datei !== '/dev/null') { out.push({ datei, zeile: n, text: l.slice(1) }); n++; }
  }
  return out;
}

/** SAST nur auf hinzugefügten Zeilen, höchstens `max` Treffer, Rauschen ausgenommen. */
export function sast(patch: string, max = 12): Treffer[] {
  const out: Treffer[] = [];
  for (const z of hinzugefuegt(patch)) {
    if (istRauschen(z.datei) || /\.(md|txt)$/i.test(z.datei)) continue;
    for (const r of REGELN) if (r.re.test(z.text)) {
      // Ein gefundenes Geheimnis nie weitertragen (Paket, Prompt, Kommentar): nur Anfang und Ende zeigen (Pass C).
      const text = r.id === 'geheimnis-im-code' ? z.text.trim().replace(r.re, (m) => `${m.slice(0, 4)}…${m.slice(-2)} (gekürzt)`).slice(0, 160) : z.text.trim().slice(0, 160);
      out.push({ datei: z.datei, zeile: z.zeile, regel: r.id, schwere: r.schwere, text }); break;
    }
    if (out.length >= max) break;
  }
  return out;
}

export type Git = (args: string[], cwd: string) => Promise<string>;
export const realGit: Git = async (args, cwd) => (await run('git', [...GIT_SAFE, ...args], { cwd, timeout: 60_000, maxBuffer: 32 << 20, encoding: 'utf8' })).stdout;

const REGEL_DATEIEN = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const QUELLE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|vue|svelte)$/;
const TEST = /(\.|_|-)(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__)\//;

export interface Vorlauf { md: string; treffer: Treffer[]; seeds: string[]; vollstaendig: boolean; gruende: string[]; dateien: number; rauschen: number }

/**
 * Deterministischer Vorlauf im Worktree des PR-Stands gegen `base` (Commit oder Ref). Liest nur, führt nichts aus.
 * `semgrep`: ist es installiert, wird es mit lokalen Regeln aufgerufen (ohne Netz, ohne Metriken); sonst „nicht verfügbar“.
 */
export async function vorlauf(wt: string, base: string, o: { git?: Git; semgrep?: (dateien: string[]) => Promise<Treffer[] | null> } = {}): Promise<Vorlauf> {
  const git = o.git ?? realGit;
  const gruende: string[] = [];
  const seeds: string[] = [];
  let status = '', patch = '';
  try { status = await git(['diff', '--name-status', `${base}...HEAD`], wt); patch = await git(['diff', '-U0', '--no-color', `${base}...HEAD`], wt); }
  catch (e: any) { gruende.push(`Diff gegen ${base} nicht lesbar: ${String(e?.message ?? e).slice(0, 120)}`); }
  const zeilen = status.split('\n').filter(Boolean).map((l) => { const [st, ...p] = l.split('\t'); return { st: st[0], datei: p.at(-1)! }; });
  const echt = zeilen.filter((z) => !istRauschen(z.datei));
  // Repo-Regeln wörtlich (gekürzt)
  const regeln: string[] = [];
  // Aus dem Git-Objekt lesen, nie über das Dateisystem: ein Symlink im PR (AGENTS.md → ~/.ssh/…) liefert dann nur seinen Zielpfad (Pass C).
  for (const f of REGEL_DATEIEN) {
    let t = '';
    try { if ((await git(['cat-file', '-t', `HEAD:${f}`], wt)).trim() === 'blob' && !(await git(['ls-tree', 'HEAD', '--', f], wt)).startsWith('120000')) t = await git(['show', `HEAD:${f}`], wt); } catch { t = ''; }
    if (t) regeln.push(`### ${f}\n\n${t.slice(0, 4000)}`);
  }
  // Erreichbarkeit neuer Quelldateien: wird der Dateiname irgendwo sonst erwähnt?
  for (const z of echt.filter((x) => x.st === 'A' && QUELLE.test(x.datei) && !TEST.test(x.datei)).slice(0, 30)) {
    const name = basename(z.datei, extname(z.datei));
    if (name.length < 3 || name === 'index') continue;
    let treffer = '';
    try { treffer = await git(['grep', '-l', '-F', '-e', name, 'HEAD', '--', '.'], wt); } catch { treffer = ''; }
    const andere = treffer.split('\n').filter((l) => l && !l.endsWith(z.datei));
    if (!andere.length) seeds.push(`Erreichbar? \`${z.datei}\` ist neu, aber keine andere Datei erwähnt „${name}“.`);
  }
  // Neue Tests in CI verdrahtet?
  const neueTests = echt.filter((x) => x.st === 'A' && TEST.test(x.datei));
  const workflows = (await git(['ls-tree', '--name-only', 'HEAD', '.github/workflows/'], wt).catch(() => '')).split('\n').filter((f) => /\.ya?ml$/.test(f));
  if (neueTests.length && !workflows.length) seeds.push(`${neueTests.length} neue Testdatei(en), aber keine CI-Workflows (.github/workflows) — laufen sie irgendwo?`);
  const geaenderteWorkflows = zeilen.filter((z) => z.datei.startsWith('.github/workflows/') || z.datei === '.werkbank/pruefungen.json');
  if (geaenderteWorkflows.length) seeds.push(`Der PR ändert Prüfbefehle/CI (${geaenderteWorkflows.map((z) => z.datei).join(', ')}) — diese Befehle laufen im Läufer nicht aus dem PR (Basis gilt).`);
  // SAST
  let treffer = sast(patch);
  let sastText = 'eingebaute Muster (semgrep nicht verfügbar)';
  if (o.semgrep) {
    const s = await o.semgrep(echt.filter((z) => z.st !== 'D').map((z) => z.datei)).catch(() => null);
    if (s) { treffer = [...s, ...treffer].slice(0, 12); sastText = 'semgrep (lokale Regeln) + eingebaute Muster'; }
  }
  const vollstaendig = gruende.length === 0;
  const md = [
    '# Vorlauf (deterministisch, ohne Modell)',
    '',
    `Basis \`${base}\` · ${zeilen.length} Dateien geändert, davon ${zeilen.length - echt.length} Lockfiles/Generiertes ausgenommen · vollständig: ${vollstaendig ? 'ja' : 'nein'}`,
    ...(gruende.length ? ['', '**Unvollständig:**', ...gruende.map((g) => `- ${g}`)] : []),
    '',
    '## Repo-Regeln (wörtlich, gekürzt)',
    '',
    regeln.length ? regeln.join('\n\n') : '_keine AGENTS.md / CLAUDE.md / CONTRIBUTING gefunden_',
    '',
    '## Geänderte Dateien',
    '',
    ...echt.slice(0, 200).map((z) => `- ${z.st} \`${z.datei}\``),
    '',
    '## Hinweise zum Prüfen (Kandidaten, kein Urteil)',
    '',
    ...(seeds.length ? seeds.map((s) => `- ${s}`) : ['- keine']),
    '',
    `## SAST auf hinzugefügten Zeilen (${sastText})`,
    '',
    ...(treffer.length ? treffer.map((t) => `- [${t.schwere}] \`${t.datei}:${t.zeile}\` ${t.regel} — \`${t.text.replace(/`/g, 'ʼ')}\``) : ['- keine Treffer (das ist kein Beweis für Sicherheit)']),
  ].join('\n');
  return { md, treffer, seeds, vollstaendig, gruende, dateien: zeilen.length, rauschen: zeilen.length - echt.length };
}

/** Basis eines PR-Worktrees: Merge-Base mit dem ersten vorhandenen Integrationszweig (oder `bevorzugt`). */
export async function basisVon(wt: string, o: { git?: Git; bevorzugt?: string | null } = {}): Promise<string | null> {
  const git = o.git ?? realGit;
  for (const ref of [o.bevorzugt, 'origin/develop', 'origin/dev', 'origin/main', 'origin/master'].filter(Boolean) as string[]) {
    try { return (await git(['merge-base', 'HEAD', ref], wt)).trim() || null; } catch { /* nächster */ }
  }
  return null;
}

export const motorAn = (env = process.env) => env.WERKBANK_REVIEW_MOTOR !== '0';
/** Stufe deep mit Ausführung (S7b) — erst eingeschaltet, wenn der Läufer und sein Rückweg eingerichtet sind (D4). Vorgabe aus. */
export const deepAn = (env = process.env) => env.WERKBANK_REVIEW_DEEP === '1';

/** Abschnitt für den Review-Auftrag: Prüfliste und Vorlauf als feste Grundlage, Ergebnisformat. */
export function motorAbschnitt(paket: string): string {
  return [
    '',
    'Review-Motor (Plan 213): Arbeite die Prüfliste ab — `templates/review/pruefliste.md` im Werkbank-Repo (ein Befund nur mit Datei:Zeile und Code-Zitat).',
    `Der deterministische Vorlauf liegt in \`review-pakete/${paket}/vorlauf.md\` (Repo-Regeln, geänderte Dateien ohne Lockfiles, Erreichbarkeit, CI, SAST auf hinzugefügten Zeilen) — jeden Kandidaten prüfen und als bestätigt oder widerlegt vermerken.`,
    'Fehlt etwas (Diff gekürzt, Werkzeug fehlt), ist das Ergebnis `incomplete` mit Grund — nie „sauber“.',
    '',
    'Ablauf je Kandidat (forge-Handwerk): erst BREAK (feindlich: wie bricht das?), dann REFUTE (versuch den Befund zu widerlegen, schreib den Versuch auf)',
    'und gib einen Vertrauensgrad. Nur CONFIRMED oder PLAUSIBLE kommt in den Kommentar; REFUTED bleibt im Bericht.',
    `Ergebnis: \`review-pakete/${paket}/befunde.json\` (Pflicht, Form unten) und \`bericht.md\` deutsch mit \`vollständig: ja|nein\`. \`kommentar.md\` baut der Workspace aus befunde.json — schreib ihn nicht selbst.`,
    BEFUNDE_FORM,
  ].join('\n');
}

/** Form von befunde.json (befunde.ts prüft sie; Unbekanntes fällt raus). */
export const BEFUNDE_FORM = [
  '```json',
  '{ "vollstaendig": true, "gruende": [], "tests": "what ran / what could not run (English)",',
  '  "abdeckung": { "security": "geprüft", "data_integrity": "geprüft", "cross_file": "geprüft", "idempotency": "geprüft", "pii": "geprüft", "access_control": "geprüft",',
  '                 "correctness": "geprüft", "spec": "geprüft", "tests": "nicht geprüft", "performance": "nicht geprüft", "maintainability": "geprüft", "docs": "nicht geprüft" },',
  '  "befunde": [ { "datei": "src/a.ts", "zeile": 42, "klasse": "security", "schwere": "blocking", "vertrauen": "hoch",',
  '                 "pruefung": "CONFIRMED", "widerlegung": "tried X, still breaks because Y", "quelle": "spec", "titel": "English one-liner", "fix": "English fix", "gedaechtnis": false } ] }',
  '```',
  'Klassen: security, data_integrity, cross_file, idempotency, pii, access_control (nur diese dürfen `blocking` sein) · correctness, spec, tests, performance, maintainability, docs (immer `advisory`).',
  '`quelle`: `spec` = Anforderung/Abnahmekriterium aus PR-Text, Plan oder Spec; `standard` = Repo-Regeln, Sicherheit, Handwerk. Ein nicht geprüfter Blockier-Klasse macht das Review `incomplete`.',
].join('\n');
