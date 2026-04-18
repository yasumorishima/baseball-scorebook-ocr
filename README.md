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

## Development

All development runs in **GitHub Codespaces** — see [docs/codespace-setup.md](./docs/codespace-setup.md). The devcontainer installs bun + dependencies automatically; scorebook images go into `data/samples/` (gitignored — real scorebooks contain player names).

## License

MIT
