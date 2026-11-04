// Runde 4 (Knut B5): Mermaid-Diagramme in Berichten zeichnen statt Quelltext zu zeigen. Der Server liefert sie als `<pre class="mermaid-src">`
// (wie für die alte Werkbank, dort web/src/mermaid.tsx — Importregel B6: hier eigene, schmale Fassung). mermaid wird erst geladen,
// wenn ein Bericht ein Diagramm hat (eigenes Bundle-Stück), mit securityLevel strict. Fehler: der Quelltext bleibt stehen.
import { useEffect, type RefObject } from 'react';

let lib: Promise<any> | null = null;
let n = 0;
const laden = () => (lib ??= import('mermaid').then((m) => { m.default.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 20_000, theme: 'neutral', flowchart: { htmlLabels: false } }); return m.default; }));

/** Schmal (< 600 px): flowchart/graph LR → TD, damit das Diagramm am Handy lesbar bleibt. */
export const fuerBreite = (code: string, breite: number) => (breite < 600 ? code.replace(/^(\s*(?:flowchart|graph))\s+(LR|RL)\b/m, '$1 TD') : code);

export function useDiagramme(ref: RefObject<HTMLElement | null>, dep: unknown) {
  useEffect(() => {
    const pres = [...(ref.current?.querySelectorAll<HTMLPreElement>('pre.mermaid-src') ?? [])];
    if (!pres.length) return;
    let lebt = true;
    for (const pre of pres) {
      laden().then((m) => m.render(`v2-mmd-${n++}`, fuerBreite(pre.textContent ?? '', innerWidth))).then(({ svg }: { svg: string }) => {
        if (!lebt || !pre.isConnected) return;
        const div = document.createElement('div');
        div.className = 'diagramm';
        div.innerHTML = svg;   // von mermaid (strict, DOMPurify) erzeugtes SVG
        pre.replaceWith(div);
      }).catch(() => pre.classList.add('diagramm-fehler'));
    }
    return () => { lebt = false; };
  }, [ref, dep]);
}
