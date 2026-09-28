// Skills aus dem Vault (/vault/_meta/dist-skill/<name>/SKILL.md + Skripte) für die Claude-Sitzungen
// der Werkbank einrichten. Wie das Coder-Startskript: fehlende als Symlink anlegen, nie etwas
// ersetzen. Lokale Kopien, die vom Vault abweichen, werden gemeldet, nicht überschrieben.
// CLI: node web/server/skills-cli.ts [--apply] [--json]   (scripts/werkbank.sh skills)

import { readdirSync, readFileSync, statSync, lstatSync, realpathSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from './vault.ts';

export type SkillState = 'verlinkt' | 'fehlt' | 'lokale Kopie, gleich' | 'lokale Kopie, abweichend' | 'nur lokal' | 'Link woandershin' | 'kaputter Link';

export interface Skill {
  name: string;
  description: string;
  state: SkillState;
  source?: string;          // Vault-Ordner
  path?: string;            // Eintrag im Ziel (~/.claude/skills/<name>)
  realPath?: string;
  mtime?: number;
  version?: string;         // Frontmatter "version" oder Kurz-Hash von SKILL.md
  files?: number;
  hasScripts?: boolean;
}

function dirDigest(dir: string): { hash: string; files: number; mtime: number } {
  const h = createHash('sha256');
  let files = 0, mtime = 0;
  const walk = (d: string, relp: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === '__pycache__' || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, relp + e.name + '/');
      else if (e.isFile()) {
        files++;
        const st = statSync(p);
        mtime = Math.max(mtime, st.mtimeMs);
        h.update(relp + e.name + '\0').update(readFileSync(p)).update('\0');
      }
    }
  };
  walk(dir, '');
  return { hash: h.digest('hex').slice(0, 12), files, mtime };
}

function describe(dir: string): { name?: string; description: string; version?: string } {
  const f = join(dir, 'SKILL.md');
  if (!existsSync(f)) return { description: '' };
  const { fm, body } = parseFrontmatter(readFileSync(f, 'utf8'));
  const desc = typeof fm.description === 'string' ? fm.description : (body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '');
  return { name: typeof fm.name === 'string' ? fm.name : undefined, description: desc.trim(), version: fm.version != null ? String(fm.version) : undefined };
}

const isSkillDir = (d: string) => existsSync(join(d, 'SKILL.md'));

export function listSkills(source: string, target: string): Skill[] {
  const out = new Map<string, Skill>();
  const srcNames = existsSync(source)
    ? readdirSync(source, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isSkillDir(join(source, e.name))).map((e) => e.name)
    : [];
  for (const name of srcNames) {
    const src = join(source, name);
    const d = dirDigest(src);
    const info = describe(src);
    out.set(name, {
      name, description: info.description, state: 'fehlt', source: src, mtime: d.mtime, version: info.version ?? d.hash, files: d.files,
      hasScripts: existsSync(join(src, 'scripts')),
    });
  }
  if (existsSync(target)) {
    for (const e of readdirSync(target, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(target, e.name);
      const lst = lstatSync(p);
      const s = out.get(e.name);
      if (lst.isSymbolicLink()) {
        let real: string | undefined;
        try { real = realpathSync(p); } catch { /* kaputt */ }
        if (!real) { out.set(e.name, { ...(s ?? { name: e.name, description: '' }), state: 'kaputter Link', path: p }); continue; }
        if (!isSkillDir(real)) continue;
        const sameAsSource = s?.source && resolve(realpathSync(s.source)) === resolve(real);
        const info = describe(real);
        const d = dirDigest(real);
        out.set(e.name, {
          ...(s ?? { name: e.name }), description: s?.description || info.description,
          state: sameAsSource ? 'verlinkt' : s ? 'Link woandershin' : 'nur lokal',
          path: p, realPath: real, mtime: d.mtime, version: info.version ?? d.hash, files: d.files, hasScripts: existsSync(join(real, 'scripts')),
        });
      } else if (lst.isDirectory() && isSkillDir(p)) {
        const d = dirDigest(p);
        const info = describe(p);
        const state: SkillState = !s ? 'nur lokal' : d.hash === dirDigest(s.source!).hash ? 'lokale Kopie, gleich' : 'lokale Kopie, abweichend';
        out.set(e.name, {
          ...(s ?? { name: e.name }), description: info.description || s?.description || '', state,
          path: p, realPath: p, mtime: d.mtime, version: info.version ?? d.hash, files: d.files, hasScripts: existsSync(join(p, 'scripts')),
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fehlende Vault-Skills verlinken. Überschreibt nie etwas. */
export function syncSkills(source: string, target: string): { linked: string[]; skipped: Skill[] } {
  mkdirSync(target, { recursive: true });
  const linked: string[] = [];
  const skipped: Skill[] = [];
  for (const s of listSkills(source, target)) {
    if (s.state === 'fehlt' && s.source) {
      symlinkSync(s.source.endsWith('/') ? s.source : s.source + '/', join(target, s.name));
      linked.push(s.name);
    } else if (s.state !== 'verlinkt' && s.state !== 'nur lokal') skipped.push(s);
  }
  return { linked, skipped };
}
