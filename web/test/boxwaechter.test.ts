// Box-Heartbeat (19.10.): Stufen aus echtem Speicher + Host frei; Meldung nur beim Stufenwechsel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxStufe } from '../server/boxwaechter.ts';

test('Stufen: ok · warnung (keine schweren Starts) · kritisch (gleich eng)', () => {
  assert.equal(boxStufe({ echtGb: 3, hostFreiGb: 14 }), 'ok');
  assert.equal(boxStufe({ echtGb: 9.5, hostFreiGb: 14 }), 'warnung');
  assert.equal(boxStufe({ echtGb: 3, hostFreiGb: 5 }), 'warnung', 'Nachbarn auf dem Host');
  assert.equal(boxStufe({ echtGb: 11.5, hostFreiGb: 14 }), 'kritisch');
  assert.equal(boxStufe({ echtGb: 3, hostFreiGb: 2.5 }), 'kritisch');
  assert.equal(boxStufe(null), 'ok', 'nicht lesbar → nicht falsch alarmieren');
});
