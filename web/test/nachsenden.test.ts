// Fix 17d, Fund 1 (Knut 19.10.2026: „wenn ich in den Threads oben arbeite, kommen Nachrichten manchmal verwirrt an“):
// Nachgereichtes gehört zu der Unterhaltung, in der es geschrieben wurde — nicht zu der, die am Zugende gerade offen ist.
// Reine Logik aus librechat/overlay/client/src/components/Werkbank/nachsenden.ts (ohne LibreChat-Importe, daher hier testbar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zugende, nachsenden, type Eintrag } from '../../librechat/overlay/client/src/components/Werkbank/nachsenden.ts';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

test('Zugende im selben Chat: Ungelesenes geht wie bisher als nächste Nachricht über das Eingabefeld', () => {
  const xs: Eintrag[] = [{ conv: A, id: 'i1', text: 'eins', state: 'ungelesen' }, { conv: A, id: 'i2', text: 'zwei', state: 'gelesen' }, { conv: A, text: 'drei', state: 'danach' }];
  const p = zugende(xs, A, false);
  assert.equal(p.senden, 'eins\n\ndrei');
  assert.equal(p.zuruecklegen, null);
  assert.equal(p.fremd.size, 0);
});

test('Zugende nach einem Chatwechsel: nichts geht in den jetzt offenen Chat — weder gesendet noch ins Eingabefeld gelegt', () => {
  // Knut reicht in A nach, wechselt in B; LibreChat setzt beim Wechsel isSubmitting auf false → „Zugende“ mit B als aktivem Chat.
  const xs: Eintrag[] = [{ conv: A, id: 'i1', text: 'für A', state: 'ungelesen' }, { conv: A, text: 'auch für A', state: 'danach' }];
  const p = zugende(xs, B, false);
  assert.equal(p.senden, null, 'nicht über das Eingabefeld von B senden');
  assert.equal(p.zuruecklegen, null, 'nicht in das Eingabefeld von B legen');
  assert.deepEqual(p.fremd.get(A)?.map((x) => x.text), ['für A', 'auch für A']);
});

test('Zugende nach einem Wechsel, Zug in A läuft noch (zugestellt): auch das geht nicht ins Feld von B', () => {
  const p = zugende([{ conv: A, id: 'i1', text: 'für A', state: 'zugestellt' }], B, false);
  assert.equal(p.zuruecklegen, null);
  assert.equal(p.fremd.get(A)?.[0].state, 'zugestellt');
});

test('Gemischt: Einträge aus A und B — B über das Feld, A an seine eigene Unterhaltung; Gelesenes fällt weg', () => {
  const p = zugende([{ conv: A, id: 'a', text: 'a', state: 'ungelesen' }, { conv: A, id: 'g', text: 'g', state: 'gelesen' }, { conv: B, id: 'b', text: 'b', state: 'ungelesen' }], B, false);
  assert.equal(p.senden, 'b');
  assert.deepEqual(p.fremd.get(A)?.map((x) => x.text), ['a']);
});

test('Nach „Stopp“ oder bei „unbekannt“ im eigenen Chat: zurück ins Eingabefeld (wie bisher)', () => {
  assert.equal(zugende([{ conv: A, id: 'a', text: 'a', state: 'ungelesen' }], A, true).zuruecklegen, 'a');
  assert.equal(zugende([{ conv: A, id: 'a', text: 'a', state: 'unbekannt' }, { conv: A, id: 'b', text: 'b', state: 'ungelesen' }], A, false).zuruecklegen, 'a\n\nb');
});

test('Ohne Unterhaltung (neuer Chat beim Nachreichen): bleibt beim offenen Chat (bisheriges Verhalten)', () => {
  assert.equal(zugende([{ conv: null, text: 'x', state: 'danach' }], A, false).senden, 'x');
});

// ---------- nachsenden: Zustellung an die eigene Unterhaltung ----------
function deps(over: Partial<Parameters<typeof nachsenden>[2]> = {}) {
  const log: string[] = [];
  let t = 0;
  const d = {
    stand: async (_id: string) => 'ungelesen' as const,
    post: async (conv: string, text: string) => { log.push(`post ${conv} ${text}`); return 200; },
    entwurf: (conv: string, text: string) => { log.push(`entwurf ${conv} ${text}`); },
    hinweis: (text: string) => { log.push(`hinweis ${text}`); },
    sleep: async (ms: number) => { t += ms; },
    now: () => t,
    ...over,
  };
  return { d, log };
}

test('nachsenden: wartet, bis der Zug in A die Nachricht gelesen hat — gelesen = nichts senden', async () => {
  const st = ['zugestellt', 'zugestellt', 'gelesen'];
  const { d, log } = deps({ stand: async () => st.shift() as any });
  assert.equal(await nachsenden(A, [{ conv: A, id: 'i', text: 'x', state: 'zugestellt' }], d), 'gelesen');
  assert.ok(!log.some((l) => l.startsWith('post') || l.startsWith('entwurf')));
});

test('nachsenden: ungelesen → an A mit ausdrücklicher Unterhaltung; 409 (A noch beschäftigt) → später erneut', async () => {
  const codes = [409, 409, 200];
  const { d, log } = deps({ post: async (conv, text) => { log.push(`post ${conv} ${text}`); return codes.shift()!; } });
  assert.equal(await nachsenden(A, [{ conv: A, id: 'i', text: 'x', state: 'ungelesen' }, { conv: A, text: 'y', state: 'danach' }], d), 'gesendet');
  assert.deepEqual(log.filter((l) => l.startsWith('post')), [`post ${A} x\n\ny`, `post ${A} x\n\ny`, `post ${A} x\n\ny`]);
  assert.ok(log.some((l) => l.startsWith('hinweis')));
});

test('nachsenden: unbekannt (Brücke neu gestartet) → nie senden, sondern als Entwurf in A zurücklegen', async () => {
  const { d, log } = deps({ stand: async () => 'unbekannt' as any });
  assert.equal(await nachsenden(A, [{ conv: A, id: 'i', text: 'x', state: 'zugestellt' }], d), 'zurückgelegt');
  assert.deepEqual(log.filter((l) => !l.startsWith('hinweis')), [`entwurf ${A} x`]);
});

test('nachsenden: Fehler oder Frist abgelaufen → Entwurf in A, nichts geht verloren', async () => {
  const a = deps({ post: async () => 500 });
  assert.equal(await nachsenden(A, [{ conv: A, text: 'x', state: 'danach' }], a.d), 'zurückgelegt');
  assert.ok(a.log.includes(`entwurf ${A} x`));
  const b = deps({ post: async () => 409 });
  assert.equal(await nachsenden(A, [{ conv: A, text: 'x', state: 'danach' }], b.d), 'zurückgelegt');
  assert.ok(b.log.includes(`entwurf ${A} x`));
});
