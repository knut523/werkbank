// Testports (Plan P3): die drei Brücken-Tests ensemble-bruecke, delegation und guard-strang-waechter banden feste
// TCP-Ports (34xx bzw. 33xx, im Quelltext als Zahl). Läuft ein zweiter Testlauf gleichzeitig oder hält ein fremder
// Dienst den Port, startet die Test-Brücke nicht oder das /health-Warten trifft einen fremden Server — rot oder Hänger.
// Der Wächter hier ist die DoD des Plans als Test: keine feste Portzahl mehr in diesen Dateien. Eine Umgebungsvariable
// WERKBANK_TEST_*PORT darf davorstehen (die Abnahme setzt sie auf freie Ports), der Rückfall muss aber freiePorts(n) sein.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATEIEN = ['ensemble-bruecke.test.ts', 'delegation.test.ts', 'guard-strang-waechter.test.ts'];
// Wortgleich mit der DoD-Prüfung des Plans: feste Zuweisung, feste Zahl hinter `||`, feste Zahl an `port:`/`ports:`.
const FESTER_PORT = /PORT\s*=\s*[0-9]{4,5}|\|\| ?[0-9]{4,5}[^0-9]|port[s]?:\s*[0-9]{4,5}/g;

test('keine festen Testports: die drei Brücken-Tests nehmen freiePorts(n)', () => {
  for (const datei of DATEIEN) {
    const text = readFileSync(join(import.meta.dirname, datei), 'utf8');
    const treffer = text.match(FESTER_PORT) ?? [];
    assert.deepEqual(treffer, [], `${datei}: feste Portzahl(en) ${JSON.stringify(treffer)} — freiePorts(n) aus ./port-hilfe.ts nehmen`);
    assert.match(text, /freiePorts\(/, `${datei}: nutzt freiePorts(n) aus ./port-hilfe.ts nicht`);
  }
});
