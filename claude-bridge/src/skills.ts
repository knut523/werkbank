// Welche Skills eine Werkbank-Sitzung sieht — statt aller ~220 (Skill-Liste kostet in jeder Runde Kontext).
// Kern (skills-core.json) + Skills aus der Vorgabe der Vorlage + was die Person im Chat nennt.
// Die Zuschaltungen je Unterhaltung bleiben erhalten (BRIDGE_STATE_DIR/skills.json).

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CORE: string[] = (() => {
  try { return JSON.parse(readFileSync(join(here, '..', 'skills-core.json'), 'utf8')).core; } catch { return []; }
})();

const SKILLS_DIR = process.env.BRIDGE_SKILLS_DIR || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills');
let known: { at: number; names: Set<string> } = { at: 0, names: new Set() };
export function knownSkills(): Set<string> {
  if (Date.now() - known.at > 300_000) {
    const names = new Set<string>();
    try { for (const e of readdirSync(SKILLS_DIR)) if (existsSync(join(SKILLS_DIR, e, 'SKILL.md'))) names.add(e); } catch { /* keiner */ }
    known = { at: Date.now(), names };
  }
  return known.names;
}

/** Skill-Namen, die in einem Text ausdrücklich genannt werden: `name`, /name, "Skill name". */
export function mentionedSkills(text: string, names = knownSkills()): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:`([a-z0-9][a-z0-9:-]{2,60})`|(?:^|\s)\/([a-z0-9][a-z0-9-]{2,60})\b|\b[Ss]kills?\s+[„"]?([a-z0-9][a-z0-9-]{2,60}))/g)) {
    const n = m[1] ?? m[2] ?? m[3];
    if (n && names.has(n)) out.add(n);
  }
  return [...out];
}

let extras: Record<string, string[]> | null = null;
function file(stateDir: string) { return join(stateDir, 'skills.json'); }
function load(stateDir: string) {
  if (!extras) { try { extras = JSON.parse(readFileSync(file(stateDir), 'utf8')); } catch { extras = {}; } }
  return extras!;
}

/** Skill-Auswahl für einen Zug; merkt sich Zuschaltungen je Unterhaltung. 'all' auf Wunsch. */
export function skillsFor(stateDir: string, convKey: string, instructions: string, prompt: string): string[] | 'all' {
  if (process.env.BRIDGE_SKILLS === 'all') return 'all';
  const x = load(stateDir);
  const add = [...mentionedSkills(instructions), ...mentionedSkills(prompt)].filter((n) => !CORE.includes(n) && !(x[convKey] ?? []).includes(n));
  if (add.length) {
    x[convKey] = [...(x[convKey] ?? []), ...add];
    const tmp = file(stateDir) + '.tmp';
    writeFileSync(tmp, JSON.stringify(x));
    renameSync(tmp, file(stateDir));
  }
  const names = knownSkills();
  return [...new Set([...CORE, ...(x[convKey] ?? [])])].filter((n) => names.size === 0 || names.has(n));
}
