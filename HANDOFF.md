# HANDOFF — read this first

Last updated: **2026-07-29**, end of session 1.
Read `README.md` for the project goal, then `docs/architecture-notes.md` for the design decisions.

---

## ⚡ The single most important context

**The user is not on this host.** They inspect everything through a `cloudflared` tunnel. Any work they need to *see* must be served + tunnelled, and the URL given to them. They repeatedly ask to "see it on the site" — ship visible, clickable things.

---

## Live state at end of session 1

### Running processes (these die when the machine/session restarts — restart them)

| What | Command | Port |
|---|---|---|
| Phase-1 demo site | `cd ~/drawde/explorations/pdf-readers && python3 -m http.server 8787 --bind 127.0.0.1` | 8787 |
| Phase-2 viewer scratch | `cd ~/drawde/viewer && python3 -m http.server 8788 --bind 127.0.0.1` | 8788 |
| Tunnel (→ 8787) | `cloudflared tunnel --url http://127.0.0.1:8787` | — |

Tunnel URL as of session 1: `https://algebra-fiction-enforcement-outcome.trycloudflare.com`
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

### 1. Phase 2 viewer (in progress — the active task)
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

**Status: research done, no viewer code written yet.** `viewer/probe.html` is only an API probe (do not mistake it for the app). Read `docs/embedpdf-api-notes.md` **before writing code** — it contains the live-probed API surface and the crucial snippet-vs-headless finding.

**Recommended approach** (from the probe): use the **headless EmbedPDF plugin packages + a bundler (Vite)**, not the CDN snippet. The snippet renders into shadow DOM with blob-`<img>` pages and no page data attributes, which makes persistent overlays hostile. Headless lets us compose `<Viewport>/<Scroller>/<PagePointerProvider>/<RenderLayer>` and own the page DOM.

Design the selection store around the **`Region`** abstraction in `docs/architecture-notes.md` — box and text selections should produce the same object type. That's what makes the right panel and the later OCR/LLM pipe uniform.

Note: EmbedPDF's built-in marquee capture is **transient** (one rect, cleared on commit). For persistent multi-rect we keep our own `Region[]` and call `captureArea(pageIndex, rect)` per region.

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
