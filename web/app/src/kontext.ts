import { createContext, useContext } from 'react';

export interface AppKontext {
  ich: { name: string; admin: boolean };
  /** Chat-Seitenleiste öffnen, optional mit vorbereitetem Text. */
  chat: (text?: string) => void;
  /** Die eine Zahl im Kopf nachziehen (nach einer Antwort oder einem frischen Abruf). */
  zahl: (n: number | null) => void;
  /** Adresse der alten Werkbank (für „Alte Werkbank“ und Freigaben). */
  alt: string;
}

export const Kontext = createContext<AppKontext>({ ich: { name: '', admin: false }, chat: () => {}, zahl: () => {}, alt: '' });
export const useApp = () => useContext(Kontext);
