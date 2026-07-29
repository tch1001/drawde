import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Standalone Playwright config for the drawde viewer regression suite.
 *
 * Deliberately NOT the Playwright MCP server: this owns its own Chromium and its
 * own vite dev server, so it runs headless in CI without fighting an MCP browser.
 *
 * The dev server is started on 5181 (NOT the 5180 a human session may be using).
 * `reuseExistingServer` means a already-running 5181 is reused; otherwise
 * Playwright starts vite and tears it down when the run ends.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DRAWDE_TEST_PORT || 5181);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: resolve(APP_ROOT, 'tests'),
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
    viewport: { width: 1400, height: 1000 },
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
