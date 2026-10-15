// Messung „Wartet auf dich“ (docs/plan-heute-fragen-aktuell.md): wie viele leere „- Knut:“-Zeilen roh, offen,
// vermutlich überholt, doppelt — je Quelle und Grund. Liest nur.
// Aufruf (im Ordner web/): node ../scripts/fragen-messung.ts [/vault] [open|cleanup|duplicates]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex } from '../web/server/vault.ts';
import { collectDecisions, todayQuestions } from '../web/server/fragen.ts';

const V = process.argv[2] ?? '/vault', B = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
const idx = buildIndex(V);
const { decisions, texts } = collectDecisions(idx, (p) => { try { return readFileSync(join(V, p), 'utf8'); } catch { return ''; } }, B);
const r = todayQuestions(decisions, { texts, fm: (p) => idx.notes.get(p)?.fm, today: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) });
const by = (xs: any[], k: (x: any) => string) => xs.reduce((a, x) => ((a[k(x)] = (a[k(x)] ?? 0) + 1), a), {} as Record<string, number>);
const src = (x: any) => (x.state === 'Übersicht' ? x.spec : x.state);
console.log({ roh: r.raw, offen: r.open.length, ueberholt: r.cleanup.length, doppelt: r.duplicates.length });
console.log('roh nach Quelle', by(decisions, src));
console.log('offen nach Quelle', by(r.open, src));
console.log('überholt nach Grund', by(r.cleanup, (x) => x.reason.replace(/\s*\(.*\)|„.*“/, '…')));
console.log('offen: zuerst', r.open.filter((x) => x.first).length, '· älter als 14 Tage', r.open.filter((x) => x.old).length, '· teilweise entschieden', r.open.filter((x) => x.partly).length);
const list = process.argv[3] as 'open' | 'cleanup' | 'duplicates' | undefined;
if (list) for (const x of r[list]) console.log([x.state, x.spec, x.line, x.id ?? '', x.reason ?? '', x.head.replace(/\s+/g, ' ').slice(0, 110), x.register.map((y) => y.id).join(',')].join('\t'));
