// Fix 17d, Fund 2: Senden, während ein Chatwechsel aus der Seitenleiste noch lädt, ging in den vorigen Chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wechselStarten, wechselSperre, abholen } from '../../librechat/overlay/client/src/components/Werkbank/chatWechsel.ts';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

test('Ohne Wechsel: Senden geht durch', () => {
  assert.equal(wechselSperre(A, 'hallo', 0), false);
  assert.equal(abholen(A), null);
});

test('Wechsel A → B lädt noch: Senden in A gesperrt, Text wird für B vorgemerkt und dort einmal abgeholt', () => {
  wechselStarten(B, 1000);
  assert.equal(wechselSperre(A, 'für B gemeint', 1100), true, 'nicht in A senden');
  assert.equal(abholen(A), null, 'nicht in A');
  assert.deepEqual(abholen(B), { von: A, text: 'für B gemeint' });
  assert.equal(abholen(B), null, 'nur einmal');
  assert.equal(wechselSperre(B, 'jetzt in B', 1200), false, 'Ziel geladen: Senden geht wieder');
});

test('Wechsel hängt: nach 8 s gibt die Sperre frei (nichts bleibt dauerhaft blockiert)', () => {
  wechselStarten(B, 0);
  assert.equal(wechselSperre(A, 'x', 7000), true);
  assert.equal(wechselSperre(A, 'y', 9000), false);
  assert.equal(abholen(B)?.text, 'x');
});
