import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einwurfTitel, einwurfArt, einwurfPrompt, slug } from '../server/coseinwurf.ts';

test('Einwurf: Titel aus Vorgabe oder erster Textzeile, ohne Zeitstempel und Kopf', () => {
  assert.equal(einwurfTitel('x', 'Mein Titel · mit Trenner'), 'Mein Titel – mit Trenner');
  assert.equal(einwurfTitel('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHallo zusammen\n'), 'Hallo zusammen');
  assert.equal(einwurfTitel('Von: a@b.at\nAn: c@d.at\nBetreff: Vertrag\n\nText'), 'Betreff: Vertrag');
  assert.equal(einwurfTitel('\n\n'), 'ohne Titel');
  assert.equal(slug('Rogue: Vertrag für Ä/Ö ß'), 'rogue-vertrag-fur-a-o-ss');
});

test('Einwurf: Art des Materials', () => {
  assert.equal(einwurfArt('WEBVTT\n\n'), 'vtt');
  assert.equal(einwurfArt('1\n00:00:01,000 --> 00:00:02,000\nHi\n'), 'srt');
  assert.equal(einwurfArt('Von: x\nDatum: heute\nBetreff: y\n\nHallo'), 'mail');
  assert.equal(einwurfArt('irgendwas', 'notes.eml'), 'mail');
  assert.equal(einwurfArt('nur Notizen'), 'text');
});

test('Einwurf: Prompt trägt Titelzeile, Datei und Anleitung, nie den Text', () => {
  const p = einwurfPrompt({ titel: 'Flex', heute: '2026-10-16', datei: '/x/y.txt', art: 'text', zeichen: 12 }, 'ANLEITUNG');
  assert.match(p, /^Einwurf · 16\.10\. · Flex\n/);
  assert.match(p, /Arbeitskopie: \/x\/y\.txt/);
  assert.match(p, /ANLEITUNG$/);
});
