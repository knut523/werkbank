// Verschlüsselung für Zugangsdaten je Nutzer.
// - Werkbank-eigene Geheimnisse (Jira-Token): AES-256-GCM mit WERKBANK_CREDS_KEY (zufälliger IV je Wert).
// - Claude-Token im LibreChat-Schlüsselspeicher: dasselbe Verfahren wie LibreChat (AES-256-CBC mit
//   CREDS_KEY/CREDS_IV), damit LibreChat den hier eingetragenen Token direkt benutzen kann.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { cfg } from './config.ts';

function wbKey(): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(cfg.werkbankKey)) throw new Error('WERKBANK_CREDS_KEY fehlt oder ist ungültig (werkbank.sh up erzeugt ihn)');
  return Buffer.from(cfg.werkbankKey, 'hex');
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', wbKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function unseal(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1') throw new Error('unbekanntes Format');
  const d = createDecipheriv('aes-256-gcm', wbKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

function lcKeyIv() {
  const key = Buffer.from(cfg.credsKey, 'hex');
  const iv = Buffer.from(cfg.credsIv, 'hex');
  if (key.length !== 32 || iv.length !== 16) throw new Error('CREDS_KEY/CREDS_IV fehlen');
  return { key, iv };
}

/** Wie LibreChat `encrypt` (Legacy v1): AES-CBC, hex. */
export function librechatEncrypt(value: string): string {
  const { key, iv } = lcKeyIv();
  const c = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([c.update(value, 'utf8'), c.final()]).toString('hex');
}

export function librechatDecrypt(hex: string): string {
  const { key, iv } = lcKeyIv();
  const d = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8');
}

export const fingerprint = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);
