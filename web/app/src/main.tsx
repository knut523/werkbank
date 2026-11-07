// Werkbank 2.0: Einstieg der App unter /v2/ (web/server liefert sie aus, v2Index).
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { DeckTeilen } from './decks.tsx';
import { logisch } from './format.ts';
import './stil.css';

// Deck-Review: der Teil-Link für Externe (v2/teilen#<token>) braucht keine Anmeldung — eigene Seite ohne Hülle.
createRoot(document.getElementById('app')!).render(logisch(location.pathname) === 'v2/teilen' ? <DeckTeilen /> : <App />);
