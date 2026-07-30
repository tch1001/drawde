/**
 * drawde viewer — regression suite.
 *
 * HARD RULE FOR THIS FILE: every gesture must go through Playwright's real input
 * pipeline — `page.mouse.*` / `page.keyboard.*`, which drive Chromium's native
 * input queue (CDP Input.dispatch*Event). NEVER `page.evaluate()` a synthetic
 * PointerEvent: synthetic events skip pointer capture, native image/text drag,
 * default-prevention and hit-testing, which is exactly the class of bug this
 * suite exists to catch. `page.evaluate` is used ONLY to read state, never to
 * simulate input.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

/* ────────────────────────────── geometry ──────────────────────────────
 * All drag coordinates are expressed relative to the top-left of page 0's
 * overlay layer (`.dd-layer`, which is inset:0 over the page image), so they
 * survive layout/zoom changes. sample.pdf is 612x792pt rendered at scale 1.
 */
type Pt = { dx: number; dy: number };

/** Blank-ish area under the title — a clean box target. */
const BOX_A: [Pt, Pt] = [{ dx: 100, dy: 180 }, { dx: 400, dy: 240 }];
/** A second, clearly different box target. */
const BOX_B: [Pt, Pt] = [{ dx: 130, dy: 300 }, { dx: 380, dy: 350 }];
/**
 * Along the 2nd line of the Abstract ("…include in their Hilbert space…").
 * MUST start ON a glyph: EmbedPDF's selection plugin only begins a *text*
 * selection when pointerdown hits a glyph; starting in whitespace silently
 * falls through to its marquee handler instead (see tests/README.md).
 */
const TEXT_A: [Pt, Pt] = [{ dx: 150, dy: 415 }, { dx: 430, dy: 417 }];

/* ────────────────────────────── helpers ────────────────────────────── */

const NOISE = [
  /\[vite\]/i,
  /Download the React DevTools/i,
  /favicon/i,
];

/** Navigate, wait for PDFium + first page bitmap, and collect console errors. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (NOISE.some((re) => re.test(t))) return;
    errors.push(`console.error: ${t}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // PDFium engine + document load gate the whole app shell.
  await page.waitForSelector('.dd-app', { timeout: 90_000 });

  // First page actually painted: RenderLayer emits an <img> with a blob: URL.
  await page.waitForFunction(
    () => {
      const img = document.querySelector<HTMLImageElement>('.dd-viewport img');
      return !!img && img.complete && img.naturalWidth > 0;
    },
    null,
    { timeout: 90_000 },
  );
  await page.waitForSelector('.dd-layer');
  return errors;
}

/** Bounding box of page N's overlay layer, in viewport coordinates. */
async function pageBox(page: Page, pageIndex = 0) {
  const layer = page.locator('.dd-layer').nth(pageIndex);
  await layer.waitFor({ state: 'attached' });
  const box = await layer.boundingBox();
  if (!box) throw new Error(`page ${pageIndex} has no layout box`);
  return box;
}

function abs(box: { x: number; y: number }, p: Pt) {
  return { x: box.x + p.dx, y: box.y + p.dy };
}

/**
 * A REAL mouse drag. Uses the native input queue, with intermediate moves so
 * pointermove actually fires and React has time to re-render the preview.
 */
async function realDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { shift?: boolean; steps?: number } = {},
) {
  const steps = opts.steps ?? 14;
  if (opts.shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await page.waitForTimeout(8);
    }
    await page.waitForTimeout(30);
    await page.mouse.up();
  } finally {
    if (opts.shift) await page.keyboard.up('Shift');
  }
  await page.waitForTimeout(120);
}

/** Drag expressed in page-0-relative coordinates. */
async function dragOnPage(page: Page, span: [Pt, Pt], opts: { shift?: boolean } = {}) {
  const box = await pageBox(page);
  await realDrag(page, abs(box, span[0]), abs(box, span[1]), opts);
}

async function setMode(page: Page, key: 'r' | 't') {
  await page.keyboard.press(key);
  const btn = page.locator('.dd-mode').nth(key === 'r' ? 0 : 1);
  await expect(btn).toHaveClass(/\bon\b/);
}

/** Persistent rectangles only — the in-flight preview shares the .dd-rect class. */
function rects(page: Page): Locator {
  return page.locator('.dd-rect:not(.dd-rect-preview)');
}
function cards(page: Page): Locator {
  return page.locator('.dd-card');
}

/* ────────────────────────────── tests ────────────────────────────── */

