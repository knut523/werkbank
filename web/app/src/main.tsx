// Werkbank 2.0: Einstieg der App unter /v2/ (web/server liefert sie aus, v2Index).
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './stil.css';

createRoot(document.getElementById('app')!).render(<App />);
