import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Werkbank 2.0: eigene App, ausgeliefert von web/server unter /v2/ (Paket 436). Abhängigkeiten lösen aus web/node_modules auf.
// Entwicklung: `npm run dev` (5174) leitet /api an den laufenden Server weiter (WERKBANK_DEV_API, Vorgabe 3070).
export default defineConfig({
  plugins: [react()],
  base: '/v2/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 5174, proxy: { '/api': process.env.WERKBANK_DEV_API ?? 'http://127.0.0.1:3070' } },
});