test.describe('drawde viewer', () => {
  test('1 · boots: PDFium loads, first page renders, no console errors', async ({ page }) => {
    const errors = await boot(page);

    const img = page.locator('.dd-viewport img').first();
    await expect(img).toBeVisible();
    const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(natural).toBeGreaterThan(100);

    await expect(page.locator('.dd-panel')).toBeVisible();
    await expect(page.locator('.dd-mode')).toHaveCount(2);

    // give async plugin work a beat to surface any late errors
    await page.waitForTimeout(1000);
    expect(errors, `unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('2 · pressing R activates region mode', async ({ page }) => {
    await boot(page);
    const region = page.locator('.dd-mode').nth(0);
    await expect(region).not.toHaveClass(/\bon\b/);
    await page.keyboard.press('r');
    await expect(region).toHaveClass(/\bon\b/);
    await expect(page.locator('.dd-mode').nth(1)).not.toHaveClass(/\bon\b/);
  });

  test('3 · pressing T activates text mode', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('r');
    await expect(page.locator('.dd-mode').nth(0)).toHaveClass(/\bon\b/);
    await page.keyboard.press('t');
    await expect(page.locator('.dd-mode').nth(1)).toHaveClass(/\bon\b/);
    await expect(page.locator('.dd-mode').nth(0)).not.toHaveClass(/\bon\b/);
  });

  test('4 · region drag draws a rect at the dragged coords and yields a crop card', async ({
    page,
  }) => {
    await boot(page);
    await setMode(page, 'r');

    const box = await pageBox(page);
    const from = abs(box, BOX_A[0]);
    const to = abs(box, BOX_A[1]);
    await realDrag(page, from, to);

    await expect(rects(page)).toHaveCount(1);

    // geometry: the persistent rect must land where the mouse actually went.
    const drawn = await rects(page).first().boundingBox();
    expect(drawn, 'rect has no layout box').not.toBeNull();
    const TOL = 6; // 1.5px border on each side + rounding
    expect(Math.abs(drawn!.x - Math.min(from.x, to.x))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.y - Math.min(from.y, to.y))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.width - Math.abs(to.x - from.x))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.height - Math.abs(to.y - from.y))).toBeLessThanOrEqual(TOL);

    // the panel card, and its async high-DPI crop
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
    const crop = page.locator('.dd-card .dd-crop');
    await expect(crop).toBeVisible({ timeout: 30_000 });
    const cropW = await crop.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(cropW, 'crop image did not decode').toBeGreaterThan(0);
  });

  test('5 · plain drag REPLACES the selection (2 drags → 1 region)', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);

    await dragOnPage(page, BOX_B);
    await expect(rects(page)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-count')).toHaveText('1');
  });

  test('6 · shift-drag ADDS to the selection (plain + shift → 2 regions)', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);

    await dragOnPage(page, BOX_B, { shift: true });
    await expect(rects(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('.dd-count')).toHaveText('2');
  });

  test('7 · clicking the ✕ on a rect removes it and its panel card', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await dragOnPage(page, BOX_B, { shift: true });
    await expect(rects(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(2);

    // panel meta is positional ("#1 · p.1"), so identify survivors by geometry
    const before = await rects(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.cssText),
    );
    expect(before).toHaveLength(2);

    // real click on the ✕ of the FIRST rect
    await page.locator('.dd-rect-x').first().click();

    await expect(rects(page)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-count')).toHaveText('1');

    const after = await rects(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.cssText),
    );
    expect(after, 'the wrong rectangle was removed').toEqual([before[1]]);
  });

  test('8 · text drag produces a text card with non-empty text', async ({ page }) => {
    await boot(page);
    await setMode(page, 't');

    await dragOnPage(page, TEXT_A);

    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
    const text = (await page.locator('.dd-card .dd-text').first().textContent()) ?? '';
    expect(text.trim().length, `text card was empty: ${JSON.stringify(text)}`).toBeGreaterThan(3);
  });

  test('9 · a box region and a shift-held text selection coexist', async ({ page }) => {
    await boot(page);

    await setMode(page, 'r');
    await dragOnPage(page, BOX_A);
    await expect(page.locator('.dd-kind-box')).toHaveCount(1);

    await setMode(page, 't');
    await dragOnPage(page, TEXT_A, { shift: true });

    await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
    await expect(cards(page)).toHaveCount(2);
  });

  test('10 · Escape clears all selections', async ({ page }) => {
    await boot(page);

    await setMode(page, 'r');
    await dragOnPage(page, BOX_A);
    await dragOnPage(page, BOX_B, { shift: true });
    await expect(cards(page)).toHaveCount(2);

    await page.keyboard.press('Escape');

    await expect(cards(page)).toHaveCount(0);
    await expect(rects(page)).toHaveCount(0);
    await expect(page.locator('.dd-empty')).toBeVisible();
  });
});
