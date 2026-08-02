/**
 * drawde viewer — Playwright regression suite.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * HARD RULE FOR THIS FILE: every gesture goes through Playwright's REAL input
 * pipeline — `page.mouse.*`, `page.keyboard.*`, `locator.tap()`, which drive
 * Chromium's native input queue via CDP `Input.dispatch*Event`.
 *
 * NEVER `page.evaluate()` a synthetic PointerEvent. Synthetic events skip
 * pointer capture, hit-testing, default-prevention and — crucially — the
 * browser's native image/text drag. A shipped bug (the native HTML5 image drag
 * firing `dragstart` and CANCELLING the pointer stream, killing box drawing)
 * passed a synthetic-event suite and failed on every real mouse. `evaluate` is
 * used here ONLY to READ computed style / DOM state, never to simulate input.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, devices, type Page, type Locator } from '@playwright/test';

/* ───────────────────────────── geometry ─────────────────────────────
 * Drag coordinates are expressed relative to the top-left of a page's overlay
 * layer (`.dd-layer`, which is `inset: 0` over the page bitmap), so they are
 * independent of sidebar width / scroll position.
 * sample.pdf is Maldacena hep-th/9711200: 22 pages of 612x792pt, rendered 1:1
 * at 100% zoom, so these numbers are also PDF points.
 */
type Pt = { dx: number; dy: number };
type Span = [Pt, Pt];

/** Title block — blank-ish, a clean box target. */
const BOX_A: Span = [
  { dx: 100, dy: 180 },
  { dx: 400, dy: 240 },
];
/** Author / affiliation band — a clearly different second box target. */
const BOX_B: Span = [
  { dx: 130, dy: 300 },
  { dx: 380, dy: 350 },
];
/**
 * Abstract line 2 ("sions include in their Hilbert space a sector describing…").
 * MUST start ON a glyph: EmbedPDF's selection plugin only begins a text
 * selection when pointerdown hits a glyph run; starting in the margin falls
 * through to its marquee handler and silently selects nothing.
 */
const TEXT_A: Span = [
  { dx: 100, dy: 415 },
  { dx: 430, dy: 417 },
];
/** Abstract line 3 — a second, non-overlapping text target. */
const TEXT_B: Span = [
  { dx: 100, dy: 436 },
  { dx: 430, dy: 438 },
];

/* ───────────────────────────── helpers ───────────────────────────── */

/** Console output that is expected in a vite dev build and is not a defect. */
const CONSOLE_NOISE = [/\[vite\]/i, /Download the React DevTools/i, /favicon/i];

/**
 * Navigate, wait for the PDFium engine + document + first page bitmap, and
 * return the list of console errors collected from the very first navigation.
 */
/**
 * The bundled sample, addressed through the URL-prefix route.
 * Must match the port in playwright.config.mjs.
 */
