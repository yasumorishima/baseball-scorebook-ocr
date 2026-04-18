# baseball-scorebook-ocr

Amateur baseball scorebook OCR + stats aggregation app. Built for the **Built with Opus 4.7 Hackathon** (Cerebral Valley × Anthropic, Apr 21–26, 2026).

## The problem

Amateur / sandlot baseball teams track games on paper scorebooks or scattered spreadsheets. Compiling per-player stats across a season takes hours of manual work. **The aggregation itself is the pain point** — not the math, but getting data out of the scorebook.

## The moonshot: scorebook photo recognition

Japanese baseball scorebooks use a specialized notation system (`4-3` for ground-ball double plays, `F7` for flyouts, unique symbols for sacrifice bunts) mixed with handwriting variation across keepers. No existing AI can read them end-to-end — generic OCR treats the symbols as text and domain-specific tools don't exist.

Opus 4.7's multimodal + domain-reasoning combination is the first realistic shot at cracking this.

**Approach:** confidence-scored output per cell. High-confidence cells auto-commit; low-confidence cells trigger a review UI showing the original image snippet. "Magic autofill with review" rather than lossless OCR.

## Supporting features

- **Natural-language in-game entry** — "3番センター前ヒット、ランナー3塁へ" → structured events
- **Automatic stats aggregation** — BA / OBP / SLG / ERA across a season
- **Offline-first PWA** — amateur ballparks often have poor reception
- **Team-scoped access** — Supabase Auth + Row Level Security with invite codes

## Stack

- **Frontend**: Next.js (App Router, TypeScript, PWA) on Vercel
- **Backend**: Supabase (Postgres + Auth + RLS)
- **AI**: Claude Opus 4.7 (Vision + text)
- All on free tiers.

## Status

Early development. See [experiments/ocr-baseline/](./experiments/ocr-baseline/) for the scorebook OCR accuracy probe — the riskiest part of the project.

## Feasibility probe (2026-04-18)

A small manual test was run on a single scanned scorebook page (2550×3300 px, 300dpi scan) before committing to API credits. Findings:

- **Whole-page input → unreliable.** Feeding the entire scorebook as one image yields low-confidence reads. The handwritten cell notations are too small relative to the overall frame for the vision encoder to discriminate symbols reliably.
- **Inning-column cropping → readable.** Cropping the image into vertical slices (one inning column at a time) dramatically improves character legibility. Notations recovered at high confidence included: `6-3`, `II K`, `III 3 //` (triple), `PB` (passed ball), `I 9-7`, `II 1-3`, plus the per-inning run-total dots at the bottom of each column.
- **Root cause of initial pessimism:** the feasibility was first assessed by viewing the image through a downscaled preview, which masked the true source resolution. The actual file retains enough detail for OCR once slices are cut.

### Implications for the pipeline

1. Accept uploads at scanner quality (≥300 DPI is realistic for amateur-team workflows).
2. Split each page into inning columns server-side (ImageMagick / `sharp`) before calling the model.
3. Issue one vision call per slice (~13–15 per page). Projected cost: **$0.5–1.5 per game**, well within the hackathon $500 credit envelope.
4. Reassemble the per-slice JSON into a page-level structured result; surface low-confidence cells for user review.

End-to-end API accuracy has not yet been measured — credit balance was $0 at the time of the probe. The next verification step is a single-image automated run against `data/samples/*.jpg` once credits are available.

## Design decisions from research (2026-04-18)

A deep-research pass informed several non-obvious architectural choices before any code was written against the API. Summarized here; see inline citations for primary sources.

### Two-stage pipeline, conditioned on scorebook school

Japanese amateur scorebooks follow one of several *schools* of notation — primarily **Waseda-shiki** (dominant in amateur ball, 95%+ of retail scorebooks, published by Seibido), **Keio-shiki** (used by NPB official scorers), **BFJ** (the 2020 Japan Baseball Federation standardization attempt), and regional variants like **Chiba-shiki**. The notations are not just stylistic — **symbols can mean opposite things across schools**: a diamond-enclosed mark is a sacrifice bunt in Waseda-shiki but an infield hit in Keio-shiki; `SO` means an immediate-out strikeout in Keio-shiki but in Hyogo's local variant it's the reverse.

The pipeline therefore runs in two stages:

1. **School detection** — a first vision call that extracts *only* the structural fingerprints that survive handwriting variation (orientation of the ball-count box, position of first base inside each cell, form of the at-bat result notation, the lineup-number glyph style).
2. **Cell extraction** — a second call using few-shot examples curated *for the detected school*.

Feeding the wrong school's prompt is worse than feeding no prompt.

### Visual fingerprints used for school detection

| Feature | Waseda family (incl. Seibido) | Keio family (incl. NPB, BFJ) |
|---|---|---|
| Diamond grid inside each cell | printed | absent |
| Ball-count box | left side, vertical | top side, horizontal |
| First base position inside cell | bottom-right | top-right |
| Ground-out notation | small `6-3` in bottom quarter | centered `6-3` / `II` fraction across whole cell |
| Lineup number glyph | circled ①②③ | lowercase a–i |
| Error marker | `E5` | defensive number with apostrophe (e.g. `6'`) |

These are all *printed*, not handwritten, so they survive keeper-specific handwriting variation.

### Claude Vision parameters (informed by published limits)

- **Model**: `claude-opus-4-7`. Sonnet / Haiku cap out at 1568 px on the long edge, which crushes per-cell detail on a dense 9×13 grid. Opus 4.7 allows 2576 px.
- **Image**: resize to 2560 px on the long edge, JPEG q92, `sharp.normalize()` for mild contrast. **Do not binarize or heavily grayscale** — vision models lose signal from the color/antialias channels that traditional OCR ignores.
- **Order**: image block first, text instruction second. Reversed order is documented as lower-accuracy.
- **`temperature: 0`** for deterministic extraction; `max_tokens: 16000` to cover an 81-cell grid at ~200 tokens each.

### JSON stability: Structured Outputs, not prefilling

The assistant-prefill pattern (seeding the reply with `{` to force JSON) has been **removed in Opus 4.6+** and now returns a 400. The replacement is **Structured Outputs** (`output_config.format` with a JSON Schema), GA since 2025-11-13, which grammar-constrains decoding and eliminates `JSON.parse` failures. The legacy escape hatch for old models is Tool Use with `tool_choice: { type: "tool", name: "..." }`.

### Rule-based validation catches model errors cheaply

Baseball has hard invariants the model doesn't always respect:

- Outs per inning must sum to **exactly 3** (except the last inning of a game that ends with fewer).
- The batting order is a fixed rotation — skipped or duplicated batters within an inning indicate a mis-read.
- Hit counts, put-outs, and assists on the game summary must reconcile with per-cell events.

Running these checks post-extraction and surfacing only the failing cells for a second vision call (on a cropped region of just that cell) is what chess-scoresheet OCR papers and a medical-note-AI-derived chess OCR project both report as the single largest accuracy lever — more than prompt tuning and more than preprocessing.

### Prompt caching makes per-game cost trivial

System prompt + school-specific few-shot examples are identical across every cell of every game. With `cache_control: { type: "ephemeral" }` applied to the static portion, cache hits on subsequent requests cut the billable input by ~90%. With caching, per-game OCR drops from roughly $0.50–$1.50 to $0.05–$0.15.

### What was *not* found in the research

- No public VLM benchmark specifically for Japanese handwritten sports scoresheets.
- No first-party Anthropic guidance on image-tile splits vs. single-image submission.
- No existing open-source baseball scorebook OCR project.

These are areas where we need to publish our own numbers.

## Stats calculation rules (2026-04-18 research)

Japanese amateur baseball statistics follow the same definitions as MLB, standardized in NPB's **Official Baseball Rules 9.00** (記録に関する規則). `pybaseball` / `sabr`-style AVG / OBP / SLG / ERA / WHIP formulas apply unchanged. Primary sources:

- NPB calculation method: https://npb.jp/scoring/calculation.html
- NPB Rules 9.00 (PDF): https://npb.jp/scoring/officialrule_900.pdf
- BFJ 2026 amateur internal regulations: https://baseballjapan.org/jpn/uploaded_data/bfj_news/doc/0964/2026AmateurBaseballInternalRegulations.pdf

### The OBP-drops-on-reaching-base gotcha

A handful of outcomes put the batter on base but *lower* their on-base percentage. This is correct per rule 9.05(b) / 9.02(a)(1) but surprises amateur users. The app will surface this with an inline tooltip linking to the relevant rule.

