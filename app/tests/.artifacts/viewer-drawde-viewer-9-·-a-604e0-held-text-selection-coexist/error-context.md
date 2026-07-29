# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: viewer.spec.ts >> drawde viewer >> 9 · a box region and a shift-held text selection coexist
- Location: tests/viewer.spec.ts:255:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.dd-card .dd-kind-text')
Expected: 1
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for locator('.dd-card .dd-kind-text')
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
      - generic [ref=e17]: p. 1 / 22
  - main [ref=e18]:
    - complementary [ref=e19]:
      - generic [ref=e20]:
        - button "Chapters" [disabled] [ref=e21]
        - button "Pages" [ref=e22] [cursor=pointer]
      - generic [ref=e24]:
        - button "page 1 1" [ref=e25] [cursor=pointer]:
          - img "page 1" [ref=e27]
          - generic [ref=e28]: "1"
        - button "page 2 2" [ref=e29] [cursor=pointer]:
          - img "page 2" [ref=e31]
          - generic [ref=e32]: "2"
        - button "page 3 3" [ref=e33] [cursor=pointer]:
          - img "page 3" [ref=e35]
          - generic [ref=e36]: "3"
        - button "page 4 4" [ref=e37] [cursor=pointer]:
          - img "page 4" [ref=e39]
          - generic [ref=e40]: "4"
        - button "page 5 5" [ref=e41] [cursor=pointer]:
          - img "page 5" [ref=e43]
          - generic [ref=e44]: "5"
        - button "page 6 6" [ref=e45] [cursor=pointer]:
          - img "page 6" [ref=e47]
          - generic [ref=e48]: "6"
        - button "page 7 7" [ref=e49] [cursor=pointer]:
          - img "page 7" [ref=e51]
          - generic [ref=e52]: "7"
        - button "page 8 8" [ref=e53] [cursor=pointer]:
          - img "page 8" [ref=e55]
          - generic [ref=e56]: "8"
        - button "page 9 9" [ref=e57] [cursor=pointer]:
          - img "page 9" [ref=e59]
          - generic [ref=e60]: "9"
        - button "page 10 10" [ref=e61] [cursor=pointer]:
          - img "page 10" [ref=e63]
          - generic [ref=e64]: "10"
        - button "page 11 11" [ref=e65] [cursor=pointer]:
          - img "page 11" [ref=e67]
          - generic [ref=e68]: "11"
        - button "page 12 12" [ref=e69] [cursor=pointer]:
          - img "page 12" [ref=e71]
          - generic [ref=e72]: "12"
        - button "page 13 13" [ref=e73] [cursor=pointer]:
          - img "page 13" [ref=e75]
          - generic [ref=e76]: "13"
        - button "page 14 14" [ref=e77] [cursor=pointer]:
          - img "page 14" [ref=e79]
          - generic [ref=e80]: "14"
        - button "page 15 15" [ref=e81] [cursor=pointer]:
          - img "page 15" [ref=e83]
          - generic [ref=e84]: "15"
        - button "page 16 16" [ref=e85] [cursor=pointer]:
          - img "page 16" [ref=e87]
          - generic [ref=e88]: "16"
        - button "page 17 17" [ref=e89] [cursor=pointer]:
          - img "page 17" [ref=e91]
          - generic [ref=e92]: "17"
        - button "page 18 18" [ref=e93] [cursor=pointer]:
          - img "page 18" [ref=e95]
          - generic [ref=e96]: "18"
        - button "page 19 19" [ref=e97] [cursor=pointer]:
          - img "page 19" [ref=e99]
          - generic [ref=e100]: "19"
        - button "page 20 20" [ref=e101] [cursor=pointer]:
          - img "page 20" [ref=e103]
          - generic [ref=e104]: "20"
        - button "page 21 21" [ref=e105] [cursor=pointer]:
          - img "page 21" [ref=e107]
          - generic [ref=e108]: "21"
        - button "page 22 22" [ref=e109] [cursor=pointer]:
          - img "page 22" [ref=e111]
          - generic [ref=e112]: "22"
    - generic [ref=e120]:
      - generic:
        - generic:
          - generic: "1"
          - button "×" [ref=e122] [cursor=pointer]
    - complementary [ref=e145]:
      - generic [ref=e146]:
        - heading "Context" [level=2] [ref=e147]
        - generic [ref=e148]: "1"
        - button "clear all" [ref=e149] [cursor=pointer]
      - generic [ref=e151]:
        - generic [ref=e152]:
          - generic [ref=e153]: ▭ region
          - generic [ref=e154]: "#1 · p.1"
          - button "×" [ref=e155] [cursor=pointer]
        - img "selection 1" [ref=e156]
        - generic [ref=e157]: 300×60 pt·→ OCR / LLM (phase 3)
      - button "Ask drawde about 1 item" [disabled] [ref=e159]
