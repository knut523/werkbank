// port-hilfe (Plan P1): freiePorts(n) liefert n aktuell freie TCP-Ports auf 127.0.0.1.
// Geprüft: zwei Aufrufe liefern je 3 verschiedene Ports, und die Ports sind tatsächlich bindbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { freiePorts } from './port-hilfe.ts';

test('freiePorts(3) liefert je Aufruf 3 verschiedene Ports', async () => {
  const a = await freiePorts(3);
  const b = await freiePorts(3);
  assert.equal(a.length, 3);
  assert.equal(b.length, 3);
  assert.equal(new Set(a).size, 3);
  assert.equal(new Set(b).size, 3);
});

test('gelieferte Ports sind frei und bindbar', async () => {
  const ports = await freiePorts(2);
  const server = createServer();
  await new Promise<void>((r) => server.listen(ports[0], '127.0.0.1', () => r()));
  assert.equal((server.address() as any).port, ports[0]);
  await new Promise<void>((r) => server.close(() => r()));
});
