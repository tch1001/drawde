# Architecture notes / design brainstorm

Captured 2026-07-29. These are agreed directions from discussion with the user, not speculation.

## The founding insight: box selection, not text selection

The user's words: *"being able to select a rectangular box (instead of highlighting pdf, which behaves strangely sometimes) would be greatly beneficial."*

Why this is correct for physics papers: **equations aren't text in any useful sense.** The text layer under a rendered equation is glyph soup — superscripts out of document order, invisible kerning spans, ligature garbage, `\int` split into pieces. Dragging to select an equation gives you nonsense. A rectangle gives you *pixels*, which a multimodal model reads perfectly.

So: **box-first, text as a secondary channel.**

## The layer stack

Don't write a rasterizer. Take an engine (EmbedPDF/PDFium) for decode + raster only, and own everything above it. Per page:

```
┌─ AI layer          ← AI-drawn cursors, spotlights, arrows, ephemeral marks
├─ annotation layer  ← persistent drawde annotations (SVG)
├─ selection layer   ← box-drag + text selection, unified
├─ text layer        ← invisible glyph spans, for quote-anchoring
└─ raster canvas     ← engine output; also the high-DPI crop source
```

## `Region` — the universal currency

**Selection always produces a `Region`**, whether it came from a box-drag, a text-drag, or the AI. This is the key abstraction: text vs. box selection stop being separate features.

```ts
type Region = {
  id: string
  kind: 'box' | 'text'
  page: number
  rects: Rect[]          // PDF user-space (pt, bottom-left origin) — resolution independent
  text?: string          // whatever the text layer yields inside (glyph soup is fine, it carries symbols)
  image?: Blob           // high-DPI crop (~3-4x scale)
  anchor?: TextQuote     // {prefix, exact, suffix} — survives re-rendering / v2 of the paper
}
```

Everything downstream — AI calls, annotations, export — consumes `Region`s.

## OCR strategy: send *both* channels, skip OCR-as-a-separate-step

Born-digital arXiv PDFs let us beat pure OCR:

- Render the box at 3–4× scale (crisp image), **and** grab the text layer inside the rect, **and** grab surrounding context (page, paper notation table).
- Feed all three to a multimodal model: *"here's the image, here's the raw text layer beneath it, here's the paper's conventions — give me faithful LaTeX."*
- **The image disambiguates layout; the text layer disambiguates symbols** (is that ν or v? α or a?). Each channel covers the other's failure mode.
- Mathpix stays an optional high-accuracy fallback, never a dependency.
- Return LaTeX **plus per-token confidence**; render the LaTeX beside the crop for one-glance human verification. *That verification UI is half the product's trust.*

## AI as a *user* of the viewer (the most novel idea)

Give the AI the same API a human's mouse has — a small tool protocol:

```
select_region(page, bbox)   highlight_quote(text)    scroll_to(anchor)
draw_arrow(regionA, regionB)   annotate(region, content)   spotlight(region)
```

…and feed viewer state *back* as context (current viewport, user's selection, existing annotations).

What it unlocks:

- **Deictic explanation** — the AI *points while talking*: "this factor —" (spotlight on region) "— comes from integrating out —" (spotlight moves). A tutor's finger on the page. **Nobody has this.**
- **Equation karaoke** — term-by-term walkthrough, each term flashing as its meaning streams in.
- **Dependency overlay** — "how does Eq. (23) descend from (12)?" → AI draws an arrow graph over the paper.
- **"Find the gaps for me"** — AI pre-scans and proposes regions: *"between (14) and (15), three steps are suppressed — want them?"* User just clicks yes.

Architecturally this is a **command bus**: AI emits JSON ops, viewer executes them; humans and AI write to the same annotation store. That symmetry is what makes it feel alive.

## PDF metadata / export — the spec is on our side

Goal (user's idea): export a PDF carrying drawde annotations. Other viewers show *something* sane; the drawde client rehydrates the full interactive state.

Four mechanisms, increasing power:

1. **Private keys on annotation dicts** — any annotation may carry unknown keys; conforming readers *must* ignore them. So a standard `/Square` annotation carries `/DrawdeID`, `/DrawdePayload`. Zero cost.
2. **`/PieceInfo`** — the spec's *official* app-private-data slot (document- and page-level), keyed by app name with `/Private` + `/LastModified`. Literally designed for "our app's data, invisible to others."
3. **Embedded files** — attach a whole `drawde.json` (or generated `.tex`) via the EmbeddedFiles name tree. Acrobat shows a paperclip; drawde hydrates it.
4. **XMP metadata** with a custom `drawde:` namespace for document-level data (paper hash, version, share URL).

**Graceful degradation by design:** write every drawde annotation as a *standard* annotation (Square/Highlight/FreeText) with a normal appearance stream, so Acrobat/Preview users see a box + note ("AI-expanded derivation — open in drawde", optionally a link annotation to the hosted version). drawde reads the private payload and turns the same box into the interactive panel. **One file, two experiences.**

Plus:
- **Incremental update** — append annotations without touching original bytes. Original paper's hash preserved; provenance clean; "strip drawde layer" trivial.
- **Robust anchoring** — store rect coords *and* a text-quote anchor (prefix/exact/suffix, per the W3C Web Annotation model) so annotations survive re-rendering or a v2 of the paper. Worth adopting that data model wholesale — free interop, well-designed schema.

## Open decisions

- **Engine**: decided → EmbedPDF (see `embedpdf-api-notes.md`). Keep it behind an interface so it can be swapped for pdf.js.
- **Framework**: undecided. The EmbedPDF headless packages support React/Vue/Svelte/Preact/vanilla. React has the richest EmbedPDF support.
- **Audience**: researchers/grad students reading real papers (not students doing homework). Affects tone, pricing, everything.
