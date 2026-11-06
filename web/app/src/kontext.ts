// Werkbank 2.0: was jede Seite von der Hülle braucht (Person, Adresse der alten Werkbank, Chat öffnen, die Zahl, Testbetrieb).
import { createContext, useContext } from 'react';

export interface AppKontext {
  ich: { name: string; admin: boolean };
  /** Chat-Seitenleiste öffnen, optional mit vorbereitetem Text. */
  chat: (text?: string) => void;
  /** S12: einen eigenen 2.0-Chat in der Seitenleiste öffnen. */
  chatOeffnen: (conv: string) => void;
  /** Die eine Zahl im Kopf nachziehen (nach einer Antwort oder einem frischen Abruf). */
  zahl: (n: number | null) => void;
  /** Testbetrieb (Trockenlauf): Antworten an Notizen und Jira werden nicht geschrieben — die Fragen bleiben offen (Runde 3, B2/B3). */
  testbetrieb?: boolean;
  /** Adresse der alten Werkbank (für „Alte Werkbank“ und Freigaben). */
  alt: string;
}

export const Kontext = createContext<AppKontext>({ ich: { name: '', admin: false }, chat: () => {}, chatOeffnen: () => {}, zahl: () => {}, alt: '' });
export const useApp = () => useContext(Kontext);
