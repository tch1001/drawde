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
  server: {
    host: '127.0.0.1',
    port: 5180,
    // DRAWDE_TUNNEL=1 when the dev server is reached through a cloudflared
    // tunnel. Two things break otherwise: Vite rejects a Host header it does
    // not recognise, and the HMR client tries to open a websocket back to
    // localhost:5180, which does not exist on the viewer's machine — it has to
    // be told the page is reachable over wss on 443 instead.
    // Opt-in: allowedHosts:true disables Vite's DNS-rebinding guard, which is
    // fine for a deliberately shared dev server and not fine by default.
    ...(process.env.DRAWDE_TUNNEL
      ? { allowedHosts: true as const, hmr: { clientPort: 443, protocol: 'wss' as const } }
      : {}),
  },
  // PDFium WASM ships as a .wasm asset; make sure it is not inlined
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
});
