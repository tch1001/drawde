# HANDOFF — read this first

Last updated: **2026-07-30**, session 1 (continued).

> **Build vs typecheck:** `vite build` does **not** typecheck — it happily bundled a missing
> import that would have crashed at runtime. Run **`npx tsc --noEmit`** (currently clean) before
> committing. This is the single most useful check in the repo.
Read `README.md` for the project goal, then `docs/architecture-notes.md` for the design decisions.

---

## ⚡ The single most important context

**The user is not on this host.** They inspect everything through a `cloudflared` tunnel. Any work they need to *see* must be served + tunnelled, and the URL given to them. They repeatedly ask to "see it on the site" — ship visible, clickable things.

---

## Live state at end of session 1

### Running processes (these die when the machine/session restarts — restart them)

| What | Command | Port |
|---|---|---|
| Combined site (hub + viewer + phase-1 demos) | `cd ~/drawde/site && python3 -m http.server 8787 --bind 127.0.0.1` | 8787 |
| Tunnel (→ 8787) | `cloudflared tunnel --url http://127.0.0.1:8787` | — |
| Viewer dev server (optional, HMR) | `cd ~/drawde/app && npx vite` | 5180 |

`~/drawde/site/` is the single served root: `index.html` hub + symlinks `viewer → ../app/dist` and
`pdf-readers → ../explorations/pdf-readers`. **After changing the app, run `cd ~/drawde/app && npx vite build`**
— the tunnel serves `dist`, not the dev server.

Start background processes **detached** (`setsid nohup … &` with `< /dev/null`), otherwise they die with the tool call.

Tunnel URL as of session 1: `https://clips-admission-scout-stats.trycloudflare.com`
**Quick tunnels get a new random URL on every restart** — always re-extract it and tell the user:
```bash
nohup cloudflared tunnel --url http://127.0.0.1:8787 > /tmp/cf.log 2>&1 &
sleep 8 && grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cf.log | head -1
```
Consider serving one port with sub-paths for everything so a single tunnel covers all demos.

### Background agents — both completed, findings written up

- PDF viewer survey → `docs/research-pdf-viewers.md` ✅
- Math/LaTeX OCR survey → `docs/research-ocr.md` ✅ (landed at the very end of session 1)

**Headline OCR result:** **Texo** (20M params, ~80 MB) runs **fully in-browser** via transformers.js with a live public demo — accuracy within a few points of models 16× larger, and browser autoregressive decoding is already a solved problem. **But it's AGPL-3.0**, which for a client-side-shipped model is a real decision, not a footnote. The clean-license server-side pick is **UniMERNet-small** (Apache-2.0 on code *and* weights, beats Mathpix). Full detail, license landmines, and handwriting rankings are in the doc.

---

## What the user asked for that is NOT yet done

### 0. Phase 2 viewer — ✅ BUILT (session 1). Lives in `~/drawde/app`.

Everything in the spec below is working and browser-verified through the tunnel. Stack: **React + Vite + EmbedPDF headless packages** (not the snippet).