const TEST_PORT = Number(process.env.DRAWDE_TEST_PORT || 5181);
const SAMPLE_URL = `http://127.0.0.1:${TEST_PORT}/sample.pdf`;

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (CONSOLE_NOISE.some((re) => re.test(t))) return;
    errors.push(`console.error: ${t}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // `/` is now the landing page — no paper opens by default — so address the
  // sample through the URL-prefix route instead. That exercises the real
  // prefix-parsing path, is deterministic (no click to race against), and
  // stays local so the suite never depends on arXiv being up.
  await page.goto(`/${SAMPLE_URL}`, { waitUntil: 'domcontentloaded' });

  // `.dd-app` only mounts once the WASM engine AND the document have loaded —
  // before that it is the `.dd-boot` spinner.
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

const abs = (box: { x: number; y: number }, p: Pt) => ({ x: box.x + p.dx, y: box.y + p.dy });

/**
 * A REAL mouse drag on the native input queue, with intermediate moves so
 * `pointermove` genuinely fires and React gets frames to render the preview.
 *
 * `holdShiftMs` keeps Shift down after mouseup. The text-selection path reads
 * the additive flag inside an async `getSelectedText().wait()` callback, so a
 * human's "release shift the instant the button comes up" is a real race — see
 * tests/README.md. 0 is the default; the mixing test uses a small hold.
 */
async function realDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { shift?: boolean; steps?: number; holdShiftMs?: number } = {},
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
    if (opts.shift && opts.holdShiftMs) await page.waitForTimeout(opts.holdShiftMs);
  } finally {
    if (opts.shift) await page.keyboard.up('Shift');
  }
  await page.waitForTimeout(120);
}

/** Drag expressed in page-relative coordinates. */
async function dragOnPage(
  page: Page,
  span: Span,
  opts: { shift?: boolean; holdShiftMs?: number; pageIndex?: number } = {},
) {
  const box = await pageBox(page, opts.pageIndex ?? 0);
  await realDrag(page, abs(box, span[0]), abs(box, span[1]), opts);
}

/**
 * Toolbar buttons, addressed by their (stable) title rather than by index —
 * `.dd-tools .dd-mode` also contains the lock toggle, and the order has already
 * changed once when pan mode was added.
 */
const tool = (page: Page, which: 'pan' | 'region' | 'text') =>
  page.locator(
    which === 'pan'
      ? '.dd-mode[title^="Pan"]'
      : which === 'region'
        ? '.dd-mode[title^="Select a region"]'
        : '.dd-mode[title^="Select text"]',
  );

const lockBtn = (page: Page) => page.locator('.dd-lock');

/**
 * Persistent selection rectangles. The in-flight preview shares `.dd-rect`, so
 * it is excluded. NB: BoxSelectLayer draws a `.dd-rect` for EVERY region on the
 * page, text ones included — so this counts regions, not just box regions.
 */
const rects = (page: Page): Locator => page.locator('.dd-rect:not(.dd-rect-preview)');
const cards = (page: Page): Locator => page.locator('.dd-card');

/** Press a mode key and assert the matching toolbar button lights up. */
async function setMode(page: Page, key: 'r' | 't' | 'h') {
  const which = key === 'r' ? 'region' : key === 't' ? 'text' : 'pan';
  await page.keyboard.press(key);
  await expect(tool(page, which)).toHaveClass(/\bon\b/);
}

const zoomPct = async (page: Page) => {
  const txt = (await page.locator('.dd-zoom > span').first().textContent()) ?? '';
  return parseInt(txt.replace('%', ''), 10);
};
const zoomOut = (page: Page) => page.locator('.dd-zoom button').nth(0);
const zoomIn = (page: Page) => page.locator('.dd-zoom button').nth(1);
const currentPage = async (page: Page) =>
  parseInt(await page.locator('.dd-pageinput').inputValue(), 10);

/** Type a page number into the page pill and commit it. */
async function gotoPage(page: Page, n: number) {
  const input = page.locator('.dd-pageinput');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(String(n));
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue(String(n));
}

const cssOf = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/**
 * Phone emulation: real touch (`hasTouch`), mobile UA, dpr 3, 390x844.
 *
 * `defaultBrowserType` is stripped deliberately — Playwright refuses a
 * `test.use({ defaultBrowserType })` inside a describe ("forces a new worker"),
 * and the config already pins chromium.
 */
const { defaultBrowserType: _ignored, ...PIXEL_5 } = devices['Pixel 5'];

/* ══════════════════════════════════════════════════════════════════════
   DESKTOP
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Keep the Texo weights out of the suite.
 *
 * OCR now starts the moment a region is drawn, so without this every
 * box-drawing test would pull a large model from huggingface.co and then burn
 * CPU decoding an equation no assertion looks at. That contention also made the
 * timing-sensitive text-selection tests flakier. Blocking it makes the run fast
 * and deterministic; test 21 asserts only that recognition was *entered*, which
 * holds whether the model loads or fails.
 */
test.beforeEach(async ({ page }) => {
  await page.route(/huggingface\.co|hf\.co/, (route) => route.abort());
});

test.describe('desktop · boot & modes', () => {
  test('1 · boots: PDFium engine loads, first page renders, no console errors', async ({
    page,
  }) => {
    const errors = await boot(page);

    // the boot spinner is gone, i.e. engine + document both resolved
    await expect(page.locator('.dd-boot')).toHaveCount(0);

    const img = page.locator('.dd-viewport img').first();
    await expect(img).toBeVisible();
    const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(natural, 'first page bitmap did not decode').toBeGreaterThan(100);

    // 22-page sample: the page pill knows the page count, so scroll state is live
    await expect(page.locator('.dd-pageind')).toContainText('/ 22');
    await expect(page.locator('.dd-panel')).toBeVisible();
    await expect(page.locator('.dd-sidebar')).toBeVisible();

    // let late async plugin work (thumbnails, tiles) surface any deferred errors
    await page.waitForTimeout(1500);
    expect(errors, `unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('2 · R / T switch tool and light the matching toolbar button', async ({ page }) => {
    await boot(page);

    // Region is the default tool ON DESKTOP, where the wheel scrolls and the
    // drag is free to draw. Touch opens in Pan instead — see the mobile test
    // '2c · touch opens in Pan so native scrolling survives'.
    await expect(tool(page, 'region')).toHaveClass(/\bon\b/);

    await setMode(page, 't');
    await expect(tool(page, 'region')).not.toHaveClass(/\bon\b/);

    await setMode(page, 'r');
    await expect(tool(page, 'text')).not.toHaveClass(/\bon\b/);

    // and the buttons themselves work, not just the keys
    await tool(page, 'text').click();
    await expect(tool(page, 'text')).toHaveClass(/\bon\b/);
    await tool(page, 'region').click();
    await expect(tool(page, 'region')).toHaveClass(/\bon\b/);

    // Pan is a TOUCH-ONLY tool: the button is `showPan = isMobile`, and a
    // `stranded` effect in ModeController bounces you straight back to Region if
    // you press H on a desktop viewport. Assert that contract rather than
    // pretending a Pan button exists here. (H → pan is covered by test 2b.)
    await expect(tool(page, 'pan')).toHaveCount(0);
    await page.keyboard.press('h');
    await page.waitForTimeout(300);
    await expect(tool(page, 'region'), 'H stranded the desktop user in a toolless mode').toHaveClass(
      /\bon\b/,
    );
  });
});

