// Mermaid-Diagramme aus Berichten (docs/plan-leitstand.md, Teil C, C2/H6). Der Server liefert Diagramme nur als Text
// (`<pre class="mermaid-src">`); hier wird mermaid 10.9.8 erst bei Bedarf geladen (eigenes Bundle-Stück), mit securityLevel strict.
// Schmal (< 600 px): flowchart/graph LR → TD. Fehler beim Rendern: der Quelltext bleibt sichtbar.
import { useEffect, useRef, useState, type RefObject } from 'react';

let lib: Promise<any> | null = null;
let n = 0;
const load = () => (lib ??= import('mermaid').then((m) => {
  const mermaid = m.default;
  const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 20_000, theme: dark ? 'dark' : 'neutral', flowchart: { htmlLabels: false } });
  return mermaid;
}));

/** Schmale Ansicht: Diagramme von oben nach unten. */
export const fuerBreite = (code: string, width: number) => (width < 600 ? code.replace(/^(\s*(?:flowchart|graph))\s+(LR|RL)\b/m, '$1 TD') : code);

async function render(code: string): Promise<string> {
  const mermaid = await load();
  const { svg } = await mermaid.render(`mmd-${Date.now().toString(36)}-${n++}`, fuerBreite(code, window.innerWidth));
  return svg;
}

/** Ein Diagramm aus Text (z. B. „Diagramm ansehen“ auf der Karte). */
export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => { let alive = true; render(code).then((s) => alive && setSvg(s)).catch((e) => alive && setFehler(String(e?.message ?? e).slice(0, 200))); return () => { alive = false; }; }, [code]);
  if (fehler) return <div className="mmd-fehler"><p className="tiny rq-warn">Diagramm ließ sich nicht zeichnen: {fehler}</p><pre className="small">{code}</pre></div>;
  return svg ? <div className="mmd" data-testid="mermaid" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="tiny muted">Diagramm wird gezeichnet …</p>;
}

/** Alle `pre.mermaid-src` in einem gerenderten Bericht durch Diagramme ersetzen (nur wenn es welche gibt → sonst kein Laden). */
export function useMermaidIn(ref: RefObject<HTMLElement | null>, dep: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pres = [...el.querySelectorAll<HTMLPreElement>('pre.mermaid-src')];
    if (!pres.length) return;
    let alive = true;
    for (const pre of pres) {
      const code = pre.textContent ?? '';
      render(code).then((svg) => {
        if (!alive || !pre.isConnected) return;
        const div = document.createElement('div');
        div.className = 'mmd'; div.dataset.testid = 'mermaid';
        div.innerHTML = svg;   // von mermaid (securityLevel strict, DOMPurify) erzeugtes SVG
        pre.replaceWith(div);
      }).catch(() => { pre.classList.add('mmd-fehler'); });
    }
    return () => { alive = false; };
  }, [ref, dep]);
}
