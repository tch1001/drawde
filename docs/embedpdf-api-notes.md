# EmbedPDF API notes — probed live 2026-07-29

**Decision: EmbedPDF is the base library for drawde's viewer** (user's call, 2026-07-29).

Why: MIT licensed, PDFium-WASM engine (Chrome-grade fidelity), genuinely active (~4.3k★, pushed daily), plugin architecture, and it ships a **capture plugin** that does marquee area-capture → `Blob` out of the box. Everything else free-with-a-UI is pdf.js underneath.

- Repo: https://github.com/embedpdf/embed-pdf-viewer (MIT)
- Docs: https://www.embedpdf.com/docs — **note: many doc URLs 404**. The repo is the real reference.
- Local shallow clone was at `/tmp/claude-1000/.../scratchpad/embedpdf-src` (scratchpad — may be gone; re-clone with `git clone --depth 1`).

## ⚠️ The critical finding: snippet vs. headless

There are two ways to consume EmbedPDF, and **the choice matters enormously for drawde**:

### `@embedpdf/snippet` (CDN, no build step)
```html
<script type="module">
  import EmbedPDF from 'https://cdn.jsdelivr.net/npm/@embedpdf/snippet@2/dist/embedpdf.js';
  const viewer = EmbedPDF.init({
    type: 'container',
    target: document.getElementById('pdf-viewer'),
    theme: { preference: 'dark' },
    documentManager: { initialDocuments: [{ url: './sample.pdf', documentId: 'doc' }] },
  });
  const registry = await viewer.registry;
  const capture = registry.getPlugin('capture')?.provides()?.forDocument('doc');
</script>
```

**Verified working** (renders, full plugin registry reachable). BUT — probed DOM structure:

- Everything renders inside a **shadow DOM** under `<embedpdf-container>`.
- Pages are `<img>` elements with **blob: URLs** (not canvas).
- **No `data-page-index` / `data-page` attributes** on page wrappers — pages are only identifiable by geometry.
- Page wrapper is a `div` with inline `style="position: relative; width: 327.42px; height: 423.72px; touch-..."`.

**Consequence: persistent custom overlay rectangles are painful on the snippet build.** You'd have to pierce shadow DOM and infer page elements by geometry. Fragile.

### Headless plugin packages (npm + bundler) ← **RECOMMENDED for phase 2**

The example at `website/src/content/docs/react/code-examples/headless/capture-example.tsx` in the repo shows the real pattern:

```tsx
import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { Scroller, ScrollPluginPackage } from '@embedpdf/plugin-scroll/react'
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { InteractionManagerPluginPackage, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react'
import { CapturePluginPackage, MarqueeCapture, CaptureAreaEvent, useCapture } from '@embedpdf/plugin-capture/react'

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [{ url: '...' }],
  }),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(CapturePluginPackage, { scale: 2.0, imageType: 'image/png' }),
]
```

With headless we compose `<Viewport>/<Scroller>/<PagePointerProvider>/<RenderLayer>` ourselves → **we own the page DOM** → our own overlay layers are trivial. This is the layer stack from `architecture-notes.md`.

**Recommendation: build phase 2 with headless packages + Vite.** Framework choice open; React has the most complete EmbedPDF support and the capture example is React.

## Available plugins (verified present in snippet build at runtime)

`capture`, `selection`, `interaction-manager`, `render`, `scroll`, `viewport`, `zoom`, `document-manager`, `tiling`, `annotation`, `search`. (`layout-analysis` present in repo but `provides()` returned null in the snippet build.)

Full package list in repo `packages/`: ai, plugin-ai-manager, plugin-annotation, plugin-attachment, plugin-bookmark, plugin-capture, plugin-commands, plugin-document-manager, plugin-export, plugin-form, plugin-fullscreen, plugin-history, plugin-i18n, plugin-interaction-manager, plugin-layout-analysis, plugin-pan, plugin-print, plugin-redaction, plugin-render, plugin-rotate, plugin-scroll, plugin-search, plugin-selection, plugin-signature, plugin-spread, plugin-stamp, plugin-thumbnail, plugin-tiling, plugin-ui, plugin-view-manager, plugin-viewport, plugin-zoom.

> Note `packages/ai` and `packages/plugin-ai-manager` exist — worth reading before building our own AI command bus.

## Key APIs for drawde

