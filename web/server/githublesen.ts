// Privates GitHub nur lesen für den Lead (Paket 217, Lücke 3; Knut 19.10.): feste Liste lesender REST-Pfade, Lesetoken des Servers,
// Schreiben bleibt beim Freigabeweg. Rein (testbar).

const REPO = String.raw`([\w.-]{1,100}\/[\w.-]{1,100})`;
const ERLAUBT = new RegExp('^repos/' + REPO + String.raw`/(` + [
  String.raw`pulls(/\d{1,7}(/(files|commits|reviews|comments))?)?`,
  String.raw`issues(/\d{1,7}(/comments)?)?`,
  String.raw`contents(/[\w.\-/]{0,300})?`,
  String.raw`commits(/[0-9a-f]{7,40})?`,
  String.raw`compare/[\w.\-/]{1,120}\.\.\.[\w.\-/]{1,120}`,
  String.raw`branches(/[\w.\-/]{1,120})?`,
  String.raw`actions/runs`,
  String.raw`commits/[0-9a-f]{7,40}/check-runs`,
].join('|') + ')$');
const QUERY = /^(per_page|page|state|ref|sha|path|head|base|sort|direction)=[\w.\-/:]{1,120}$/;

/** „repos/o/r/pulls/12?state=open“ → geprüfter Pfad und Repo, sonst Fehlertext. Keine `..`, keine fremden Endpunkte. */
export function githubLesePfad(roh: string): { pfad: string; repo: string } | { fehler: string } {
  const s = roh.trim().replace(/^https:\/\/api\.github\.com\//, '').replace(/^\//, '');
  const [pfad, q = ''] = s.split('?');
  // „..“ als Segment nirgends (auch nicht hinter „compare/“ — Pass C: contents/x/compare/../../user wäre sonst durchgegangen);
  // „a...b“ im Compare ist kein Segment „..“ und bleibt erlaubt.
  if (pfad.split('/').some((t) => t === '..' || t === '.')) return { fehler: 'Pfad mit „..“ ist nicht erlaubt.' };
  const m = ERLAUBT.exec(pfad);
  if (!m) return { fehler: 'Nur lesende Pfade: repos/<org>/<repo>/(pulls|issues|contents|commits|compare|branches|actions/runs)…' };
  const teile = q ? q.split('&') : [];
  if (teile.length > 6 || teile.some((t) => !QUERY.test(t))) return { fehler: 'Nur einfache Abfrageparameter (per_page, page, state, ref, sha, path, head, base, sort, direction).' };
  return { pfad: q ? `${pfad}?${q}` : pfad, repo: m[1] };
}

/** Antwort kürzen; Datei-Inhalte (contents, base64) werden lesbar gemacht. Höchstens 60 000 Zeichen. */
export function githubLeseText(text: string, max = 60_000): string {
  let out = text;
  try {
    const j = JSON.parse(text);
    if (j && !Array.isArray(j) && j.encoding === 'base64' && typeof j.content === 'string') out = `Datei ${j.path} (${j.size} Bytes):\n${Buffer.from(j.content, 'base64').toString('utf8')}`;
  } catch { /* kein JSON */ }
  return out.length > max ? `${out.slice(0, max)}\n… (gekürzt, ${out.length} Zeichen)` : out;
}
