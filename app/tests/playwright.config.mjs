import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Standalone Playwright config for the drawde viewer regression suite.
 *
 * Deliberately NOT the Playwright MCP server: this owns its own Chromium and its
 * own vite dev server, so it runs headless and unattended without fighting a
 * browser that a human session is also driving.
 *
 * The dev server runs on 5181 (NOT the 5180 a human session typically uses).
 * `reuseExistingServer` means an already-running 5181 is reused; otherwise
 * Playwright starts vite and tears it down when the run ends.
 * Override with DRAWDE_TEST_PORT=<n>.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DRAWDE_TEST_PORT || 5181);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: resolve(APP_ROOT, 'tests'),
  // The suite mutates one shared document + a module-level region store per page,
  // but each test gets a fresh page. Serial keeps the PDFium/WASM cost sane and
  // makes the vite dev server's first-request compile happen exactly once.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: resolve(APP_ROOT, 'tests', '.artifacts'),
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: APP_ROOT,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
