// Gemeinsame Hilfen der Delegations-Tests (Plan 165): Git ohne globale Konfiguration, Abschluss-Block, gültige Übergabe, Test-Repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


export const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', '-C', cwd, ...a], { encoding: 'utf8' });
export const block = (o: Record<string, unknown>) => `Text\n\n\`\`\`json\n${JSON.stringify({ abschluss: { ziel: true, dateien: [], pruefungen: [], annahmen: [], widersprueche: [], ...o } })}\n\`\`\``;
export const UEB = `## Ziel\nDelegation bauen, Tests grün, Bericht fertig.\n\n## Stand\nclaude-bridge/src/delegation.ts geschrieben, Tests laufen.\n\n## Annahmen\nkeine\n\n## Offene Widersprüche\nkeine\n\n## Prüfausgaben\nnode --test test/delegation.test.ts → ok 12/12\n`;

/** Repo mit Integrationszweig „dev“ (Prüfbefehle) und Strang-Zweig „main“. */
export function repo(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  g(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  mkdirSync(join(dir, '.werkbank'), { recursive: true });
  writeFileSync(join(dir, '.werkbank', 'pruefungen.json'), JSON.stringify({ pruefungen: [
    { name: 'laeuft', befehl: ['node', '-e', 'process.exit(0)'] },
    { name: 'a-da', befehl: ['test', '-f', 'a.txt'] },
    { name: 'mit-shell', befehl: 'echo nie' },   // ungültig: Befehl als Text (Shell) — wird verworfen
  ] }));
  mkdirSync(join(dir, 'pkg', 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'pkg', 'index.js'), '\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'start');
  g(dir, 'branch', 'dev');
  return dir;
}

