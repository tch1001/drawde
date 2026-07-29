# drawde

A theoretical-physics reading assistant. Upload a paper (PDF) and either:

1. **Fill in the gaps** — highlight the jump between Eq. (12) and Eq. (13) and have an AI expand the suppressed algebra, using the *whole paper* as context (notation, conventions, ℏ=c=1, metric signature).
2. **LaTeX playground** — an editor beside the paper so you never hand-transcribe `\tilde{\mathcal{G}}^{\mu\nu}_{ab}` again.

Started 2026-07-29. Owner: capcutprojects@gmail.com.

## Why this is not another "AI physics solver"

Market scan (2026-07-29) found the space is crowded at the **homework-solver** end and empty at the **research** end:

- Homework solvers (physicsai.chat, EaseMate, LearnFast, TutorBin, Edubrain, NoteGPT, physicsaisolver.net): "photo of a textbook problem → steps". Student-facing, no document context.
- PDF→LaTeX OCR (Mathpix, Nougat, I Love My LaTeX, TeX64): solved problem, rentable — **do not build OCR from scratch**.
- LaTeX playgrounds (8gwifi, TexMate, CodeCogs, LaTeX4technics): equation-snippet editors, not tied to any source document.
- **Nobody ships "expand the suppressed steps in *this paper*"**. Academic work exists on "equational gap filling" (arXiv 2605.12524) but no product. That is the differentiator.

The wedge: **the PDF is the first-class object.** Selection → AI → editable LaTeX, all anchored to the paper, with the paper's own notation.

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1. PDF reader survey | ✅ done | Comparison site of viewer technologies — see `docs/research-pdf-viewers.md` |
| 2. Custom viewer | 🔨 in progress | Own viewer on EmbedPDF: rectangle + text selection, "add to chat" panel |
| 3. OCR/LLM pipeline | 📋 researched | Selection → LaTeX. See `docs/research-ocr.md`. Comparison demo still to build |
| 4. Gap-filling AI | ⏳ not started | Region + paper context → expanded derivation |
| 5. LaTeX playground | ⏳ not started | Paper-aware editor with symbol autocomplete |
| 6. Annotation export | ⏳ not started | drawde annotations embedded in PDF, degrading gracefully |

## Layout

```
drawde/
├── README.md               # this file
├── HANDOFF.md              # ← START HERE in a new session: live state, running processes
├── docs/
│   ├── architecture-notes.md      # the design brainstorm (layer stack, Region, AI-as-user, PDF metadata)
│   ├── research-pdf-viewers.md    # phase 1 findings
│   ├── embedpdf-api-notes.md      # live API probe of EmbedPDF — read before building
│   └── research-ocr.md            # phase 3 findings (pending agent)
├── explorations/
│   └── pdf-readers/        # phase 1 comparison site (7 working demos)
└── viewer/                 # phase 2 custom viewer (in progress)
```

## Development notes

- The user is **not on the host machine** — everything must be exposed via `cloudflared` tunnel to be inspected. See `HANDOFF.md` for the current URL and how to restart.
- The user wants to *see and click* things. Ship visible demos, not descriptions.
