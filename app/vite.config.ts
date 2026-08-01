import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute, NOT './'. The app is served from arbitrarily deep paths
  // (/https://arxiv.org/pdf/1907.04392), and relative asset URLs would resolve
  // against that path, 404 into the SPA fallback, and hand the browser HTML
  // where it asked for JavaScript. This is why prefix routing needs root-based
  // assets — and why the app must be served from the domain root.
  base: '/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5180 },
  // PDFium WASM ships as a .wasm asset; make sure it is not inlined
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
});
