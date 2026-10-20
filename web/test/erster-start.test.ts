// U5 (Walkthrough als neue Person): der erste Start des Leads braucht nur einen Satz; die Übergabe der Team-Instanz nennt weder Knut
// noch Pfade auf Knuts Maschine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mitErstemSatz } from '../src/erster-start.ts';
import { uebergabeTeile } from '../server/leitstand.ts';

const VORLAGE = ['## Stand (19.10.2026, 17:12, automatisch erzeugt)', '- Woran wir gerade arbeiten (ein bis drei Sätze): ', '- Was zuletzt entschieden wurde (mit Quelle): ', '',
  '## Offene Unter-Chats', 'Keine offenen Unter-Chats.', '', '## Was als Nächstes ansteht', '1. '].join('\n');

test('Erster Satz landet in „Woran wir gerade arbeiten“ und als erster nächster Schritt', () => {
  const t = mitErstemSatz(VORLAGE, '  Ich will verstehen,\n wie das Cockpit rechnet. ');
  assert.match(t, /^- Woran wir gerade arbeiten \(ein bis drei Sätze\): Ich will verstehen, wie das Cockpit rechnet\.$/m);
  assert.match(t, /^## Was als Nächstes ansteht\n1\. Ich will verstehen, wie das Cockpit rechnet\.$/m);
  assert.equal(mitErstemSatz(VORLAGE, '   '), VORLAGE, 'leerer Satz ändert nichts');
  assert.match(mitErstemSatz('## Stand', 'X'), /## Was als Nächstes ansteht\n1\. X$/, 'fehlt der Abschnitt, wird er angehängt');
});

test('Übergabe: Team-Instanz ohne Knut und ohne Knuts Maschine, Knuts Instanz unverändert', () => {
  const team = uebergabeTeile(true), knut = uebergabeTeile(false);
  assert.equal(team.fragenAn, 'Offene Rückfragen an dich');
  assert.doesNotMatch(team.register, /knut|compartment|~\/\.claude|~\/work\/dokumente/i);
  assert.match(team.register, /Nie mergen/);
  assert.equal(knut.fragenAn, 'Offene Rückfragen an Knut');
  assert.match(knut.register, /~\/work\/knut/);
});
