// scripts/vorbau-check — G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md).
//
//   vorbau-check <spec-slug> [--plan DATEI] [--spec DATEI] [--repos DIR,DIR] [--ohne-pr] [--aufrufer NAME] [--json]
//     → {ergebnis: frei|fortsetzen|treffer|stopp, belege, hinweise, stopp?}. Exit 0 frei/fortsetzen · 10 treffer · 20 stopp · 2 Aufruf.
//     WERKBANK_VORBAU_CHECK=off (Umgebung oder .env.local) → „aus“, Exit 0: G0 abgeschaltet, gilt wie frei.
//     Repos: --repos, sonst WERKBANK_VORBAU_REPOS (Komma), sonst der aktuelle Ordner. Integrationszweig = origin/HEAD.
//     Fetch und PR-API nur mit dem Lesetoken (GIT_VW_READ=1 git credential fill); fehlt es → Stopp ohne Knopf.
//     --ohne-pr = Knopf „ohne PR-Prüfung bauen“ (nur tagsüber 06–22 Uhr, protokolliert). --ohne-fetch: Massenlauf (drift), nach dem ersten Fetch.
//   vorbau-check bilanz [--tage 28] [--json]        Fehlalarme/Fehltreffer aus dem G0-Protokoll
//   vorbau-check fehltreffer <slug> --beleg TEXT     später entdeckten Doppelbau eintragen
//
// Protokoll: VORBAU_PROTOKOLL (Vorgabe <werkbank>/.runtime/g0/protokoll.jsonl).
import { pruefe, bilanz, protokolliere, g0Text, OHNE_PR, vorbauAus, VORBAU_AUS_TEXT } from './vorbau.ts';

const args = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (['json', 'ohne-pr', 'ohne-fetch'].includes(k)) flags[k] = true; else flags[k] = args[++i] ?? ''; }
  else pos.push(a);
}
const str = (k: string) => (typeof flags[k] === 'string' ? flags[k] as string : undefined);
function die(msg: string, code = 2): never { process.stderr.write(`vorbau-check: ${msg}\n`); process.exit(code); }
const wienStunde = () => Number(new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }).format(new Date()));

async function main() {
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    const { readFileSync } = await import('node:fs');
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 13).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 0 : 2);
  }
  if (cmd === 'bilanz') {
    const b = bilanz(undefined, Number(str('tage') ?? 28));
    if (flags.json) return console.log(JSON.stringify(b, null, 1));
    console.log(`G0-Bilanz, letzte ${b.tage} Tage: ${b.pruefungen} Prüfungen, ${b.rueckfragen} Rückfragen/Stopps.`);
    console.log(`Knöpfe: ${Object.entries(b.knoepfe).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
    console.log(`Fehlalarme: ${b.fehlalarme} (davon nur „anderer Autor“: ${b.fehlalarmeAutor}) · Fehltreffer: ${b.fehltreffer.length}`);
    for (const f of b.fehltreffer) console.log(`  - ${f.at.slice(0, 10)} ${f.slug}: ${f.beleg}`);
    if (!b.autorKriteriumAktiv) console.log('→ Kriterium „anderer Autor“ ist abgeschaltet (mehr als ein Fehlalarm).');
    if (b.nachschaerfen) console.log('→ Mehr als 1 von 5 Rückfragen dieser Woche mit „trotzdem bauen“: Regel nachschärfen.');
    return;
  }
  if (cmd === 'fehltreffer') {
    if (!pos[1] || !str('beleg')) die('fehltreffer <slug> --beleg TEXT');
    protokolliere({ art: 'fehltreffer', slug: pos[1], beleg: str('beleg')!.slice(0, 500) });
    return console.log(`Fehltreffer eingetragen: ${pos[1]}`);
  }
  const slug = cmd;
  if (vorbauAus()) {   // WERKBANK_VORBAU_CHECK=off: Exit 0, Ergebnis „aus“ (gilt wie frei)
    if (flags.json) console.log(JSON.stringify({ ergebnis: 'aus', slug, belege: [], hinweise: [VORBAU_AUS_TEXT], kriterien: [] }, null, 1));
    else console.log(`AUS · ${slug}\n${VORBAU_AUS_TEXT}`);
    process.exit(0);
  }
  if (flags['ohne-pr']) {
    const h = wienStunde();
    if (h < 6 || h >= 22) die(`„${OHNE_PR}“ nur tagsüber (06–22 Uhr).`, 20);
    protokolliere({ art: 'knopf', slug, knopf: OHNE_PR, durch: 'cli', kriterien: [] });
  }
  const repos = (str('repos') ?? process.env.WERKBANK_VORBAU_REPOS ?? process.cwd()).split(',').map((x) => x.trim()).filter(Boolean);
  const r = await pruefe({ slug, planDatei: str('plan') ?? null, specDatei: str('spec'), repos, ohnePr: flags['ohne-pr'] === true, ohneFetch: flags['ohne-fetch'] === true, aufrufer: str('aufrufer') ?? 'cli' });
  if (flags.json) console.log(JSON.stringify(r, null, 1));
  else console.log(`${r.ergebnis.toUpperCase()} · ${slug}\n${g0Text(r)}`);
  process.exit(r.ergebnis === 'treffer' ? 10 : r.ergebnis === 'stopp' ? 20 : 0);
}

main().catch((e) => die(String(e?.message ?? e), 20));
