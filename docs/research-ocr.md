# Phase 3 — Math/LaTeX OCR landscape

Research completed **2026-07-29**. Question asked: open-weights math OCR (equation image → LaTeX), priority (1) self-hostable, (2) **runnable in the browser**, (3) hosted APIs as baselines.

## TL;DR — the three findings that matter

1. **Texo is a direct hit on our requirements.** A 20M-param model, ~80 MB download, **proven running fully client-side** via ONNX + transformers.js in a Web Worker, 311 ms/sample, live demo at [texocr.netlify.app](https://texocr.netlify.app). Accuracy within a few points of models 16× its size. **Catch: AGPL-3.0.**
2. **The "hard part" (autoregressive decoding in-browser) is already solved, twice** — Texo and granite-docling-258M ([verified WebGPU Space](https://huggingface.co/spaces/ibm-granite/granite-docling-258M-WebGPU)). transformers.js has KV-cache generation for VisionEncoderDecoder; v4 (Feb 2026) added a C++ WebGPU runtime with 3–10× gains. **We don't need to build decoding infrastructure.**
3. **Open weights now match or beat Mathpix on single equations.** UniMERNet-B (CDM ~0.959) edges Mathpix (~0.896–0.951), under **Apache-2.0 for code *and* weights**. Mathpix is no longer the accuracy ceiling — it's a convenience baseline.

## Benchmark literacy (read before comparing numbers)

- **CDM** (Character Detection Matching, [arXiv:2409.03643](https://arxiv.org/html/2409.03643v1), CVPR 2025) renders predicted and ground-truth LaTeX to images and matches characters visually — immune to the notation-ambiguity problem that makes BLEU/edit-distance misleading for LaTeX. **Trust CDM over BLEU.**
- **UniMER-Test** (23,757 formula images; **SPE** simple printed / **CPE** complex printed / **SCE** screen-capture / **HWE** handwritten) matches our use case. Our born-digital arXiv crops sit between SPE and **CPE** — **CPE is the number that should drive the decision**, and where models separate hardest.
- **OmniDocBench** is full-page parsing; its formula-CDM column mixes in layout/detection effects. Don't compare v1.0 numbers against v1.6 — different scales.
- **Known number conflict:** UniMERNet's paper reports HWE CDM ~0.953 and Mathpix ~0.951; the CDM paper reports UniMERNet-B HWE 0.9400 and Mathpix 0.896. Same models, different eval revisions. **Relative ordering is stable; absolute values are not.**

## Comparison table

Sorted by browser feasibility, then accuracy.

| Model | Params / disk | License (code / weights) | UniMER-Test CDM (SPE/CPE/SCE/HWE) | Self-host | Browser feasibility |
|---|---|---|---|---|---|
| **Texo** | **20M** / ~80 MB fp32 | AGPL-3.0 / AGPL-3.0 | **0.958 / 0.825 / 0.882 / 0.902** | Trivial | **PROVEN — live transformers.js demo** |
| granite-docling-258M | 258M / ~500 MB | Apache-2.0 / Apache-2.0 | n/a (eq. edit dist 0.073) | Easy | **PROVEN WebGPU Space**, but DocTags full-page format |
| pix2tex / RapidLatexOCR | ~25M / 102 MB | MIT / MIT | 0.962 / **0.649** / 0.676 / **0.245** | Trivial | ONNX exists (CPU); no browser port, easy to make |
| Xenova/texify (old) | 312M / ~1.2 GB | GPL-3.0 / CC-BY-SA-4.0 | ~0.985 / 0.704 / 0.793 / 0.527 | Easy | ONNX + transformers.js port exists; deprecated upstream |
| SmolDocling-256M | 256M | Apache-2.0 / Apache-2.0 | n/a (eq. edit 0.119) | Easy | Full ONNX; **superseded by granite-docling** |
| Qwen3-VL-2B | 2B / 1.1 GB q4 | Apache-2.0 / **Apache-2.0** | no published small-size formula CDM | Moderate | ONNX + transformers.js v4; ~1.1–1.6 GB download |
| **UniMERNet-T / S / B** | 107M / 160M / 325M — 441 MB / 773 MB / 1.3 GB | **Apache-2.0 / Apache-2.0** | B: **0.991 / 0.960 / 0.937 / 0.940**; T: 0.991/0.949/0.938/0.933 | Easy (PyTorch) | Only an unproven 2★ ONNX port; 2.3 s/sample on A40 |
| PP-FormulaNet-S / plus-L | 57M / 181M — 224 MB / 698 MB | Apache-2.0 / Apache-2.0 | S: 0.949 / 0.678 / 0.856 / 0.818 | Easy, **CPU 254 ms** | Paddle2ONNX path exists; no browser port |
| PaddleOCR-VL | 0.9B / 1.9 GB | Apache-2.0 / Apache-2.0 | OmniDocBench v1.6 formula CDM **97.53 (#1)** | Moderate (vLLM) | No |
| Surya 2 | ~650M | Apache-2.0 / **OpenRAIL-M, >$5M rev/funding blocked** | olmOCR-bench 83.3 | Moderate | No |
| GOT-OCR 2.0 | 580M / 1.4 GB | Apache-2.0 / Apache-2.0 | weak on formulas; OmniDocBench ~0.74 | Moderate | No |
| MinerU2.5-Pro | 1.2B | mixed / **AGPL-3.0** | OmniDocBench v1.6 CDM 97.45 | Moderate (vLLM) | No |
| olmOCR-2-7B | 7B / 30 GB | Apache-2.0 / **Apache-2.0** | CDM 88.10; RL-trained *specifically* on math→LaTeX | Heavy (12 GB VRAM) | No |
| Nougat-base | 348.7M / 1.4 GB | MIT / **CC-BY-NC-4.0** | math BLEU 56.9; hallucinates on crops | Heavy | Xenova/nougat-small ONNX exists but slow |
| Mathpix API | — | closed | 0.966 / 0.842 / 0.816 / **0.931** | $0.002/img | n/a |
| SimpleTex API | — | closed | **no independent benchmark exists** | 2,000 free calls/day | n/a |

## Why Texo works (and why the vocab trick matters)

[github.com/alephpi/Texo](https://github.com/alephpi/Texo) (874★, [arXiv:2602.17189](https://arxiv.org/html/2602.17189v1), Feb 2026): HGNetV2-B4 CNN encoder (14M) + 2-layer mBART decoder (5M), distilled from PPFormulaNet-S on UniMER-1M, with the vocabulary shrunk from 50,000 tokens to **687** by deriving it from KaTeX and stripping whitespace.

That vocab reduction is what makes browser autoregressive decoding tractable: sequences get much shorter, so the decode loop is short and the embedding table stays under 1M params.

**The AGPL problem:** for a hosted web app the network-use clause bites — serving it obliges us to offer our app's corresponding source. Because our deployment would be *client-side* (weights ship to the browser), exposure is broader than typical SaaS AGPL. **This is the single biggest decision item in this report.**

## Notable traps and dead ends

- **pix2tex is the famous one and the wrong choice.** [16.5k★](https://github.com/lukas-blecher/LaTeX-OCR), MIT, dormant since Jan 2025. CPE CDM **0.649**, HWE **0.245** (BLEU 0.012 — unusable on handwriting). Tuned for clean im2latex crops; real arXiv display equations with fractions/matrices/multi-line alignment are exactly the CPE case where it degrades. RapidLatexOCR is a clean permissive ONNX port but inherits the ceiling.
- **Texify/Surya licensing moved the wrong way.** Texify [archived 2025-01-29](https://github.com/VikParuchuri/texify), folded into Surya. Surya *code* went GPL-3.0 → Apache-2.0, but **weights are modified AI Pubs OpenRAIL-M**: prohibited for orgs with >$5M revenue **or** >$5M funding, or competing with any Datalab product, share-alike on derivatives. Chandra is the same at **$2M**. Old `vikp/texify` weights are CC-BY-SA-4.0 (commercially fine); `datalab-to/texify` is CC-BY-NC-SA. **If drawde ever takes funding, these are landmines.**
- **Nougat is wrong twice over** — CC-BY-NC-4.0 weights (blocks commercial use outright), and it's a full-page model that hallucinates and repetition-loops on isolated crops. Unmaintained since 2023.
- **Florence-2 has no LaTeX capability.** Task tokens are `<OCR>` / `<OCR_WITH_REGION>`; zero-shot it flattens a formula to characters and loses structure. The one community LaTeX fine-tune was removed from HF. Browser-ready shell with nothing in it for us.
- **Nanonets-OCR license trap:** cards said Apache-2.0, maintainers [conceded](https://huggingface.co/nanonets/Nanonets-OCR2-3B/discussions/2) it was "mistakenly listed" — actually inherits Qwen Research (NC). Same trap on Qwen2.5-VL-**3B**. Qwen2.5-VL-7B and the **entire Qwen3-VL family including 2B are Apache-2.0**.
- **GOT-OCR 2.0**: Apache-2.0 and popular, but a generalist — underperforms MER-specific models, no handwritten-formula training. 580M params for worse per-crop accuracy than a 20M specialist.

**License landmines to avoid outright:** Nougat weights (CC-BY-NC), Qwen2.5-VL-3B (Research/NC), Nanonets-OCR-s/OCR2 (mislabeled Apache, actually NC), MonkeyOCR weights (NC, written license required for SaaS), Chandra (<$2M cap), Marker/Surya (<$5M cap), datalab-to/texify (CC-BY-NC-SA), HunyuanOCR (Tencent community license), MinerU2.5 weights (AGPL).

## Handwriting (future stylus feature)

| Model | HWE CDM | Note |
|---|---|---|
| UniMERNet-B | 0.940–0.953 | Best open, Apache-2.0 |
| Mathpix | 0.931 | Best commercial |
| **Texo** | **0.902** | Beats its own teacher and UniMERNet-T despite 20M params |
| PP-FormulaNet-S | 0.818 | Apache-2.0 |
| Texify | 0.527 | deprecated |
| pix2tex | 0.245 | unusable |

Texo holding 0.902 at 20M params means **a single browser model could cover both the PDF-crop and future stylus paths**.

Two caveats: (1) **stylus input is stroke data, not an image** — the strongest results come from online/stroke models (Uni-MuMER, a Qwen2.5-VL-3B fine-tune, hits CROHME ExpRate 79.74 vs 37.95 un-tuned; [MathWriting](https://arxiv.org/abs/2404.10690) is the dataset). Rasterizing strokes and reusing the printed model is the cheap path and Texo's 0.902 says it mostly works; stroke-native is the ceiling. (2) TrOCR handwriting fine-tunes exist ([tjoab/latex_finetuned](https://huggingface.co/tjoab/latex_finetuned) CER 14.9%; [fhswf/TrOCR_Math_handwritten](https://huggingface.co/fhswf/TrOCR_Math_handwritten) 77.8% exact match) but at 0.3–0.6B they're server-side with unspecified/AFL-3.0 licenses.

## Recommendations

**(a) Server-side pick: UniMERNet-small** (fallback: -base). Apache-2.0 on code *and* weights, no revenue cap, no NC clause — **cleanest license in the report at this accuracy tier**. CDM ~0.96 beats Mathpix. 773 MB, single-GPU, CPU-viable at seconds/formula. It's the standard MFR model that MinerU and PDF-Extract-Kit both wrap, so it's battle-tested. Faster/lighter alternates: **PP-FormulaNet_plus-L** (698 MB) or **-S** (224 MB, **254 ms on CPU**). PaddleOCR-VL 0.9B is the accuracy king but is a vLLM deployment.

**(b) Browser pick: Texo — realistic today, with an AGPL decision to make first.** Three paths, in preference order:

1. **Ship Texo as-is and accept AGPL** — viable if drawde is open-source or we're willing to make it so. Fastest route.
2. **Rebuild the recipe under a permissive license.** Both ingredients are Apache-2.0 (PPFormulaNet-S as teacher, UniMER-1M as data), the paper trained on a **single A40**, and the KaTeX-derived 687-token vocab is described well enough to reimplement. A genuinely reproducible few-hundred-dollar effort for Texo-class accuracy with clean licensing.
3. **Interim permissive fallback:** ONNX-export UniMERNet-tiny (Apache-2.0, 107M, ~200 MB int8) for WebGPU. Better CPE accuracy than Texo but ~4× the download and unproven in-browser (existing port is 2★).

Architecture: **progressive enhancement** — browser model for the instant common case, server-side UniMERNet as a "refine this" button. Our CPE-heavy arXiv display math is exactly where the 20M model is weakest (0.825), so that escape hatch matters.

**(c) Accuracy ceiling reference: UniMERNet-B (open) + Mathpix (commercial sanity check).** Build the eval harness on **UniMER-Test CPE + SPE** using **CDM, not BLEU** — CDM code at [UniMERNet/tree/main/cdm](https://github.com/opendatalab/UniMERNet/tree/main/cdm) (the standalone `opendatalab/CDM` repo now 404s). Mathpix at $0.002/image is cheap enough to run a few hundred of our own real arXiv crops through as a reference set. **SimpleTex appears in no published benchmark — treat its accuracy as unknown.**

## Implication for the OCR comparison demo (user request, not yet built)

The user asked for a demo where you upload an equation image and compare OCR engines side by side, **labelled browser-side vs. requires-hosting**. Based on the above:

- **Browser-side, ready now**: Texo (transformers.js, ~80 MB) — the headline. granite-docling-258M (WebGPU, ~500 MB) as a second.
- **Browser-side, would need porting**: pix2tex/RapidLatexOCR (ONNX exists), Xenova/texify (port exists but deprecated model).
- **Requires hosting**: UniMERNet (any size), PP-FormulaNet, PaddleOCR-VL, GOT-OCR, olmOCR, MinerU, Surya.
- **Hosted API baselines**: Mathpix ($0.002/img), SimpleTex (2,000 free calls/day).

Cheapest credible v1 of the demo: **Texo in-browser** + **Mathpix API** + one hosted UniMERNet, all fed the same uploaded crop, results side by side with timing and a browser/server badge.

## Sources

[Texo](https://github.com/alephpi/Texo) · [Texo paper](https://arxiv.org/html/2602.17189v1) · [Texo demo](https://texocr.netlify.app) · [UniMERNet](https://github.com/opendatalab/UniMERNet) · [CDM paper](https://arxiv.org/html/2409.03643v1) · [LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR) · [RapidLatexOCR](https://github.com/RapidAI/RapidLatexOCR) · [surya](https://github.com/datalab-to/surya) · [surya MODEL_LICENSE](https://github.com/datalab-to/surya/blob/master/MODEL_LICENSE) · [texify](https://github.com/VikParuchuri/texify) · [Xenova/texify](https://huggingface.co/Xenova/texify) · [facebook/nougat-base](https://huggingface.co/facebook/nougat-base) · [GOT-OCR2.0](https://github.com/Ucas-HaoranWei/GOT-OCR2.0) · [MinerU](https://github.com/opendatalab/MinerU) · [OmniDocBench](https://github.com/opendatalab/OmniDocBench) · [PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL) · [PP-FormulaNet docs](https://www.paddleocr.ai/latest/en/version3.x/module_usage/formula_recognition.html) · [granite-docling WebGPU](https://huggingface.co/spaces/ibm-granite/granite-docling-258M-WebGPU) · [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) · [Uni-MuMER](https://arxiv.org/html/2505.23566) · [MathWriting](https://arxiv.org/abs/2404.10690) · [Mathpix pricing](https://mathpix.com/pricing/api) · [SimpleTex API](https://doc.simpletex.cn/en/api/api_formula_recognition.html) · [Florence-2](https://huggingface.co/microsoft/Florence-2-base) · [transformers.js v3](https://www.huggingface.co/blog/transformersjs-v3)
