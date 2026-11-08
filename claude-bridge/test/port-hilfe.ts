// port-hilfe (Plan P1): freie TCP-Ports für Tests, damit parallele Testläufe (zwei Worktrees)
// sich nicht auf feste Ports beißen. Alle n Server werden GLEICHZEITIG geöffnet, erst wenn
// alle offen sind werden die Ports gelesen und erst dann alle geschlossen — so kann keine
// Doppelvergabe passieren.
import { createServer, type Server } from 'node:http';

export async function freiePorts(n = 1): Promise<number[]> {
  const servere: Server[] = [];
  const ports = await Promise.all(
    Array.from({ length: n }, () => new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => resolve((s.address() as any).port));
      servere.push(s);
    })),
  );
  await Promise.all(servere.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return ports;
}
