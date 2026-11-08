// Importwache (R13b): niemand startet einen Prozess, ohne child_process zu importieren. Darum wacht dieser Test
// über die Importe, nicht über Aufrufstellen (Regexe über Aufrufe verlieren gegen Zeilenumbruch, Alias, promisify,
// require, dynamic import). Neue Prozessstarts gehören in claude-bridge/src/prozesse.ts (starte()). Die Liste
// importwache.erlaubt.json ist eingefroren und darf nur schrumpfen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const MODULE = new Set(['child_process', 'node:child_process']);

/** Alle Verweise auf child_process in einem Quelltext: sortierte, eindeutige Namen ('*' = Modul als Ganzes). */
export function sammle(quelltext: string): string[] {
  const sf = ts.createSourceFile('x.ts', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const namen = new Set<string>();
  const behandelt = new Set<ts.Node>();
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && MODULE.has(n.moduleSpecifier.text)) {
      behandelt.add(n.moduleSpecifier);
      if (ts.isImportDeclaration(n)) {
        const c = n.importClause;
        if (!c) namen.add('*');
        else {
          if (c.name) namen.add('*');
          const b = c.namedBindings;
          if (b && ts.isNamespaceImport(b)) namen.add('*');
          else if (b && ts.isNamedImports(b)) for (const e of b.elements) namen.add((e.propertyName ?? e.name).text);
        }
      } else {
        const c = n.exportClause;
        if (!c || ts.isNamespaceExport(c)) namen.add('*');
        else for (const e of c.elements) namen.add((e.propertyName ?? e.name).text);
      }
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && MODULE.has(n.text) && !behandelt.has(n)) {
      // require('…'), import('…'), import x = require('…'), Argument eines Helfers, jede andere Nennung
      namen.add('*');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...namen].sort();
}

test('Sammler: statische Importe, Aliase, Re-Exports', () => {
  assert.deepEqual(sammle(`import { spawn as s } from 'node:child_process';`), ['spawn']);
  assert.deepEqual(sammle(`import { execFile, spawn as s, type ChildProcess } from 'child_process';`), ['ChildProcess', 'execFile', 'spawn']);
  assert.deepEqual(sammle(`import * as cp from 'node:child_process';`), ['*']);
  assert.deepEqual(sammle(`import cp from 'node:child_process';`), ['*']);
  assert.deepEqual(sammle(`import 'node:child_process';`), ['*']);
  assert.deepEqual(sammle(`export { exec as e, fork } from 'node:child_process';`), ['exec', 'fork']);
  assert.deepEqual(sammle(`export * from 'node:child_process';`), ['*']);
  assert.deepEqual(sammle(`export * as cp from 'child_process';`), ['*']);
});

test('Sammler: require, dynamic import, import = require, Umgehungen', () => {
  assert.deepEqual(sammle(`import cp = require('child_process');`), ['*']);
  assert.deepEqual(sammle(`const { spawn } = require('node:child_process');`), ['*']);
  assert.deepEqual(sammle(`const cp = require(\n  'node:child_process'\n);`), ['*']);
  assert.deepEqual(sammle(`const cp = require\n(\n'child_process'\n)`), ['*']);
  assert.deepEqual(sammle(`const { execFileSync } = await import('node:child_process');`), ['*']);
  assert.deepEqual(sammle(`import * as cp from 'node:child_process';\nconst run = promisify(cp.execFile);`), ['*']);
  assert.deepEqual(sammle(`ladeModul('node:child_process');`), ['*']);
  assert.deepEqual(sammle("const m = require(`child_process`);"), ['*']);
});

test('Sammler: harmlose Quelltexte liefern nichts', () => {
  assert.deepEqual(sammle(`import { readFileSync } from 'node:fs';\nconst s = 'child_process_x'; // child_process`), []);
});

// ---- Wache über den echten Baum ----
const REPO = join(import.meta.dirname, '..', '..');
const WURZELN = ['claude-bridge/src', 'web/server'];

function dateien(dir: string, aus: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) dateien(p, aus);
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) aus.push(p);
  }
  return aus;
}

function gefunden(): Record<string, string[]> {
  const aus: Record<string, string[]> = {};
  for (const w of WURZELN) {
    for (const f of dateien(join(REPO, w))) {
      const namen = sammle(readFileSync(f, 'utf8'));
      if (namen.length) aus[relative(REPO, f).split(sep).join('/')] = namen;
    }
  }
  return aus;
}

type Eintrag = { namen: string[]; grund: string };
const erlaubt: Record<string, Eintrag> = JSON.parse(readFileSync(join(import.meta.dirname, 'importwache.erlaubt.json'), 'utf8'));

test('Wache: jeder child_process-Import ist erlaubt', () => {
  const fehler: string[] = [];
  for (const [datei, namen] of Object.entries(gefunden()))
    for (const n of namen)
      if (!erlaubt[datei]?.namen.includes(n))
        fehler.push(`${datei}: imports ${n} from child_process — start processes via prozesse.ts starte(), or add it to importwache.erlaubt.json with a reason`);
  assert.deepEqual(fehler, []);
});

test('Wache: keine veralteten Einträge (die Liste schrumpft nur)', () => {
  const ist = gefunden();
  const fehler: string[] = [];
  for (const [datei, e] of Object.entries(erlaubt))
    for (const n of e.namen)
      if (!ist[datei]?.includes(n)) fehler.push(`${datei}: no longer imports ${n} from child_process — remove it from the list`);
  assert.deepEqual(fehler, []);
});

test('Wache: jeder Eintrag hat einen Grund', () => {
  const fehler = Object.entries(erlaubt).filter(([, e]) => typeof e.grund !== 'string' || !e.grund.trim() || !e.namen?.length).map(([d]) => d);
  assert.deepEqual(fehler, []);
});
