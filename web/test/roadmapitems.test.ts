// Paket 436, Runde 7: Roadmap-Items je Thema aus dem Vault (roadmapitems.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { roadmapItems, titelAus, ROADMAP_WURZEL } from '../server/roadmapitems.ts';

test('Roadmap-Items: Thema aus dem Ordner, Zustand aus dem Unterordner, Titel aus dem Frontmatter; Übersichten nicht', () => {
  const v = mkdtempSync(join(tmpdir(), 'rm-'));
  const w = join(v, ROADMAP_WURZEL);
  mkdirSync(join(w, 'Bot', '3-Plan'), { recursive: true });
  mkdirSync(join(w, 'Service-View', '1-Backlog'), { recursive: true });
  mkdirSync(join(w, '0-Overview'), { recursive: true });
  writeFileSync(join(w, 'Bot', '0-bot-uebersicht.md'), '---\ntitle: "Übersicht"\n---\n');
  writeFileSync(join(w, 'Bot', '3-Plan', 'bot-handover.md'), '---\ntitle: "olaf — Spec: Übergabe an Menschen"\n---\n# x\n');
  writeFileSync(join(w, 'Service-View', '1-Backlog', 'fall-suche.md'), '# ohne Kopf\n');
  writeFileSync(join(w, '0-Overview', 'x.md'), '---\ntitle: "nein"\n---\n');
  const l = roadmapItems(v, (o) => (o === 'Service-View' ? 'Service' : o));
  assert.deepEqual(l.map((x) => [x.thema, x.titel, x.stand]), [['Bot', 'Übergabe an Menschen', 'geplant'], ['Service', 'fall suche', 'Backlog']]);
  assert.match(l[0].path, /^olaf\/2-Areas\/Product\/Produkt-OLAF\/1-Roadmap\/Bot\/3-Plan\/bot-handover\.md$/);
  assert.deepEqual(roadmapItems(join(v, 'gibt-es-nicht'), (o) => o), [], 'ohne Vault: leer, kein Fehler');
  assert.equal(titelAus('---\ntitle: Ohne Anführungszeichen\n---\n', 'a.md'), 'Ohne Anführungszeichen');
});
