// Anhänge aus LibreChat erreichen die Claude-Sitzung: Datei-/Bild-Teile der letzten Nachricht werden
// in das Arbeitsverzeichnis der Person gelegt (anhaenge/<chat>/…) und im Prompt genannt.
// Nur erlaubte Typen, Größenlimit, keine Ausführungsrechte, Dateinamen bereinigt.

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, extname } from 'node:path';

export const MAX_FILE = Number(process.env.BRIDGE_ATTACH_MAX_MB || 20) * 1024 * 1024;
export const MAX_TOTAL = 3 * MAX_FILE;

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-excel': '.xls', 'application/msword': '.doc', 'message/rfc822': '.eml',
  'application/vnd.oasis.opendocument.text': '.odt', 'application/vnd.oasis.opendocument.spreadsheet': '.ods',
};
const ALLOWED_EXT = new Set([...Object.values(EXT_BY_MIME), '.jpeg', '.tsv']);

export interface Attachment { name: string; mime: string; data: Buffer }
export interface Saved { rel: string; name: string; mime: string; bytes: number }

export function safeName(name: string, mime: string, n: number): string {
  let base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
  if (!base) base = `anhang-${n}`;
  if (!extname(base) && EXT_BY_MIME[mime]) base += EXT_BY_MIME[mime];
  return base;
}

function fromDataUrl(url: string): { mime: string; data: Buffer } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  return m ? { mime: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') } : null;
}

/** Datei-Teile aus einem OpenAI-/LibreChat-Nachrichteninhalt. */
export function extractAttachments(content: unknown): Attachment[] {
  if (!Array.isArray(content)) return [];
  const out: Attachment[] = [];
  for (const p of content as any[]) {
    let d: { mime: string; data: Buffer } | null = null, name = '';
    if (p?.type === 'image_url') { d = fromDataUrl(String(p.image_url?.url ?? p.image_url ?? '')); name = p.image_url?.filename ?? ''; }
    else if (p?.type === 'file') { d = fromDataUrl(String(p.file?.file_data ?? '')); name = p.file?.filename ?? ''; }
    else if (p?.type === 'input_file') { d = fromDataUrl(String(p.file_data ?? '')); name = p.filename ?? ''; }
    else if (p?.type === 'image' && p.source?.type === 'base64') { d = { mime: String(p.source.media_type), data: Buffer.from(String(p.source.data), 'base64') }; }
    if (d) out.push({ name, mime: d.mime, data: d.data });
  }
  return out;
}

export function saveAttachments(scratch: string, convId: string, atts: Attachment[]): { saved: Saved[]; rejected: string[] } {
  const saved: Saved[] = [];
  const rejected: string[] = [];
  let total = 0;
  const sub = join('anhaenge', convId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'chat');
  atts.forEach((a, i) => {
    const name = safeName(a.name, a.mime, i + 1);
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) { rejected.push(`${name} (Typ nicht erlaubt)`); return; }
    if (a.data.length > MAX_FILE || total + a.data.length > MAX_TOTAL) { rejected.push(`${name} (zu groß)`); return; }
    total += a.data.length;
    const dir = join(scratch, sub);
    mkdirSync(dir, { recursive: true });
    let finalName = name;
    for (let k = 2; saved.some((s) => s.name === finalName); k++) finalName = name.replace(/(\.[^.]*)?$/, `-${k}$1`);
    writeFileSync(join(dir, finalName), a.data, { mode: 0o600 });
    chmodSync(join(dir, finalName), 0o600);
    saved.push({ rel: `${sub}/${finalName}`, name: finalName, mime: a.mime, bytes: a.data.length });
  });
  return { saved, rejected };
}

export function attachmentNote(saved: Saved[], rejected: string[]): string {
  if (!saved.length && !rejected.length) return '';
  const kb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const lines = saved.map((s) => `- ${s.rel} (${s.mime}, ${kb(s.bytes)})`);
  return [
    '',
    '---',
    saved.length ? `Angehängte Dateien (liegen in deinem Arbeitsverzeichnis, lies sie mit dem Read-Werkzeug; nicht ausführen):\n${lines.join('\n')}` : '',
    rejected.length ? `Nicht übernommen: ${rejected.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
