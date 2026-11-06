// Werkbank 2.0: reine Formathilfen der Oberfläche (getestet in test/format.test.ts).

/** „vor 5 Min.“, „heute 14:05“, „gestern 09:10“, „28.10.“ — immer Wiener Zeit. */
export function wann(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.round((now - t) / 60_000);
  if (min >= 0 && min < 1) return 'gerade eben';
  if (min >= 1 && min < 60) return `vor ${min} Min.`;
  const tag = (x: number) => new Date(x).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' });
  const uhr = new Date(t).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false });
  if (tag(t) === tag(now)) return `heute ${uhr}`;
  if (tag(t) === tag(now - 86400_000)) return `gestern ${uhr}`;
  return new Date(t).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit' }).replace(/\.?$/, '.');
}

/** S16: Präfix der App aus <base href> (vom Server gesetzt): '' direkt, '/werkbank' über den LibreChat-Proxy. */
export const praefix = (): string => (typeof document === 'undefined' ? '' : (document.querySelector('base')?.getAttribute('href') ?? '/').replace(/\/$/, ''));
/** Logischer Pfad ohne Präfix und ohne führenden Schrägstrich: '/werkbank/v2/arbeit' → 'v2/arbeit'. */
export const logisch = (pathname: string, p = praefix()): string => (p && pathname.startsWith(p + '/') ? pathname.slice(p.length + 1) : pathname.replace(/^\//, ''));
/** Vom Server gelieferte Adressen ('/v2/…', '/api/…') relativ machen, damit sie unter jedem Präfix gehen; alles andere bleibt. */
export const rel = (u: string): string => (/^\/(v2|api)(\/|\?|$)/.test(u) ? u.slice(1) : u);

/** Interne 2.0-Adresse? (dann ohne Neuladen navigieren, sonst neuer Tab) */
export const istIntern = (url: string) => { const r = rel(url); return r === 'v2' || r.startsWith('v2/') || r.startsWith('v2?'); };

/** Gerendertes HTML (Notiz oder Bericht) auf die 2.0-Adressen umbiegen: Notiz-Links, Bericht-Dateien, Bilder. */
export function htmlFuerV2(html: string): string {
  return html
    .replace(/href="#\/wissen\/([^"]+)"/g, (_m, p) => `href="v2/dokument?vault=${encodeURIComponent(decodeURIComponent(p))}"`)
    .replace(/href="\/?api\/files\/agenten\/([^/"]+)\/([^"?]+\.md)"/g, (_m, paket, datei) => `href="v2/dokument?paket=${paket}&amp;datei=${encodeURIComponent(decodeURIComponent(datei))}"`)
    .replace(/(src|href)="\/(api|v2)\//g, '$1="$2/');   // S16: relativ, damit Bilder und Links unter /werkbank gehen
}

/** Zahl in Worten für kleine Zahlen in Sätzen („eine Frage“, „3 Fragen“). */
export const mehrzahl = (n: number, eins: string, viele: string) => (n === 1 ? `1 ${eins}` : `${n} ${viele}`);

/** Vorbereiteter Text für „Im Chat fragen“. */
export function chatFrage(titel: string, worum: string): string {
  return `Was ist das, und was soll ich tun? „${titel}“${worum ? ` — ${worum}` : ''}`.slice(0, 1500);
}

/** Vorbelegung „Im Chat besprechen“ an einer Entscheidung (S15): der Chat kennt Titel, Empfehlung und Kennung. */
export function chatBesprechen(titel: string, empfehlung: string | null, id: string): string {
  return `Lass uns diese Entscheidung besprechen, bevor ich antworte (${id}): „${titel}“${empfehlung ? ` — Empfehlung: ${empfehlung}` : ''}. Was spricht dafür, was dagegen?`.slice(0, 1500);
}

/** S22 (Christoph B5): am Handy werden Tabellen zu Blöcken und der Kopf verschwindet — deshalb bekommt jede Zelle ihren Spaltennamen
 *  (`data-label`), den das CSS dort davor zeigt. Rein über den HTML-Text (markdown-it erzeugt einfache Tabellen ohne Attribute). */
export function tabellenBeschriften(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (ganz, inhalt: string) => {
    const kopf = /<thead>([\s\S]*?)<\/thead>/.exec(inhalt)?.[1] ?? '';
    const namen = [...kopf.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/"/g, '&quot;').trim());
    if (!namen.length || !inhalt.includes('</tr>')) return ganz;   // ohne geschlossene Zeilen nichts anfassen (Pass C)
    const koerper = inhalt.replace(/<tr>([\s\S]*?)<\/tr>/g, (zeile, z: string) => {
      if (z.includes('<th')) return zeile;
      let i = 0;
      return `<tr>${z.replace(/<td(\s[^>]*)?>/g, (_m, attr = '') => `<td${attr} data-label="${namen[i++] ?? ''}">`)}</tr>`;
    });
    return `<table>${koerper}</table>`;
  });
}

/** Runde 4 (Knut B12): Statuszeilen der Brücke („*⏳ Claude arbeitet …*“, eine kursive Zeile je Werkzeug) gehören zum Laufen —
 *  in der fertigen Antwort stehen sie nicht mehr. Wie der Status-Takt (orchestrator `excerpt`): nur ganze kursive Zeilen. */
// Pass C: nur Zeilen, die mit einem Symbol/Emoji beginnen (so schreibt die Brücke sie) — echte kursive Zeilen einer Antwort bleiben.
export const ohneStatuszeilen = (t: string): string => t.replace(/^[ \t]*\*[\p{Extended_Pictographic}\u23e9-\u23fa\u2600-\u27bf][^*\n]*\*[ \t]*$\n?/gmu, '').replace(/\n{3,}/g, '\n\n').trim();

/** Chat-Bereich (Knut 06.11.: „wirklich der normale Chatverlauf“): Text und Werkzeug-Schritte trennen — Statuszeilen der Brücke
 *  (dieselbe Erkennung wie ohneStatuszeilen) werden zu einklappbaren Gruppen, der übrige Text bleibt, wie er ist. */
const STATUSZEILE = /^[ \t]*\*([\p{Extended_Pictographic}⏩-⏺☀-➿][^*\n]*)\*[ \t]*$/u;
export type VerlaufTeil = { art: 'text'; text: string; zeilen: string[] } | { art: 'schritte'; text: string; zeilen: string[] };
export function verlaufTeile(t: string): VerlaufTeil[] {
  const out: VerlaufTeil[] = [];
  let text: string[] = [], schritte: string[] = [];
  const textAus = () => { const s = text.join('\n').trim(); if (s) out.push({ art: 'text', text: s, zeilen: [] }); text = []; };
  const schritteAus = () => { if (schritte.length) out.push({ art: 'schritte', text: '', zeilen: schritte }); schritte = []; };
  for (const z of String(t ?? '').split('\n')) {
    const m = z.match(STATUSZEILE);
    if (m) { textAus(); schritte.push(m[1].replace(/\\([\\*_\[\]<>])/g, '$1').trim()); }
    else if (!z.trim() && schritte.length) continue;   // Leerzeilen zwischen Schritten gehören dazu
    else { schritteAus(); text.push(z); }
  }
  textAus(); schritteAus();
  return out;
}
