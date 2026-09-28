import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Providers } from './ui.tsx';
import './styles.css';

// Hell/Dunkel: gespeicherte Wahl, sonst System (wie LibreChat).
function initTheme() {
  let pref: string | null = null;
  try { pref = localStorage.getItem('werkbank-theme'); } catch { /* privat */ }
  const dark = pref ? pref === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
initTheme();

createRoot(document.getElementById('root')!).render(<Providers><App /></Providers>);
