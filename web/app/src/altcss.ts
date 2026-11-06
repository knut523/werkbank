// Das Stylesheet der alten Werkbank gilt in der 2.0 nur innerhalb der eingehängten alten Seiten (alt.tsx): jeder Selektor
// bekommt den Bereich vorangestellt, :root/body werden zum Bereich selbst, html/#root und das dunkle Thema fallen weg
// (die 2.0 ist hell). @media/@supports werden durchlaufen, @keyframes/@font-face bleiben unverändert.
export function scopeCss(css: string, scope: string): string {
  const quelle = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return block(quelle, scope);
}

function ende(s: string, auf: number): number {
  let tiefe = 0;
  for (let i = auf; i < s.length; i++) {
    if (s[i] === '{') tiefe++;
    else if (s[i] === '}' && --tiefe === 0) return i;
  }
  return s.length - 1;
}

function block(s: string, scope: string): string {
  let aus = '';
  let i = 0;
  while (i < s.length) {
    const auf = s.indexOf('{', i);
    if (auf < 0) break;
    const kopf = s.slice(i, auf).trim();
    const zu = ende(s, auf);
    const innen = s.slice(auf + 1, zu);
    i = zu + 1;
    if (!kopf) continue;
    if (/^@(media|supports|layer)\b/.test(kopf)) { const b = block(innen, scope); if (b.trim()) aus += `${kopf}{${b}}\n`; continue; }
    if (kopf.startsWith('@')) { aus += `${kopf}{${innen}}\n`; continue; }
    const sel = kopf.split(',').map((x) => selektor(x.trim(), scope)).filter(Boolean);
    if (sel.length) aus += `${sel.join(',')}{${innen}}\n`;
  }
  return aus;
}

function selektor(x: string, scope: string): string | null {
  if (!x || /data-theme=['"]?dark/.test(x)) return null;
  if (/^(html|#root)$/.test(x)) return null;
  const m = /^(:root|body)(?=$|[\s.:[>+~])/.exec(x);
  if (m) return scope + x.slice(m[1].length);
  return `${scope} ${x}`;
}
