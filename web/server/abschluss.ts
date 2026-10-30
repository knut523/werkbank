// Abschluss prüfen statt erbitten (R29 D, S2; Paket 159 V2, CrewAI-Guardrail-Muster): review_ready liest den Bericht des Strangs
// und weist ihn mit einem Beispiel zurück, wenn die Exec Summary oder die Entscheidungen nicht parsbar sind. Der Strang
// bekommt den Fehler im selben Aufruf und kann ihn beheben — kein Stop-Hook, keine Schleife.
// Schalter WERKBANK_ABSCHLUSS_PRUEFEN=on, Vorgabe aus. Kein gefundener Bericht = nichts zu prüfen.

import { berichtKopf, kopfMaengel, ersterMermaid } from './berichtkopf.ts';
import { entscheidungen } from './freigabe.ts';

export const abschlussAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_ABSCHLUSS_PRUEFEN === 'on';

const BEISPIEL_KOPF = `Beispiel für den Kopf von bericht.md:
---
status: wartet_auf_knut      # bereit_fuer_github | wartet_auf_knut | blockiert
titel: Ein Satz: was jetzt geht
worum: 2–3 Sätze für jemanden, der den Chat nicht kennt
anders:
  - Was jetzt anders ist
fragen:
  - id: D1
    frage: Die Frage in einem Satz
    empfehlung: Meine Empfehlung
    antwort: ""
---
plus ein Mermaid-Diagramm (\`\`\`mermaid) im Text.`;
const BEISPIEL_BLOCK = 'Beispiel für einen Entscheidungsblock im Text:\n**D1 — Kurzer Titel**\n- Empfehlung: …\n- Knut:';

/** null = in Ordnung, sonst der Grund mit Beispiel (geht als 400 an den Strang zurück). */
export function abschlussProblem(md: string | null | undefined): string | null {
  if (md == null) return null;
  const kopf = berichtKopf(md);
  if (!kopf) return `YAML-Kopf fehlt (status, titel, worum, anders …).\n${BEISPIEL_KOPF}`;
  if ('fehler' in kopf) return `${kopf.fehler}\n${BEISPIEL_KOPF}`;
  const maengel = kopfMaengel(kopf, ersterMermaid(md));
  if (maengel.length) return `Der Kopf (Exec Summary) ist unvollständig: ${maengel.join(', ')}.\n${BEISPIEL_KOPF}`;
  const ohneEmpf = kopf.fragen.filter((f) => !f.empfehlung);
  if (ohneEmpf.length) return `Frage ${ohneEmpf.map((f) => f.id).join(', ')} im Kopf hat keine Empfehlung — jede Frage braucht eine.\n${BEISPIEL_KOPF}`;
  const bloecke = entscheidungen(md);
  const ohneBlock = bloecke.filter((b) => !b.empfehlung);
  if (ohneBlock.length) return `Entscheidung ${ohneBlock.map((b) => b.id).join(', ')} hat keine Zeile „- Empfehlung:“.\n${BEISPIEL_BLOCK}`;
  const nenntEntscheidung = /^#{1,3}\s.*Entscheidung/im.test(md) || /^\s*[-*]?\s*\**Empfehlung/im.test(md);
  if (nenntEntscheidung && !kopf.fragen.length && !bloecke.length) return `Der Bericht nennt Entscheidungen, aber weder der Kopf (fragen:) noch der Text enthält einen parsbaren Block — Knut sähe sie nicht.\n${BEISPIEL_BLOCK}\noder im Kopf unter fragen:.`;
  return null;
}
