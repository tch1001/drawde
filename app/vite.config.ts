import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5180 },
  // PDFium WASM ships as a .wasm asset; make sure it is not inlined
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
});
