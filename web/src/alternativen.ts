// Alternativen statt Freitext (Knut 20.10.2026: „bei anders muss ich immer schreiben, aber es gibt oft nur 2-3 andere Vorschläge …
// einfach auswählen statt schreiben“). Rein — Übersicht und Entscheidungsseite antworten damit gleich, der Test liest dieselbe Regel.

/** Antworttext einer gewählten Alternative: „Anders: <Alternative>“, eine Notiz (optional) mit Gedankenstrich dahinter. */
export const altText = (alt: string, notiz = '') => `Anders: ${alt.trim()}${notiz.trim() ? ` — ${notiz.trim()}` : ''}`;
