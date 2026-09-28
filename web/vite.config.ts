import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Entwicklung: `npm run dev` (5173) leitet /api und /fonts an den laufenden Server (3070) weiter.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3070', '/fonts': 'http://127.0.0.1:3070' } },
});