| Outcome | AB | Hit | AVG | OBP |
|---|---|---|---|---|
| Strikeout + reached on passed ball/wild pitch (振り逃げ出塁) | +1 | no | ↓ | **↓** |
| Fielder's choice (FC) | +1 | no | ↓ | ↓ |
| Reached on error | +1 | no | ↓ | ↓ |
| Sacrifice bunt with all safe on fielder's choice | 0 | no | — | — |
| Catcher's interference (打撃妨害) reaching 1B | 0 | no | — | — |
| Obstruction (走塁妨害) reaching 1B | 0 | no | — | — |

OBP formula: `(H + BB + HBP) / (AB + BB + HBP + SF)`. Sacrifice flies count in the denominator; sacrifice bunts do not.

### Required OCR fields for downstream stats

Per-plate-appearance fields the pipeline must surface to support full stats aggregation: `AB, H, 2B, 3B, HR, BB, HBP, SH, SF, SO, CatcherInterference, Obstruction, FC, E, strikeout-but-reached`.

### IP (innings pitched) notation

Japanese official scoring requires the "5回2/3" fractional form (rule 9.02(c)(1) 原注). One out = 1/3 inning. Internal storage uses integer outs to avoid floating-point drift; display renders as fractions.

## Preprocessing stack (decided, not yet installed)

All libraries are MIT or Apache-2.0 — safe for an MIT-licensed repo with possible future monetization.

| Library | Role | License |
|---|---|---|
| [sharp](https://github.com/lovell/sharp) | EXIF auto-orient, resize to 2576px long edge, JPEG q90 (mozjpeg) | Apache-2.0 |
| [jscanify](https://github.com/puffinsoft/jscanify) | Paper-quadrilateral detection + perspective unwarp | MIT |
| [@techstark/opencv-js](https://github.com/TechStark/opencv-js) | Homography fallback when jscanify misses (TypeScript-typed) | Apache-2.0 |
| [react-webcam](https://github.com/mozmorris/react-webcam) | PWA camera capture with live scanner overlay | MIT |
| [tesseract.js](https://github.com/naptha/tesseract.js) | OSD rotation probe as a secondary orientation signal | Apache-2.0 |

Explicitly excluded: `opencv4nodejs` (native bindings incompatible with Vercel / serverless / bun).

### Why EXIF normalization is not optional

Claude's vision documentation does not guarantee automatic EXIF orientation handling, and explicitly warns that "Claude may hallucinate or make mistakes when interpreting low-quality, *rotated*, or very small images." Every upload therefore passes through `sharp().autoOrient()` server-side before any other operation.

`sharp` alone handles affine transforms (2×2 matrix). The perspective correction needed for hand-held phone shots of a flat scorebook is a 3×3 homography, which requires OpenCV.js — hence the jscanify / @techstark split.

### Resize target

Opus 4.7's vision encoder processes up to 2576 px on the long edge (≈4784 tokens per image). Sonnet and Haiku cap at 1568 px, which crushes dense-grid detail. Upscaling past 2576 wastes money without improving accuracy, so we resize *down* to 2576 before upload.

Estimated API cost at this size: roughly $0.02 per scoresheet page on a single extraction call, before prompt caching. With cached system + few-shot prefix, subsequent calls are ~90% cheaper.

## Few-shot sample sourcing

NPB and Seibido do not publish downloadable example PDFs, and NPB's terms explicitly forbid reuse of their images. The legally-safe options are:

1. **Self-scanned**: purchase a Seibido 9104 scorebook (¥1,080, A4, 30 games) and fill it with fabricated names and play sequences, then scan at 300 DPI. This is the highest-fidelity route for matching real user uploads.
2. **Synthetic**: generate blank-grid SVG + composite Waseda-shiki symbols with `sharp` or `node-canvas`. Zero legal risk, but doesn't capture handwriting drift / paper tone / ink variation.
3. **Hybrid**: ~80% synthetic + ~20% self-scanned. Keeps marginal cost low while retaining in-distribution realism.

The notation system itself (idea / scoring convention) is not copyrightable under Japanese law, but a specific printed layout may qualify as a compiled work. Self-generating the grid from SVG sidesteps this entirely.

## Development

All development runs in **GitHub Codespaces** — see [docs/codespace-setup.md](./docs/codespace-setup.md). The devcontainer installs bun + dependencies automatically; scorebook images go into `data/samples/` (gitignored — real scorebooks contain player names).

## License

MIT
