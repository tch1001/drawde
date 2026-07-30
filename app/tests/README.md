# drawde viewer — Playwright regression suite

A standalone, reusable end-to-end harness for the EmbedPDF-based viewer in
`app/`. It owns its **own Chromium and its own vite dev server** — it is *not*
the Playwright MCP server, so it runs unattended and never fights a browser a
human session is driving.

---

## Running it

```bash
cd ~/drawde/app

npm i -D @playwright/test          # once
npx playwright install chromium    # once (may already be present)

npm run test:e2e                   # typecheck + full suite
npm run test:e2e:only              # skip the typecheck
npm run test:e2e:headed            # watch it happen
npx playwright test -c tests/playwright.config.mjs -g "12 ·"   # one test
npx playwright show-trace tests/.artifacts/<failed-test>/trace.zip
```

`npm run typecheck` on its own runs `tsc --noEmit` over `src/` **and** over
`tests/` (`tests/tsconfig.json`). `vite build` does **not** typecheck, so this
is the only thing that does — which is why `test:e2e` runs it first.

### The dev server

`tests/playwright.config.mjs` starts `vite` on **port 5181** (not the 5180 a
human session usually holds) and stops it when the run ends.
`reuseExistingServer: true`, so if you already have something on 5181 it is
reused instead — handy while iterating, but **stop stale 5181 servers before a
clean run**, otherwise you may be testing a server whose module graph predates
your edits. Override the port with `DRAWDE_TEST_PORT=5199 npm run test:e2e`.

### Output

Traces (`retain-on-failure`) and failure screenshots land in
`tests/.artifacts/` (gitignored).

---

## The one rule this suite exists to enforce

**Every gesture goes through Playwright's real input pipeline** —
`page.mouse.*`, `page.keyboard.*`, `locator.tap()` — which drive Chromium's
native input queue via CDP `Input.dispatch*Event`.

There is **no `page.evaluate()` that dispatches an event** anywhere in the spec;
`evaluate` is used only to *read* computed style and DOM state.

This is not stylistic. A shipped bug — the browser's native HTML5 image drag
firing `dragstart` on the page bitmap and **cancelling the pointer stream**,
which killed both box drawing and text selection — passed a synthetic-event
suite and failed on every real mouse. The fix lives in `App.tsx`
(`<PagePointerProvider onDragStart={e => e.preventDefault()}>`); tests 3–8 are
what keep it fixed. Synthetic `PointerEvent`s bypass pointer capture,
hit-testing, default-prevention *and* native drag, so they cannot see it.

---

## What each test covers

### `desktop · boot & modes`

| # | Test | Guards against |
|---|---|---|
| 1 | Boots: PDFium WASM engine loads, first page bitmap decodes, page count is live, **zero console errors** | blank viewer, WASM/asset regressions, React key/hook warnings |
| 2 | Region is the default tool; `R` / `T` activate region / text and the matching toolbar button gains `.on`; the buttons work too; **`H` on desktop does not strand you** | keybinding regressions, mode-change subscription breaking, the `stranded` fallback in `ModeController` |

> **Why `H` is asserted on mobile, not desktop.** The toolbar is now
> viewport-conditional: `showPan = isMobile`, `showText = !isMobile`. Pressing
> `H` on a desktop viewport activates `panMode` and a `stranded` effect
> immediately bounces you back to Region, because there is no Pan button to show
> `.on`. So test 2 asserts that contract on desktop, and **test 2b** (in the
> mobile describe) asserts the real `H` → pan → `.on` behaviour where the button
> exists. If Pan ever returns to the desktop toolbar, move 2b back into test 2.

### `desktop · region selection`

| # | Test | Guards against |
|---|---|---|
| 3 | A real mouse drag draws a `.dd-rect` **within 3px of the dragged coords** and produces a `.dd-card` whose `.dd-crop` image actually decodes | native-drag cancellation; the `PageLayout.scale` bug (missing scale → `NaN` positions → every rect piles up at 0,0); a broken `renderPageRect` crop path |
| 4 | Two plain drags leave exactly **1** region | `regionStore.replace` regressions |
| 5 | Plain drag then shift-drag leaves exactly **2** | shift sampling at `pointerdown` (keyup can beat pointerup) |
| 6 | Clicking a `.dd-rect-x` removes **that** rectangle and its card (survivor identified by geometry, not by index) | the ✕ starting a new drag; the wrong region being removed; `exclusive: true` on the box mode re-appearing and putting a z-index-10 div over the ✕ |

