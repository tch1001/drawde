# Phase 1 — PDF reader technology survey

Data collected **2026-07-29** from live GitHub + npm APIs. Comparison site built at `explorations/pdf-readers/` with 7 working demos, all verified in a real browser.

Sample document: Maldacena, *The Large N Limit of Superconformal Field Theories and Supergravity* (hep-th/9711200, 22 pages, equation-dense).

## Comparison table

| Library | Stars | License | Latest release | UI included | Text select | Annotations | Virtualized | Text coords | CDN no-build |
|---|---|---|---|---|---|---|---|---|---|
| pdf.js | ~53.6k | Apache-2.0 | v6.2.108 · 2026-07 | prebuilt viewer | yes | highlight/ink/text | lazy pages | `getTextContent` | yes |
| **EmbedPDF** | ~4.3k | MIT | v2.14.4 · 2026-06 | yes + plugins | plugin | full set, saves to PDF | yes | selection rects | snippet |
| react-pdf | ~11.1k | MIT | v10.4.1 · 2026-02 | renderer only | yes | display only | DIY | via pdf.js | npm |
| PDFSlick | ~1.1k | MIT | v4.0.0 · 2026-06 | headless store | yes | via pdf.js layers | inherits pdf.js | via pdf.js | npm mostly |
| Lector | ~389 | MIT | v3.14.5 · 2026-07 | headless primitives | yes | experimental | built-in | designed for it | npm |
| react-pdf-highlighter | ~1.4k | MIT | dormant 2024 | minimal | yes | **text + area rects** | no | emits rects | npm |
| @react-pdf-viewer | ~2.6k | non-OSS | **archived 2026-03** | yes | yes | highlight plugin | partial | rects | npm |
| mupdf.js | ~600 | AGPL / paid | 1.28.0 · 2026-06 | engine only | build it | programmatic | n/a | **best-in-class bboxes** | heavy ESM |
| PDFium WASM | 4.3k/183 | MIT/BSD-3 | 2026-05/06 | engine only | build it | programmatic | n/a | per-char rects | feasible |
| PDFObject | ~2.5k | MIT | 2.3.1 · 2025-02 | native viewer | browser-dep | no | no | none | yes |
| Apryse WebViewer | closed | $1.5k+ comm. | 12.0.1 · 2026-07 | full | yes | full | yes | quads API | key + assets |
| Nutrient (PSPDFKit) | closed | commercial | 1.18.0 · 2026-07 | full | yes | full | yes | textLines API | key + assets |
| Adobe PDF Embed | closed | free w/ key | SaaS | full (iframe) | yes | built-in tools | yes | **events only** | Adobe CDN |
| ngx-extended-pdf-viewer | ~584 | Apache-2.0 | 28.1.0 · 2026-07 | full pdf.js viewer | yes | pdf.js editor | inherits | via pdf.js | Angular only |

## Key takeaways

- **Everything free-with-a-UI is pdf.js underneath — except EmbedPDF**, which is PDFium (Chrome's engine) compiled to WASM. That's the real fork in the road. **→ We chose EmbedPDF.**
- **Best geometry APIs** (for feeding equation regions to the AI): mupdf.js structured text > PDFium per-char rects > pdf.js `getTextContent`. mupdf's AGPL is a problem for closed SaaS; usable server-side if our backend is open-sourced, or pay Artifex.
- **@react-pdf-viewer is dead** — archived 2026-03, pinned to CVE-affected pdf.js, last release 2023. It still tops search results. **Lector** is the living successor for headless React primitives.
- **react-pdf-highlighter proves the interaction** we want (text + area highlights with rect data) but is dormant since 2024 — reference implementation / fork-fodder, not a dependency. **Worth reading its source before building phase 2.**
- **Commercial tier** (Apryse/Nutrient) is polished but sales-quoted $$$$. **Adobe Embed** is free but a black-box iframe with no text-geometry access — disqualifying for the AI pipeline.
- pdf.js major-version churn (v4→v6 in ~2 years) regularly breaks wrappers — favour thin wrappers or direct use.
- Viable hybrid: **EmbedPDF for the viewing pane** + **an engine (mupdf/PDFium server-side) for extraction** feeding the AI.

## The demo site

`explorations/pdf-readers/` — static, no build step. Serve with `python3 -m http.server 8787`.

7 live demos, all verified working in-browser:
1. `native.html` — plain iframe (control group)
2. `pdfobject.html` — PDFObject embed helper
3. `pdfjs-viewer.html` — pdf.js prebuilt viewer (vendored v6.2.108 in `vendor/pdfjs/`)
4. `pdfjs-custom.html` — **pdf.js as a library with a working region-select prototype** (drag a box → reports PDF-space coords). This was the proof-of-concept that led to the box-selection decision.
5. `pdfslick.html` — PDFSlick via CDN
6. `embedpdf.html` — EmbedPDF snippet
7. `mupdf.html` — mupdf WASM engine, renders pages + dumps text-block bboxes

### CDN workarounds needed for the no-build demos (documented so they aren't rediscovered)

- **pdf.js v6 dropped the bare-string `getDocument("url")` shorthand** → must use `getDocument({ url })`.
- **PDFSlick** unbundled needs `globalThis.pdfjsLib` set to the *same* esm.sh pdfjs instance its bundle imports (`https://esm.sh/pdfjs-dist@^6.0.227?target=es2022`), and its `workerSrc` points at a path that 404s — override it after import.
- **mupdf** via esm.sh fails (`[unenv] module.require is not implemented`) — the esm.sh node shim breaks it. Load the package's own ESM build from jsDelivr instead: `https://cdn.jsdelivr.net/npm/mupdf@1.28.0/dist/mupdf.js`. WASM is ~10 MB uncompressed.

## User's verdict on phase 1

> *"none of them really makes me really go like wow"* — which drove the decision to build our own viewer on top of EmbedPDF rather than adopt any viewer as-is.
