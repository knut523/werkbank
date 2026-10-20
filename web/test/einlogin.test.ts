// Plan 213 S9 (D7, P8): Ein Login — Direktadresse leitet mit derselben Unterseite in den Chat; jede alte Adresse bleibt Alias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einLoginZiel, einLoginUmleiten } from '../src/einlogin.ts';

const ALTE = ['#/', '#/uebersicht', '#/heute', '#/leitstand', '#/inbox', '#/arbeit', '#/arbeit/reviews', '#/board', '#/sprint', '#/timebox',
  '#/roadmap', '#/ziele', '#/wissen', '#/wissen/olaf/2-Areas/x y.md', '#/dateien', '#/ablage', '#/skills', '#/einrichtung', '#/board?key=PM-1&x=1'];

test('Alias-Test je Adresse: der Hash kommt unverändert im Chat an (/wb/…?h=)', () => {
  for (const h of ALTE) {
    const u = new URL(einLoginZiel('https://chat.example.org/', h));
    assert.equal(u.origin + u.pathname, 'https://chat.example.org/wb/heute', h);
    assert.equal(u.searchParams.get('h'), h, h);
  }
  assert.equal(new URL(einLoginZiel('https://chat.example.org', '')).searchParams.get('h'), '#/');
  assert.equal(new URL(einLoginZiel('https://chat.example.org', 'javascript:x')).searchParams.get('h'), '#/', 'nur Hash-Adressen');
});

test('Umleiten nur mit Schalter, nur direkt, Notausgang ?direkt=1', () => {
  assert.equal(einLoginUmleiten({ an: false, embedded: false, search: '' }), false, 'Vorgabe aus (Rückfallweg P7)');
  assert.equal(einLoginUmleiten({ an: true, embedded: false, search: '' }), true);
  assert.equal(einLoginUmleiten({ an: true, embedded: true, search: '?embed=1' }), false);
  assert.equal(einLoginUmleiten({ an: true, embedded: false, search: '?direkt=1' }), false);
});

test('Schalter S9 aus der Umgebung, Vorgabe aus', async () => {
  const { einLogin } = await import('../server/zustand.ts');
  assert.equal(einLogin({}), false); assert.equal(einLogin({ WERKBANK_EIN_LOGIN: '1' }), true);
});

test('Pass C: ohne absolute Chat-Adresse keine Umleitung', () => {
  assert.equal(einLoginUmleiten({ an: true, embedded: false, search: '', librechatUrl: '' }), false);
  assert.equal(einLoginUmleiten({ an: true, embedded: false, search: '', librechatUrl: '/' }), false);
  assert.equal(einLoginUmleiten({ an: true, embedded: false, search: '', librechatUrl: 'https://chat.example.org' }), true);
});
