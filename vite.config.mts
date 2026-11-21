import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI. Tauri loads out/web in release builds and the dev server during `npm run dev`.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  build: { outDir: resolve(import.meta.dirname, 'out/web'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
