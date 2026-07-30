# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: viewer.spec.ts >> drawde viewer >> 9 · a box region and a shift-held text selection coexist
- Location: tests/viewer.spec.ts:265:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.dd-card .dd-kind-box')
Expected: 1
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for locator('.dd-card .dd-kind-box')
    44 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - heading "drawde viewer" [level=1] [ref=e5]
    - generic [ref=e6]:
      - button "Toggle sidebar" [ref=e7] [cursor=pointer]: ☰
      - button "▭ Region R" [ref=e8] [cursor=pointer]:
        - text: ▭ Region
        - generic [ref=e9]: R
      - button "T Text T" [ref=e10] [cursor=pointer]:
        - text: T Text
        - generic [ref=e11]: T
      - generic [ref=e12]: drag to select text · Shift add · Ctrl+scroll zoom · PgUp/PgDn page
      - generic [ref=e13]:
        - button "−" [ref=e14] [cursor=pointer]
        - generic [ref=e15]: 100%
        - button "+" [ref=e16] [cursor=pointer]
      - generic [ref=e17]:
        - text: p.
        - textbox "Type a page number and press Enter" [ref=e18]: "1"
        - text: / 22
  - main [ref=e19]:
    - complementary [ref=e20]:
      - generic [ref=e21]:
        - button "Chapters" [disabled] [ref=e22]
        - button "Pages" [ref=e23] [cursor=pointer]
      - generic [ref=e25]:
        - button "page 1 1" [ref=e26] [cursor=pointer]:
          - img "page 1" [ref=e28]
          - generic [ref=e29]: "1"
        - button "page 2 2" [ref=e30] [cursor=pointer]:
          - img "page 2" [ref=e32]
          - generic [ref=e33]: "2"
        - button "page 3 3" [ref=e34] [cursor=pointer]:
          - img "page 3" [ref=e36]
          - generic [ref=e37]: "3"
        - button "page 4 4" [ref=e38] [cursor=pointer]:
          - img "page 4" [ref=e40]
          - generic [ref=e41]: "4"
        - button "page 5 5" [ref=e42] [cursor=pointer]:
          - img "page 5" [ref=e44]
          - generic [ref=e45]: "5"
        - button "page 6 6" [ref=e46] [cursor=pointer]:
          - img "page 6" [ref=e48]
          - generic [ref=e49]: "6"
        - button "page 7 7" [ref=e50] [cursor=pointer]:
          - img "page 7" [ref=e52]
          - generic [ref=e53]: "7"
        - button "page 8 8" [ref=e54] [cursor=pointer]:
          - img "page 8" [ref=e56]
          - generic [ref=e57]: "8"
        - button "page 9 9" [ref=e58] [cursor=pointer]:
          - img "page 9" [ref=e60]
          - generic [ref=e61]: "9"
        - button "page 10 10" [ref=e62] [cursor=pointer]:
          - img "page 10" [ref=e64]
          - generic [ref=e65]: "10"
        - button "page 11 11" [ref=e66] [cursor=pointer]:
          - img "page 11" [ref=e68]
          - generic [ref=e69]: "11"
        - button "page 12 12" [ref=e70] [cursor=pointer]:
          - img "page 12" [ref=e72]
          - generic [ref=e73]: "12"
        - button "page 13 13" [ref=e74] [cursor=pointer]:
          - img "page 13" [ref=e76]
          - generic [ref=e77]: "13"
        - button "page 14 14" [ref=e78] [cursor=pointer]:
          - img "page 14" [ref=e80]
          - generic [ref=e81]: "14"
        - button "page 15 15" [ref=e82] [cursor=pointer]:
          - img "page 15" [ref=e84]
          - generic [ref=e85]: "15"
        - button "page 16 16" [ref=e86] [cursor=pointer]:
          - img "page 16" [ref=e88]
          - generic [ref=e89]: "16"
        - button "page 17 17" [ref=e90] [cursor=pointer]:
          - img "page 17" [ref=e92]
          - generic [ref=e93]: "17"
        - button "page 18 18" [ref=e94] [cursor=pointer]:
          - img "page 18" [ref=e96]
          - generic [ref=e97]: "18"
        - button "page 19 19" [ref=e98] [cursor=pointer]:
          - img "page 19" [ref=e100]
          - generic [ref=e101]: "19"
        - button "page 20 20" [ref=e102] [cursor=pointer]:
          - img "page 20" [ref=e104]
          - generic [ref=e105]: "20"
        - button "page 21 21" [ref=e106] [cursor=pointer]:
          - img "page 21" [ref=e108]
          - generic [ref=e109]: "21"
        - button "page 22 22" [ref=e110] [cursor=pointer]:
          - img "page 22" [ref=e112]
          - generic [ref=e113]: "22"
    - generic [ref=e121]:
      - generic:
        - generic:
          - generic: "1"
          - button "×" [ref=e125] [cursor=pointer]
    - complementary [ref=e150]:
      - generic [ref=e151]:
        - heading "Context" [level=2] [ref=e152]
        - generic [ref=e153]: "1"
        - button "clear all" [ref=e154] [cursor=pointer]
      - generic [ref=e156]:
        - generic [ref=e157]:
          - generic [ref=e158]: T text
          - generic [ref=e159]: "#1 · p.1"
          - button "×" [ref=e160] [cursor=pointer]
        - generic [ref=e161]: n their Hilbert space a sector describing supergravit
        - generic [ref=e162]: 53 chars·→ OCR / LLM (phase 3)
      - button "Ask drawde about 1 item" [disabled] [ref=e164]
