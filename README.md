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

## Development

All development runs in **GitHub Codespaces** — see [docs/codespace-setup.md](./docs/codespace-setup.md). The devcontainer installs bun + dependencies automatically; scorebook images go into `data/samples/` (gitignored — real scorebooks contain player names).

## License

MIT