### `desktop · text selection & mixing`

| # | Test | Guards against |
|---|---|---|
| 7 | A real drag across a line of text produces a `.dd-kind-text` card with non-empty text | the text-selection → `Region` bridge; `getSelectedText().wait()` being mistakenly `await`ed |
| 8 | A box region + a shift-held text selection coexist (one `.dd-kind-box`, one `.dd-kind-text`) | text selection silently *replacing* instead of adding |
| 9 | `Escape` clears every selection | `regionStore.clear()` wiring |

### `desktop · selection lock`

| # | Test | Guards against |
|---|---|---|
| 10 | Holding Shift adds `via-shift` to `.dd-lock` and releasing removes it; clicking toggles `.on`; **locked → two plain (no-shift) drags leave 2 regions**; unlocking restores replace | the touch-only additive path, which has no keyboard equivalent to fall back on |

### `desktop · zoom, paging & search`

| # | Test | Guards against |
|---|---|---|
| 11 | `+` / `−` change the `.dd-zoom` percentage **and the reader stays on page 10** | the real bug: passing `{x, y}` where the zoom plugin wants `{vx, vy}` → `undefined` → `NaN` in the scroll-preservation math → viewer snaps back to page 1 |
| 12 | Four rapid `PageDown` presses advance **exactly four** pages (then two `PageUp` go back two) | the real bug: reading the *current* page during a scroll animation, so fast repeats get swallowed and you move one page. `KeyboardNav` keeps its own target counter for this |
| 13 | Typing a page number + Enter jumps there, and the viewport really scrolled | `.dd-pageinput` commit path |
| 14 | `Ctrl+F` opens the bar, focuses the input, and a term that exists yields `n / m` with `m > 0`; `Escape` closes it | search plugin wiring, `searchAllPages` Task handling |

### `mobile · responsive layout` (Pixel 5 descriptor, 390x844, touch)

Uses `test.use({ ...devices['Pixel 5'] })`, so these run with `hasTouch`,
`isMobile`, a phone UA and dpr 3 — and interact via `locator.tap()`, i.e. real
touch events, not clicks.

| # | Test | Guards against |
|---|---|---|
| 2b | `H` activates pan and the Pan button gains `.on`; the Text button is absent; `T` does not strand a phone user | the touch toolbar's tool set and the `stranded` fallback |
| 15 | `.dd-logo` and `.dd-lbl` are `display: none` | the media query / `is-mobile` class breaking |
| 16 | The hamburger opens the sidebar as an **overlay**: `position: absolute` **and** `.dd-viewer` keeps the full width; a `.dd-scrim` appears | the drawer squeezing the PDF into a sliver on a phone |
| 17 | The chat button opens the context panel **and closes the sidebar** (and vice-versa) — mutually exclusive | two overlays stacking on a 390px screen |
| 18 | Tapping the scrim dismisses the open overlay | a modal you cannot get out of |
| 19 | `.dd-splitter` is not displayed (closed *and* open) | drag-to-resize handles on a touch device |
| 20 | The `.dd-meta` zoom/page pill is `position: fixed` | the pill scrolling away with the toolbar |

---

## Known-flaky / fragile notes

**Read this before "fixing" a red test.**

1. **Text-drag coordinates must land on glyphs.**
   `TEXT_A` / `TEXT_B` in the spec point at lines 2 and 3 of `sample.pdf`'s
   abstract. EmbedPDF's selection plugin only *starts* a text selection when
   `pointerdown` hits a glyph run; starting in whitespace or the margin falls
   through to its marquee handler and silently selects nothing — you get an
   empty card, not an error. **If you swap `sample.pdf`, these constants must be
   re-picked.** Take a screenshot of page 1 clipped to `.dd-layer` and read the
   coordinates off it; the page is 612x792pt rendered 1:1 at 100%, so screen
   offsets from the layer's top-left *are* PDF points.