```

# Test source

```ts
  175 |     const from = abs(box, BOX_A[0]);
  176 |     const to = abs(box, BOX_A[1]);
  177 |     await realDrag(page, from, to);
  178 | 
  179 |     await expect(rects(page)).toHaveCount(1);
  180 | 
  181 |     // geometry: the persistent rect must land where the mouse actually went.
  182 |     const drawn = await rects(page).first().boundingBox();
  183 |     expect(drawn, 'rect has no layout box').not.toBeNull();
  184 |     const TOL = 6; // 1.5px border on each side + rounding
  185 |     expect(Math.abs(drawn!.x - Math.min(from.x, to.x))).toBeLessThanOrEqual(TOL);
  186 |     expect(Math.abs(drawn!.y - Math.min(from.y, to.y))).toBeLessThanOrEqual(TOL);
  187 |     expect(Math.abs(drawn!.width - Math.abs(to.x - from.x))).toBeLessThanOrEqual(TOL);
  188 |     expect(Math.abs(drawn!.height - Math.abs(to.y - from.y))).toBeLessThanOrEqual(TOL);
  189 | 
  190 |     // the panel card, and its async high-DPI crop
  191 |     await expect(cards(page)).toHaveCount(1);
  192 |     await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
  193 |     const crop = page.locator('.dd-card .dd-crop');
  194 |     await expect(crop).toBeVisible({ timeout: 30_000 });
  195 |     const cropW = await crop.evaluate((el: HTMLImageElement) => el.naturalWidth);
  196 |     expect(cropW, 'crop image did not decode').toBeGreaterThan(0);
  197 |   });
  198 | 
  199 |   test('5 · plain drag REPLACES the selection (2 drags → 1 region)', async ({ page }) => {
  200 |     await boot(page);
  201 |     await setMode(page, 'r');
  202 | 
  203 |     await dragOnPage(page, BOX_A);
  204 |     await expect(rects(page)).toHaveCount(1);
  205 | 
  206 |     await dragOnPage(page, BOX_B);
  207 |     await expect(rects(page)).toHaveCount(1);
  208 |     await expect(cards(page)).toHaveCount(1);
  209 |     await expect(page.locator('.dd-count')).toHaveText('1');
  210 |   });
  211 | 
  212 |   test('6 · shift-drag ADDS to the selection (plain + shift → 2 regions)', async ({ page }) => {
  213 |     await boot(page);
  214 |     await setMode(page, 'r');
  215 | 
  216 |     await dragOnPage(page, BOX_A);
  217 |     await expect(rects(page)).toHaveCount(1);
  218 | 
  219 |     await dragOnPage(page, BOX_B, { shift: true });
  220 |     await expect(rects(page)).toHaveCount(2);
  221 |     await expect(cards(page)).toHaveCount(2);
  222 |     await expect(page.locator('.dd-count')).toHaveText('2');
  223 |   });
  224 | 
  225 |   test('7 · clicking the ✕ on a rect removes it and its panel card', async ({ page }) => {
  226 |     await boot(page);
  227 |     await setMode(page, 'r');
  228 | 
  229 |     await dragOnPage(page, BOX_A);
  230 |     await dragOnPage(page, BOX_B, { shift: true });
  231 |     await expect(rects(page)).toHaveCount(2);
  232 |     await expect(cards(page)).toHaveCount(2);
  233 | 
  234 |     // panel meta is positional ("#1 · p.1"), so identify survivors by geometry
  235 |     const before = await rects(page).evaluateAll((els) =>
  236 |       els.map((el) => (el as HTMLElement).style.cssText),
  237 |     );
  238 |     expect(before).toHaveLength(2);
  239 | 
  240 |     // real click on the ✕ of the FIRST rect
  241 |     await page.locator('.dd-rect-x').first().click();
  242 | 
  243 |     await expect(rects(page)).toHaveCount(1);
  244 |     await expect(cards(page)).toHaveCount(1);
  245 |     await expect(page.locator('.dd-count')).toHaveText('1');
  246 | 
  247 |     const after = await rects(page).evaluateAll((els) =>
  248 |       els.map((el) => (el as HTMLElement).style.cssText),
  249 |     );
  250 |     expect(after, 'the wrong rectangle was removed').toEqual([before[1]]);
  251 |   });
  252 | 
  253 |   test('8 · text drag produces a text card with non-empty text', async ({ page }) => {
  254 |     await boot(page);
  255 |     await setMode(page, 't');
  256 | 
  257 |     await dragOnPage(page, TEXT_A);
  258 | 
  259 |     await expect(cards(page)).toHaveCount(1);
  260 |     await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
  261 |     const text = (await page.locator('.dd-card .dd-text').first().textContent()) ?? '';
  262 |     expect(text.trim().length, `text card was empty: ${JSON.stringify(text)}`).toBeGreaterThan(3);
  263 |   });
  264 | 
  265 |   test('9 · a box region and a shift-held text selection coexist', async ({ page }) => {
  266 |     await boot(page);
  267 | 
  268 |     await setMode(page, 'r');
  269 |     await dragOnPage(page, BOX_A);
  270 |     await expect(page.locator('.dd-kind-box')).toHaveCount(1);
  271 | 
  272 |     await setMode(page, 't');
  273 |     await dragOnPage(page, TEXT_A, { shift: true });
  274 | 
> 275 |     await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
      |                                                         ^ Error: expect(locator).toHaveCount(expected) failed
  276 |     await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
  277 |     await expect(cards(page)).toHaveCount(2);
  278 |   });
  279 | 
  280 |   test('10 · Escape clears all selections', async ({ page }) => {
  281 |     await boot(page);
  282 | 
  283 |     await setMode(page, 'r');
  284 |     await dragOnPage(page, BOX_A);
  285 |     await dragOnPage(page, BOX_B, { shift: true });
  286 |     await expect(cards(page)).toHaveCount(2);
  287 | 
  288 |     await page.keyboard.press('Escape');
  289 | 
  290 |     await expect(cards(page)).toHaveCount(0);
  291 |     await expect(rects(page)).toHaveCount(0);
  292 |     await expect(page.locator('.dd-empty')).toBeVisible();
  293 |   });
  294 | });
  295 | 
```