test.describe('desktop · region selection', () => {
  test('3 · a real mouse drag draws a rect at the dragged coords and yields a crop card', async ({
    page,
  }) => {
    await boot(page);
    await setMode(page, 'r');

    const box = await pageBox(page);
    const from = abs(box, BOX_A[0]);
    const to = abs(box, BOX_A[1]);
    await realDrag(page, from, to);

    await expect(rects(page)).toHaveCount(1);

    // Geometry: the persistent rect must land where the mouse actually went.
    // `box-sizing: border-box` is global, so the 1.5px border is inside the box.
    const drawn = await rects(page).first().boundingBox();
    expect(drawn, 'rect has no layout box').not.toBeNull();
    const TOL = 3;
    expect(Math.abs(drawn!.x - Math.min(from.x, to.x)), 'rect x').toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.y - Math.min(from.y, to.y)), 'rect y').toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.width - Math.abs(to.x - from.x)), 'rect width').toBeLessThanOrEqual(TOL);
    expect(Math.abs(drawn!.height - Math.abs(to.y - from.y)), 'rect height').toBeLessThanOrEqual(
      TOL,
    );

    // the panel card, and its async high-DPI crop (CROP_SCALE = 4)
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
    const crop = page.locator('.dd-card .dd-crop');
    await expect(crop).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => crop.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 30_000,
        message: 'crop image never decoded',
      })
      .toBeGreaterThan(0);
  });

  test('4 · plain drag REPLACES the selection (2 drags → 1 region)', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);

    await dragOnPage(page, BOX_B);
    await expect(rects(page)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-count')).toHaveText('1');
  });

  test('5 · shift-drag ADDS to the selection (plain + shift → 2 regions)', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);

    await dragOnPage(page, BOX_B, { shift: true });
    await expect(rects(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('.dd-count')).toHaveText('2');
  });

  test('6 · clicking a rect ✕ removes that rectangle and its panel card', async ({ page }) => {
    await boot(page);
    await setMode(page, 'r');

    await dragOnPage(page, BOX_A);
    await dragOnPage(page, BOX_B, { shift: true });
    await expect(rects(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(2);

    // Card meta is positional ("#1 · p.1"), so identify survivors by geometry.
    const before = await rects(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.cssText),
    );
    expect(before).toHaveLength(2);

    // a real click on the ✕ of the FIRST rect
    await page.locator('.dd-rect-x').first().click();

    await expect(rects(page)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-count')).toHaveText('1');

    const after = await rects(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.cssText),
    );
    expect(after, 'the wrong rectangle was removed').toEqual([before[1]]);
  });
});