2. **Test 8 · text-selection Shift race — FIXED, and the test now guards it.**
   `TextSelectionBridge` used to read `selectionMode.isAdditive` inside the
   **async** `getSelectedText().wait()` callback, so a user who released Shift
   as they released the mouse had their *additive* text selection silently
   *replace* the context. `App.tsx` now latches the flag synchronously in
   `onEndSelection` — matching what `BoxSelectLayer` already did at
   `pointerdown` (`additiveRef.current`).

   Test 8 therefore releases Shift **at mouseup with no grace period**, and was
   verified against a negative control: reverting the latch makes it fail,
   restoring the latch makes it pass. Do not reintroduce a `holdShiftMs` here —
   the strictness is the point, or the regression comes back unnoticed.

3. **`.dd-rect` counts *all* regions, not just box regions.**
   `BoxSelectLayer` draws a rectangle for every `Region` on the page, text ones
   included. `rects()` is therefore a region count. Assert on
   `.dd-card .dd-kind-box` / `.dd-kind-text` when you care about the kind.

4. **The in-flight preview shares the `.dd-rect` class.**
   Always use `.dd-rect:not(.dd-rect-preview)` — the `rects()` helper does.

5. **Crops are async and expensive.** `CROP_SCALE = 4`, so the crop is rendered
   at 4x through PDFium. Test 3 allows 30 s and polls `naturalWidth`. On a busy
   machine this is the most likely test to time out; it is slow, not flaky.

6. **The mobile context panel is full-width, so its scrim is untappable.**
   Since the "full-screen context panel" change, `.dd-panel` covers 100% of the
   width on a phone, so the scrim behind it has no exposed area. Test 18 is
   therefore written against the **sidebar** overlay (a `min(86vw, 340px)`
   drawer) and taps `x = width - 15`, not the element's centre —
   `locator.tap()` targets the centre by default and would hit the drawer.
   If the panel ever becomes a partial drawer too, extend test 18 to cover it.

7. **First run is slow.** The vite dev server compiles the EmbedPDF plugin graph
   on the first request and PDFium's WASM has to download and instantiate. The
   `boot()` helper allows 90 s for this. Per-test timeout is 120 s.

8. **Serial by design.** `workers: 1`, `fullyParallel: false`. Each test gets a
   fresh page (and therefore a fresh module-level `regionStore`), but running
   several PDFium instances in parallel is slow and memory-hungry with no
   isolation benefit.

9. **Console-error assertion (test 1) filters vite/React-DevTools noise** via
   `CONSOLE_NOISE`. Add to that list only for genuinely-benign dev-server
   chatter; do not use it to silence a real error.

10. **`devices['Pixel 5']` is spread WITHOUT `defaultBrowserType`.**
    Playwright rejects `test.use({ defaultBrowserType })` inside a describe
    ("forces a new worker"). The spec destructures it away into `PIXEL_5`; the
    config already pins chromium. Don't put the raw descriptor back.

11. **The tools in the toolbar are viewport-conditional.** `showPan = isMobile`,
    `showText = !isMobile`. Locators address buttons by their `title`
    (`.dd-mode[title^="Select a region"]`, …) rather than by index — the index
    has already shifted twice (once when Pan was added, once when it became
    mobile-only). Keep it that way.

### Negative control

The assertions were validated by running four deliberately-wrong mirrors of
tests 3, 4, 12 and 14 (rect pinned at the page origin, 2 plain drags expected to
leave 2 regions, 4 `PageDown` expected to reach page 6, a nonsense search term
expected to match). All four failed, so these tests genuinely bite rather than
passing vacuously. Worth repeating if you refactor the helpers.

---

## Files

| Path | What |
|---|---|
| `tests/viewer.spec.ts` | the suite (5 desktop describes + 1 mobile describe) |
| `tests/playwright.config.mjs` | Chromium, 1400x900, own vite on 5181, traces on failure |
| `tests/tsconfig.json` | so `npm run typecheck` covers the spec too |
| `tests/.artifacts/` | traces + failure screenshots (gitignored) |