Files:
- `src/types.ts` — the `Region` type (the universal currency; see architecture notes) + `CROP_SCALE = 4`
- `src/store.ts` — framework-agnostic external store for `Region[]`. **The eventual AI command bus should push into this same store the mouse writes to.**
- `src/modes.ts` — `BOX_MODE = 'drawdeBox'` (ours), `TEXT_MODE = 'pointerMode'` (EmbedPDF's built-in)
- `src/BoxSelectLayer.tsx` — per-page layer: registers pointer handlers for box mode, draws preview + persistent rects with ✕, calls `renderPageRect` for the high-DPI crop
- `src/SelectionPanel.tsx` — right-hand context panel
- `src/App.tsx` — plugin registration, layer composition, R/T keybinding, text-selection→Region bridge

Implementation notes worth keeping:
- **Crops come from `render.forDocument(id).renderPageRect({pageIndex, rect, options:{scaleFactor: CROP_SCALE}})`**, *not* the capture plugin — capture's marquee is transient/exclusive and fights persistent multi-select. `renderPageRect` is a clean crop source at any scale.
- `PageLayout` (the `renderPage` callback arg) **has no `scale` field** — read scale from `useDocumentState(documentId).scale`, the same way `PagePointerProvider` does. Passing a non-existent `scale` prop silently gives `NaN` positions and rectangles pile up at 0,0.
- Shift state is sampled on `pointerdown` via a capture-phase window listener (`shiftHeld` in `App.tsx`) because keyup can beat pointerup.
- `interaction.addExclusionClass('dd-no-interaction')` keeps our toolbar from eating page pointer events.
- Box mode is registered `exclusive: false` — `exclusive: true` makes `PagePointerProvider` overlay a z-index-10 div that would block the ✕ buttons.

Since then the viewer also gained: a hamburger **sidebar** (outline when the PDF has one, else page
thumbnails), **ctrl/cmd+wheel zoom** centred on the cursor, **PageUp/PageDown** that never swallow
rapid presses, **drag-to-resize** splitters, a **tiling layer**, **ctrl/cmd+F search**, an editable
**page-number input**, a full **mobile layout**, and the **Lock-selection** toggle.

### Hard-won gotchas (all cost real debugging time — don't re-learn these)

| Symptom | Cause |
|---|---|
| Box + text selection both dead under a **real mouse** (fine with synthetic events) | `RenderLayer` renders a bare `<img>`; a real drag starts native HTML5 image-drag, which fires `dragstart` and **cancels the pointer stream**. Fixed with `draggable={false}` + `onDragStart` preventDefault + `user-select:none`. EmbedPDF never calls `preventDefault` on mouse/pointer events. |
| **Blank viewer** until you touch the zoom control | Passing a *partial* config to `ZoomPluginPackage` **replaces the whole `defaultConfig`**, wiping `zoomRanges`/`minZoom`/`maxZoom`, so scroll layout never emitted. Pass no config, or every required key. |
| Zoom **jumps to page 1** | The zoom plugin's `Point` is **`{vx, vy}`**, not `{x, y}`. `{x,y}` leaves vx/vy undefined → NaN scroll math. |
| Zoom +/− buttons silently dead | `useZoom(documentId).provides` is **already document-scoped** — calling `.forDocument()` on it is `undefined`. |
| Rectangles pile up at 0,0 | `PageLayout` (the `renderPage` arg) has **no `scale` field** — read scale from `useDocumentState(documentId).scale`. |
| Zoom flicker | Two separate artifacts. The *blank flash* was fixed by the tiling layer. The remaining *blur pulse* was the base `RenderLayer` pinned at `scale={1}` and upscaled by the full zoom factor; now quantized to a `[1, 1.5, 2]` ladder (`useBaseScale`). Measure with per-rAF sampling, don't eyeball it. |

**Next on the viewer:** multi-page selections, drag-to-move/resize existing boxes, and wiring the
"Ask drawde" button.

### 1. Original phase-2 spec (for reference — all of this is now implemented)
User's spec, verbatim intent:
- Build our **own PDF viewer library on EmbedPDF as the base**.
- Ship first feature: **select a rectangle → the cropped image appears in a right-hand panel.**
- **Shift-click to select MORE rectangles** (additive).
- Rectangles **persist on the PDF**, each removable via **a cross in its top-right corner**.
- **`R` / `T` keys toggle** rectangle-select vs text-select mode.
- **Shift lets you mix** rectangle and text selections.
- Right panel shows **all selected items** (both kinds).
- Explicitly modelled on **Cursor's "add to chat"** experience.
- "later we will pipe it to some actual OCR and LLM" — so keep a clean seam where selections become model input.

`viewer/probe.html` is a leftover API probe, not the app — the app is `~/drawde/app`.

### 2. OCR comparison demo (requested, not started)
User's request, verbatim intent:
> *"for the OCR stuff, i want a demo comparing the various OCRs (maybe can let the user upload an image), let me know which OCRs require hosting and which ones are within the browser"*

So: a page where the user **uploads an image of an equation** and sees **several OCR engines' LaTeX output side by side**, each **clearly labelled browser-side vs. requires-hosting**. Put it on the tunnelled site.

Research is done (`docs/research-ocr.md`), so this is now buildable. Cheapest credible v1: **Texo running in-browser** (transformers.js, ~80 MB, no server) + **Mathpix API** as the commercial baseline + one hosted UniMERNet, all fed the same uploaded crop, shown side by side with timing and a browser/server badge. See the "Implication for the OCR comparison demo" section of that doc for which models fall in which bucket.

---

## Completed in session 1

- **Market research** — confirmed the "expand suppressed derivation steps in *this paper*" niche is unoccupied. Details in `README.md`.
- **Phase 1 PDF viewer survey** — 14 libraries compared, 7 live demos built and browser-verified. See `docs/research-pdf-viewers.md` and `explorations/pdf-readers/`.
- **Design brainstorm** — layer stack, `Region` abstraction, dual-channel (image + text layer) OCR strategy, AI-as-a-user-of-the-viewer command bus, PDF private-metadata export plan. All in `docs/architecture-notes.md`. **These were discussed and endorsed by the user — not speculation.**
- **EmbedPDF chosen as the base library** (user's decision) and its API probed live. See `docs/embedpdf-api-notes.md`.

## Decisions made (don't re-litigate)

1. **Box/rectangle selection is the primary primitive**, not text highlighting — because equation text layers are glyph soup.
2. **EmbedPDF is the viewer base.** Keep it behind an interface so pdf.js remains swappable.
3. **Don't build OCR from scratch**; and prefer sending image + text-layer + paper context to a multimodal model over treating OCR as a discrete step.
4. Audience is **researchers/grad students reading real papers**, not homework students.

## Open questions for the user

- Framework for the viewer (React has the best EmbedPDF support; user hasn't been asked).
- Whether the backend can be open-sourced (decides whether AGPL mupdf.js is usable server-side for extraction).

## Environment notes

- `cloudflared` v2026.6.0 at `~/.local/bin/cloudflared`; node v22.12.0 (nvm); python3 (anaconda).
- `~/drawde` is **not a git repo** yet — consider `git init` early.
- Sample PDF (`sample.pdf`, Maldacena hep-th/9711200, 22 pages, equation-dense) is in both `explorations/pdf-readers/assets/` and `viewer/` — a good stress test.
- pdf.js v6.2.108 is vendored at `explorations/pdf-readers/vendor/pdfjs/`.
- EmbedPDF source was shallow-cloned to the session scratchpad (likely gone now). Re-clone: `git clone --depth 1 https://github.com/embedpdf/embed-pdf-viewer.git`. **The repo's `examples/` and `website/src/content/docs/*/code-examples/` are the real documentation — the docs site 404s on many pages.**