test.describe('desktop · text selection & mixing', () => {
  test('7 · a real drag across a line of text produces a text card with non-empty text', async ({
    page,
  }) => {
    await boot(page);
    await setMode(page, 't');

    await dragOnPage(page, TEXT_A);

    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
    const text = (await page.locator('.dd-card .dd-text').first().textContent()) ?? '';
    expect(text.trim().length, `text card was empty: ${JSON.stringify(text)}`).toBeGreaterThan(3);
  });

  test('8 · a box region and a shift-held text selection coexist', async ({ page }) => {
    await boot(page);

    await setMode(page, 'r');
    await dragOnPage(page, BOX_A);
    await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);

    await setMode(page, 't');
    // Shift is released AT mouseup, with no grace period. This is the race the
    // text bridge used to lose: it read the additive flag inside the async
    // getSelectedText() callback, so a Shift released on mouseup turned an
    // additive selection into a replace. The bridge now latches the flag
    // synchronously in onEndSelection — keep this assertion strict so a
    // regression fails here instead of being masked by a hold.
    await dragOnPage(page, TEXT_A, { shift: true });

    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
    await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
  });

  test('9 · Escape clears all selections', async ({ page }) => {
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

test.describe('desktop · selection lock', () => {
  test('10 · the lock toggle makes plain drags additive, and Shift shows as via-shift', async ({
    page,
  }) => {
    await boot(page);
    await setMode(page, 'r');

    const lock = lockBtn(page);
    await expect(lock).not.toHaveClass(/\bon\b/);

    // ── holding Shift lights the same button, momentarily (dashed = via-shift)
    await page.keyboard.down('Shift');
    await expect(lock).toHaveClass(/\bvia-shift\b/);
    await expect(lock).toHaveClass(/\bon\b/);
    await page.keyboard.up('Shift');
    await expect(lock).not.toHaveClass(/\bvia-shift\b/);
    await expect(lock).not.toHaveClass(/\bon\b/);

    // ── locked: two PLAIN drags (no shift at all) must both stick
    await lock.click();
    await expect(lock).toHaveClass(/\bon\b/);
    await expect(lock).not.toHaveClass(/\bvia-shift\b/);

    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);
    await dragOnPage(page, BOX_B);
    await expect(rects(page)).toHaveCount(2);
    await expect(cards(page)).toHaveCount(2);

    // ── unlocked again: replace behaviour is restored
    await lock.click();
    await expect(lock).not.toHaveClass(/\bon\b/);
    await dragOnPage(page, BOX_A);
    await expect(rects(page)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(1);
  });
});

test.describe('desktop · zoom, paging & search', () => {
  test('11 · zoom buttons change the percentage and do NOT jump back to page 1', async ({
    page,
  }) => {
    await boot(page);

    await gotoPage(page, 10);
    const before = await currentPage(page);
    expect(before).toBe(10);
    const pctBefore = await zoomPct(page);
    expect(pctBefore).toBeGreaterThan(0);

    await zoomIn(page).click();
    await expect
      .poll(() => zoomPct(page), { message: 'zoom % did not increase' })
      .toBeGreaterThan(pctBefore);
    // the real regression: NaN in the scroll-preservation math sends you to p.1
    await page.waitForTimeout(600);
    expect(await currentPage(page), 'zooming in jumped the reader off their page').toBe(before);

    const pctZoomed = await zoomPct(page);
    await zoomOut(page).click();
    await expect
      .poll(() => zoomPct(page), { message: 'zoom % did not decrease' })
      .toBeLessThan(pctZoomed);
    await page.waitForTimeout(600);
    expect(await currentPage(page), 'zooming out jumped the reader off their page').toBe(before);
  });

  test('12 · four rapid PageDown presses advance exactly four pages', async ({ page }) => {
    await boot(page);
    expect(await currentPage(page)).toBe(1);

    // No waits between presses: this is the regression — a debounce/animation
    // that reads the *current* page swallows repeats and only moves one page.
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown');

    await expect
      .poll(() => currentPage(page), { message: 'rapid PageDown presses were swallowed' })
      .toBe(5);

    for (let i = 0; i < 2; i++) await page.keyboard.press('PageUp');
    await expect.poll(() => currentPage(page)).toBe(3);
  });

  test('13 · typing a page number and pressing Enter jumps there', async ({ page }) => {
    await boot(page);
    const viewport = page.locator('.dd-viewport');
    const scrollBefore = await viewport.evaluate((el) => el.scrollTop);

    await gotoPage(page, 17);

    expect(await currentPage(page)).toBe(17);
    const scrollAfter = await viewport.evaluate((el) => el.scrollTop);
    expect(scrollAfter, 'the viewport did not actually scroll').toBeGreaterThan(scrollBefore);
  });

  test('14 · Ctrl+F opens search and a real term yields a non-zero match count', async ({
    page,
  }) => {
    await boot(page);
    await expect(page.locator('.dd-search')).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.locator('.dd-search')).toBeVisible();
    await expect(page.locator('.dd-search input')).toBeFocused();

    await page.keyboard.type('supergravity');

    const count = page.locator('.dd-search-count');
    await expect(count).toHaveText(/^\d+ \/ \d+$/, { timeout: 60_000 });
    const total = parseInt((await count.textContent())!.split('/')[1].trim(), 10);
    expect(total, 'search found no matches for a term that is in the document').toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('.dd-search')).toHaveCount(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   MOBILE — real phone viewport + touch emulation (Pixel 5 descriptor)
   ══════════════════════════════════════════════════════════════════════ */

test.describe('mobile · responsive layout', () => {
  test.use({ ...PIXEL_5, viewport: { width: 390, height: 844 } });

  /**
   * Regression guard for laggy touch scrolling.
   *
   * A mode that draws by dragging must claim raw touch, and the interaction
   * manager implements that by setting `touch-action: none` on every page —
   * which disables the browser's native compositor scrolling across the whole
   * PDF and makes every scroll round-trip through JS. Pan mode declares
   * `wantsRawTouch: false`, so opening in Pan on touch keeps scrolling native.
   *
   * If a future change makes Region the default on touch again, this fails.
   */
  test('2c · touch opens in Pan so native scrolling survives', async ({ page }) => {
    await boot(page);

    await expect(tool(page, 'pan'), 'touch should open in Pan').toHaveClass(/\bon\b/);

    const pageTouchAction = () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll('.dd-viewport *')].find((e) =>
          (e.getAttribute('style') || '').includes('touch-action'),
        );
        return el ? getComputedStyle(el).touchAction : 'no-page-found';
      });

    expect(
      await pageTouchAction(),
      'pages must not disable native touch scrolling in the default touch tool',
    ).not.toBe('none');

    // ...and Region legitimately does claim touch, since it draws by dragging
    await setMode(page, 'r');
    expect(await pageTouchAction()).toBe('none');
  });

  test('2b · H activates pan mode, where the Pan button actually exists', async ({ page }) => {
    await boot(page);

    // touch layout: Pan replaces Text in the toolbar
    await expect(tool(page, 'pan')).toHaveCount(1);
    await expect(tool(page, 'text')).toHaveCount(0);

    await setMode(page, 'r');
    await expect(tool(page, 'region')).toHaveClass(/\bon\b/);

    await setMode(page, 'h');
    await expect(tool(page, 'region')).not.toHaveClass(/\bon\b/);

    await setMode(page, 'r');
    await expect(tool(page, 'pan')).not.toHaveClass(/\bon\b/);

    // and T must not strand a phone user in a tool with no button
    await page.keyboard.press('t');
    await page.waitForTimeout(300);
    await expect(tool(page, 'region'), 'T stranded the phone user in a toolless mode').toHaveClass(
      /\bon\b/,
    );
  });

  test('15 · the logo and the tool labels are hidden on a phone', async ({ page }) => {
    await boot(page);

    await expect(page.locator('.dd-app')).toHaveClass(/\bis-mobile\b/);
    // both are still in the DOM — the media query hides them
    await expect(page.locator('.dd-logo')).toHaveCount(1);
    await expect(page.locator('.dd-logo')).toBeHidden();
    expect(await cssOf(page.locator('.dd-logo'), 'display')).toBe('none');

    const labels = page.locator('.dd-lbl');
    expect(await labels.count()).toBeGreaterThan(0);
    expect(await cssOf(labels.first(), 'display')).toBe('none');
    await expect(labels.first()).toBeHidden();
  });

  test('16 · the hamburger opens the sidebar as an OVERLAY, with a scrim', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.dd-sidebar')).toHaveCount(0);

    const mainW = (await page.locator('.dd-main').boundingBox())!.width;

    await page.locator('.dd-burger').tap();

    const sidebar = page.locator('.dd-sidebar');
    await expect(sidebar).toBeVisible();
    expect(await cssOf(sidebar, 'position'), 'sidebar must overlay, not squeeze').toBe('absolute');

    // the PDF pane keeps the whole width underneath the drawer
    const viewerW = (await page.locator('.dd-viewer').boundingBox())!.width;
    expect(Math.abs(viewerW - mainW), 'the viewer was squeezed by the sidebar').toBeLessThanOrEqual(
      1,
    );

    await expect(page.locator('.dd-scrim')).toBeVisible();
    await expect(page.locator('.dd-burger')).toHaveClass(/\bon\b/);
  });

  test('17 · the chat button opens the context panel AND closes the sidebar', async ({ page }) => {
    await boot(page);

    await page.locator('.dd-burger').tap();
    await expect(page.locator('.dd-sidebar')).toBeVisible();

    await page.locator('.dd-chatbtn').tap();

    const panel = page.locator('.dd-panel');
    await expect(panel).toBeVisible();
    expect(await cssOf(panel, 'position')).toBe('absolute');
    // mutually exclusive: only one overlay at a time on a phone
    await expect(page.locator('.dd-sidebar')).toHaveCount(0);
    await expect(page.locator('.dd-chatbtn')).toHaveClass(/\bon\b/);

    // and back the other way
    await page.locator('.dd-burger').tap();
    await expect(page.locator('.dd-sidebar')).toBeVisible();
    await expect(page.locator('.dd-panel')).toHaveCount(0);
  });

  test('18 · tapping the scrim dismisses the open overlay', async ({ page }) => {
    await boot(page);

    await page.locator('.dd-burger').tap();
    const scrim = page.locator('.dd-scrim');
    await expect(scrim).toBeVisible();

    // The sidebar drawer covers min(86vw, 340px) of the scrim, so tap the
    // exposed strip on the right rather than the element's centre.
    const box = (await scrim.boundingBox())!;
    await scrim.tap({ position: { x: box.width - 15, y: box.height / 2 } });

    await expect(page.locator('.dd-sidebar')).toHaveCount(0);
    await expect(page.locator('.dd-scrim')).toHaveCount(0);
  });

  test('19 · the drag-to-resize splitters are not displayed', async ({ page }) => {
    await boot(page);

    // closed state
    await expect(page.locator('.dd-splitter')).toBeHidden();

    // and still not there once a pane is open (they are `!isMobile`-gated in
    // App.tsx AND `display: none` in the media query — belt and braces)
    await page.locator('.dd-burger').tap();
    await expect(page.locator('.dd-sidebar')).toBeVisible();
    await expect(page.locator('.dd-splitter')).toBeHidden();
  });

  test('20 · the zoom/page pill is position: fixed', async ({ page }) => {
    await boot(page);

    const meta = page.locator('.dd-meta');
    await expect(meta).toBeVisible();
    expect(await cssOf(meta, 'position')).toBe('fixed');

    // it floats over the PDF near the bottom, not in the top toolbar
    const metaBox = (await meta.boundingBox())!;
    const topBox = (await page.locator('.dd-top').boundingBox())!;
    expect(metaBox.y, 'the pill is still in the top bar').toBeGreaterThan(topBox.y + topBox.height);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * Chat pane: automatic OCR, text size, width, and the way home.
 * ═══════════════════════════════════════════════════════════════════════ */
test.describe('desktop · context pane', () => {
  test('21 · drawing a region starts OCR immediately, without a send', async ({ page }) => {
    await boot(page);
    await dragOnPage(page, BOX_A);

    // wait for the crop itself to land — OCR is kicked off from that callback
    await expect(page.locator('.dd-card .dd-crop')).toBeVisible({ timeout: 20_000 });

    // Deliberately NOT asserting that recognition succeeds: warming the Texo
    // model is a large download, and CI may have no route to it. What must be
    // true either way is that OCR was *entered* rather than deferred to Send —
    // so any terminal or in-flight state passes, and the old "wait for ask"
    // state does not exist any more.
    const stub = page.locator('.dd-card .dd-stub');
    await expect(stub).toHaveText(/reading…|OCR ✓|OCR failed/, { timeout: 20_000 });
    await expect(stub).not.toHaveText(/on ask/i);

    // and nothing was sent on the user's behalf
    await expect(page.locator('.dd-msg')).toHaveCount(0);
  });

  test('22 · A+/A− rescale the chat text, persist, and reset', async ({ page }) => {
    await boot(page);
    const panel = page.locator('.dd-panel');
    const val = page.locator('.dd-fontsize-val');
    await expect(val).toHaveText('100%');

    const composer = page.locator('.dd-composer-input');
    await dragOnPage(page, BOX_A); // the composer only exists with a selection
    const before = parseFloat(await cssOf(composer, 'font-size'));

    await page.locator('.dd-fontsize button[aria-label="Larger chat text"]').click();
    await page.locator('.dd-fontsize button[aria-label="Larger chat text"]').click();
    await expect(val).toHaveText('120%');
    expect(await cssOf(panel, '--dd-chat-scale')).toBe('1.2');
    const after = parseFloat(await cssOf(composer, 'font-size'));
    expect(after, 'the composer text actually grew').toBeGreaterThan(before);

    // survives a reload — it is a preference, not view state
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dd-app', { timeout: 90_000 });
    await expect(page.locator('.dd-fontsize-val')).toHaveText('120%');

    // the value doubles as the reset
    await page.locator('.dd-fontsize-val').click();
    await expect(page.locator('.dd-fontsize-val')).toHaveText('100%');
  });

  test('23 · the pane can be dragged past the old 720px cap, up to 70%', async ({ page }) => {
    await boot(page);
    const panel = page.locator('.dd-panel');
    const start = (await panel.boundingBox())!.width;

    // right-hand splitter: dragging LEFT widens the pane (App.tsx negates dx).
    // Overshoot hard so the clamp, not the gesture, decides where it stops.
    const sp = (await page.locator('.dd-splitter').last().boundingBox())!;
    await realDrag(
      page,
      { x: sp.x + sp.width / 2, y: sp.y + 200 },
      { x: 20, y: sp.y + 200 },
      { steps: 25 },
    );

    const widened = (await panel.boundingBox())!.width;
    const winW = await page.evaluate(() => window.innerWidth);
    expect(widened, 'wider than it started').toBeGreaterThan(start);
    expect(widened, 'past the old 720px ceiling').toBeGreaterThan(720);
    expect(widened, 'but not past 70% of the window').toBeLessThanOrEqual(winW * 0.7 + 2);
  });

  test('24 · clicking the drawde wordmark returns to the landing page', async ({ page }) => {
    await boot(page);
    await dragOnPage(page, BOX_A);
    await expect(page.locator('.dd-card')).toHaveCount(1);

    await page.locator('.dd-home').click();

    // the paper came from the URL, so this is a real navigation back to root
    await expect(page.locator('.dd-landing')).toBeVisible({ timeout: 90_000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('desktop · context snapshot on send', () => {
  /**
   * Sending is normally gated on an API key. The point here is the snapshot +
   * clear, which happens before any network call, so the request is stubbed to
   * fail fast — the user turn and its frozen context are rendered either way.
   */
  async function sendWithStubbedLlm(page: Page, text: string) {
    await page.route('**://api.anthropic.com/**', (r) => r.abort());
    await page.evaluate(() => {
      localStorage.setItem('drawde.key.anthropic', 'sk-ant-test');
      localStorage.setItem('drawde.model', 'claude-opus-5');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dd-app', { timeout: 90_000 });
    await page.waitForSelector('.dd-layer');
    await dragOnPage(page, BOX_A);
    await expect(page.locator('.dd-panel-body .dd-card')).toHaveCount(1);
    await page.locator('.dd-composer-input').fill(text);
    await page.locator('.dd-send').click();
  }

  test('25 · the sent selection is frozen above the message and the live context is emptied', async ({
    page,
  }) => {
    await boot(page);
    await sendWithStubbedLlm(page, 'what is this?');

    // the question carries its context with it …
    const snapshot = page.locator('.dd-msg-user .dd-msg-context .dd-card');
    await expect(snapshot).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.dd-msg-context-label')).toHaveText(/asked with 1 selection/);

    // … the crop survives being detached from the store (its object URL must
    // NOT have been revoked) …
    const crop = page.locator('.dd-msg-context .dd-crop');
    await expect(crop).toBeVisible();
    expect(
      await crop.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      'the snapshot crop still has pixels after detach',
    ).toBe(true);

    // … it is inert: no remove affordance on a sent selection …
    await expect(page.locator('.dd-msg-context .dd-card-x')).toHaveCount(0);

    // … and the live context is now empty, ready for a fresh selection.
    await expect(page.locator('.dd-context-strip .dd-card')).toHaveCount(0);
    await expect(page.locator('.dd-composer-input')).toHaveAttribute(
      'placeholder',
      /follow-up/i,
    );

    // a new selection lands in the empty live context, not on the old message
    await dragOnPage(page, BOX_B);
    await expect(page.locator('.dd-context-strip .dd-card')).toHaveCount(1);
    await expect(snapshot).toHaveCount(1);
  });

  test('26 · the text-size control scales model output too', async ({ page }) => {
    await boot(page);
    await dragOnPage(page, BOX_A);

    // .dd-md is what renders assistant markdown; it used to pin its own rem
    // size and ignore the scale entirely.
    const scaled = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'dd-md';
      document.querySelector('.dd-panel')!.appendChild(probe);
      const at = () => parseFloat(getComputedStyle(probe).fontSize);
      const before = at();
      (document.querySelector('.dd-panel') as HTMLElement).style.setProperty(
        '--dd-chat-scale',
        '1.5',
      );
      const after = at();
      probe.remove();
      return { before, after };
    });
    expect(scaled.after, 'model output grows with the chat scale').toBeGreaterThan(
      scaled.before,
    );
    expect(scaled.after / scaled.before).toBeCloseTo(1.5, 1);
  });
});

test.describe('desktop · saved conversations', () => {
  /** A stubbed streaming answer, so a thread exists without a real API key. */
  async function stubModel(page: Page, text = 'Because $\\frac{1}{N}$ is small.') {
    const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
    const body =
      `event: message_start\n${ev({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } })}` +
      `event: content_block_start\n${ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}` +
      `event: content_block_delta\n${ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}` +
      `event: content_block_stop\n${ev({ type: 'content_block_stop', index: 0 })}` +
      `event: message_delta\n${ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })}` +
      `event: message_stop\n${ev({ type: 'message_stop' })}`;
    await page.route('**://api.anthropic.com/**', (r) =>
      r.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
        body,
      }),
    );
    await page.evaluate(() => {
      localStorage.setItem('drawde.key.anthropic', 'sk-ant-test');
      localStorage.setItem('drawde.model', 'claude-opus-5');
    });
  }

  async function reboot(page: Page) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dd-app', { timeout: 90_000 });
    await page.waitForSelector('.dd-layer');
  }

  test('27 · a conversation survives a reload, crops and all', async ({ page }) => {
    await boot(page);
    await stubModel(page);
    await reboot(page);

    await dragOnPage(page, BOX_A);
    await page.locator('.dd-composer-input').fill('why does this hold?');
    await page.locator('.dd-send').click();
    await expect(page.locator('.dd-msg-assistant .dd-md')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200); // the save is debounced

    await reboot(page);

    await expect(page.locator('.dd-msg')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('.dd-msg-user .dd-msg-text')).toHaveText('why does this hold?');
    await expect(page.locator('.dd-msg-assistant .dd-md')).toContainText('Because');

    // The crop must come back as a data: URL. An object URL from the previous
    // page is dead after a reload, and would render as a broken image.
    const crop = page.locator('.dd-msg-context .dd-crop');
    await expect(crop).toBeVisible();
    const info = await crop.evaluate((i: HTMLImageElement) => ({
      scheme: i.src.split(':')[0],
      painted: i.complete && i.naturalWidth > 0,
    }));
    expect(info.scheme, 'restored crops are self-contained').toBe('data');
    expect(info.painted, 'the restored crop actually has pixels').toBe(true);
  });

  test('28 · a saved chat is listed on the landing page and reopens', async ({ page }) => {
    await boot(page);
    await stubModel(page);
    await reboot(page);

    await dragOnPage(page, BOX_A);
    await page.locator('.dd-composer-input').fill('explain the prefactor');
    await page.locator('.dd-send').click();
    await expect(page.locator('.dd-msg-assistant .dd-md')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);

    // the wordmark unloads the thread but must NOT delete it
    await page.locator('.dd-home').click();
    await expect(page.locator('.dd-landing')).toBeVisible({ timeout: 90_000 });

    const entry = page.locator('.dd-recent-item').first();
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dd-recent-preview').first()).toHaveText('explain the prefactor');

    await entry.click();
    await page.waitForSelector('.dd-app', { timeout: 90_000 });
    await expect(page.locator('.dd-msg')).toHaveCount(2, { timeout: 30_000 });
  });
});