### capture (rectangle → image blob) — the core of phase 2
```ts
interface CaptureCapability {
  captureArea(pageIndex: number, rect: Rect): void   // programmatic → fires onCaptureArea
  enableMarqueeCapture(): void
  disableMarqueeCapture(): void
  toggleMarqueeCapture(): void
  isMarqueeCaptureActive(): boolean
  forDocument(documentId): CaptureScope
  registerMarqueeOnPage(opts: { documentId, pageIndex, scale, callback: { onPreview?, onCommit? } }): () => void
  onCaptureArea: EventHook<CaptureAreaEvent>
  onStateChange: EventHook<CaptureDocumentState>
}

interface CaptureAreaEvent {
  documentId: string; pageIndex: number; rect: Rect
  blob: Blob            // ← the crop image
  imageType: ImageConversionTypes; scale: number; withAnnotations: boolean
}

// config
createPluginRegistration(CapturePluginPackage, { scale: 2.0, imageType: 'image/png', withAnnotations: false })
```

**Important:** the built-in marquee is *transient* — one rect at a time, cleared after commit. For drawde's **persistent, multi-rect, shift-click-to-add** behaviour, keep our own `Region[]` store and call `captureArea(pageIndex, rect)` programmatically for each. Use `registerMarqueeOnPage`'s `onPreview`/`onCommit` for the drag UX, and render persistent rects in our own layer.

Capture registers an interaction mode `{ id: 'marqueeCapture', scope: 'page', exclusive: true, cursor: 'crosshair' }`.

### selection (text)
```ts
onSelectionChange(cb)   onEndSelection(cb)   onMarqueeEnd(cb)   onEmptySpaceClick(cb)
getSelectedText()       // → .wait(lines => ...)   NOTE: returns a Task, not a Promise
getHighlightRectsForPage(...)  getBoundingRectForPage(...)  getFormattedSelection()
clear()  copyToClipboard()  setMarqueeEnabled(b)  enableForMode(mode)
```

Vanilla usage pattern (from repo `examples/vanilla-tailwind/src/examples/selection-text.html`):
```js
const selection = registry.getPlugin('selection')?.provides()?.forDocument('doc');
selection.onSelectionChange(cur => {
  if (!cur) return;
  selection.getSelectedText().wait(lines => { /* lines: string[] */ });
});
```

### interaction-manager (R/T mode switching)
```ts
registerMode({ id, scope: 'page'|'document', exclusive: boolean, cursor: string })
activate(modeId)   activateDefaultMode()   getActiveMode()   setDefaultMode(id)
onModeChange(cb)   pause() / resume()      setCursor() / removeCursor()
claimPageActivity() / releasePageActivity()
addExclusionClass() / addExclusionAttribute()   // keep our UI chrome from eating page events
```
This is how **R = rectangle mode / T = text mode** should be implemented — register modes, bind keys to `activate()`.

### scroll — coordinate conversion
```ts
getRectPositionForPage(...)   // ← page rect → viewport position. Key for overlay positioning.
getMetrics()  getLayout()  scrollToPage()  onLayoutChange(cb)  onScroll(cb)
```

### render / tiling
```ts
renderPage()  renderPageRect()  renderPageRaw()  renderPageRectRaw()   // renderPageRect = arbitrary crop at any scale
```
`renderPageRect` is the **high-DPI crop source** for the OCR pipeline — independent of what capture's marquee gives us.

### annotation — for phase 6 (export)
Very complete: `createAnnotation`, `importAnnotations`, `exportAnnotations`, `commit`, `getPageAppearances`, grouping, locking, tools. Investigate whether it round-trips custom keys for the drawde private-payload plan in `architecture-notes.md`.

## Gotchas discovered

1. **Docs 404 a lot.** `/docs/vanilla/introduction`, `/docs/capture/introduction` are dead. Use the GitHub repo (`examples/`, `website/src/content/docs/*/code-examples/`) as the reference.
2. **Snippet = shadow DOM + blob `<img>` pages + no page data attributes.** Overlaying is hostile. Go headless.
3. Task-style async: `getSelectedText().wait(cb)` — not a Promise, don't `await` it.
4. Plugin capabilities are document-scoped: `plugin.provides().forDocument(documentId)`.
5. `registry` is a promise: `const registry = await viewer.registry`.