```

# Test source

```ts
  166 |     await boot(page);
  167 |     await setMode(page, 'r');
  168 | 
  169 |     const box = await pageBox(page);
  170 |     const from = abs(box, BOX_A[0]);
  171 |     const to = abs(box, BOX_A[1]);
  172 |     await realDrag(page, from, to);
  173 | 
  174 |     await expect(rects(page)).toHaveCount(1);
  175 | 
  176 |     // geometry: the persistent rect must land where the mouse actually went.
  177 |     const drawn = await rects(page).first().boundingBox();
  178 |     expect(drawn, 'rect has no layout box').not.toBeNull();
  179 |     const TOL = 6; // 1.5px border on each side + rounding
  180 |     expect(Math.abs(drawn!.x - Math.min(from.x, to.x))).toBeLessThanOrEqual(TOL);
  181 |     expect(Math.abs(drawn!.y - Math.min(from.y, to.y))).toBeLessThanOrEqual(TOL);
  182 |     expect(Math.abs(drawn!.width - Math.abs(to.x - from.x))).toBeLessThanOrEqual(TOL);
  183 |     expect(Math.abs(drawn!.height - Math.abs(to.y - from.y))).toBeLessThanOrEqual(TOL);
  184 | 
  185 |     // the panel card, and its async high-DPI crop
  186 |     await expect(cards(page)).toHaveCount(1);
  187 |     await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
  188 |     const crop = page.locator('.dd-card .dd-crop');
  189 |     await expect(crop).toBeVisible({ timeout: 30_000 });
  190 |     const cropW = await crop.evaluate((el: HTMLImageElement) => el.naturalWidth);
  191 |     expect(cropW, 'crop image did not decode').toBeGreaterThan(0);
  192 |   });
  193 | 
  194 |   test('5 · plain drag REPLACES the selection (2 drags → 1 region)', async ({ page }) => {
  195 |     await boot(page);
  196 |     await setMode(page, 'r');
  197 | 
  198 |     await dragOnPage(page, BOX_A);
  199 |     await expect(rects(page)).toHaveCount(1);
  200 | 
  201 |     await dragOnPage(page, BOX_B);
  202 |     await expect(rects(page)).toHaveCount(1);
  203 |     await expect(cards(page)).toHaveCount(1);
  204 |     await expect(page.locator('.dd-count')).toHaveText('1');
  205 |   });
  206 | 
  207 |   test('6 · shift-drag ADDS to the selection (plain + shift → 2 regions)', async ({ page }) => {
  208 |     await boot(page);
  209 |     await setMode(page, 'r');
  210 | 
  211 |     await dragOnPage(page, BOX_A);
  212 |     await expect(rects(page)).toHaveCount(1);
  213 | 
  214 |     await dragOnPage(page, BOX_B, { shift: true });
  215 |     await expect(rects(page)).toHaveCount(2);
  216 |     await expect(cards(page)).toHaveCount(2);
  217 |     await expect(page.locator('.dd-count')).toHaveText('2');
  218 |   });
  219 | 
  220 |   test('7 · clicking the ✕ on a rect removes it and its panel card', async ({ page }) => {
  221 |     await boot(page);
  222 |     await setMode(page, 'r');
  223 | 
  224 |     await dragOnPage(page, BOX_A);
  225 |     await dragOnPage(page, BOX_B, { shift: true });
  226 |     await expect(rects(page)).toHaveCount(2);
  227 |     await expect(cards(page)).toHaveCount(2);
  228 | 
  229 |     // remember which one we are killing
  230 |     const doomed = await page
  231 |       .locator('.dd-card .dd-card-meta')
  232 |       .first()
  233 |       .textContent();
  234 | 
  235 |     await page.locator('.dd-rect-x').first().click();
  236 | 
  237 |     await expect(rects(page)).toHaveCount(1);
  238 |     await expect(cards(page)).toHaveCount(1);
  239 |     const left = await page.locator('.dd-card .dd-card-meta').first().textContent();
  240 |     expect(left).not.toBe(doomed);
  241 |   });
  242 | 
  243 |   test('8 · text drag produces a text card with non-empty text', async ({ page }) => {
  244 |     await boot(page);
  245 |     await setMode(page, 't');
  246 | 
  247 |     await dragOnPage(page, TEXT_A);
  248 | 
  249 |     await expect(cards(page)).toHaveCount(1);
  250 |     await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
  251 |     const text = (await page.locator('.dd-card .dd-text').first().textContent()) ?? '';
  252 |     expect(text.trim().length, `text card was empty: ${JSON.stringify(text)}`).toBeGreaterThan(3);
  253 |   });
  254 | 
  255 |   test('9 · a box region and a shift-held text selection coexist', async ({ page }) => {
  256 |     await boot(page);
  257 | 
  258 |     await setMode(page, 'r');
  259 |     await dragOnPage(page, BOX_A);
  260 |     await expect(page.locator('.dd-kind-box')).toHaveCount(1);
  261 | 
  262 |     await setMode(page, 't');
  263 |     await dragOnPage(page, TEXT_A, { shift: true });
  264 | 
  265 |     await expect(page.locator('.dd-card .dd-kind-box')).toHaveCount(1);
> 266 |     await expect(page.locator('.dd-card .dd-kind-text')).toHaveCount(1);
      |                                                          ^ Error: expect(locator).toHaveCount(expected) failed
  267 |     await expect(cards(page)).toHaveCount(2);
  268 |   });
  269 | 
  270 |   test('10 · Escape clears all selections', async ({ page }) => {
  271 |     await boot(page);
  272 | 
  273 |     await setMode(page, 'r');
  274 |     await dragOnPage(page, BOX_A);
  275 |     await dragOnPage(page, BOX_B, { shift: true });
  276 |     await expect(cards(page)).toHaveCount(2);
  277 | 
  278 |     await page.keyboard.press('Escape');
  279 | 
  280 |     await expect(cards(page)).toHaveCount(0);
  281 |     await expect(rects(page)).toHaveCount(0);
  282 |     await expect(page.locator('.dd-empty')).toBeVisible();
  283 |   });
  284 | });
  285 | 
```