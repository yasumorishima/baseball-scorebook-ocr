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

Pre-hackathon implementation phase **complete**; awaiting user approval for the first real-API verification run.

- [x] **Pre-work complete** (2026-04-19). Sample page analyzed for layout ratios, scorebook school detection strategy chosen, notation fewshot drafted, API parameters locked to Opus 4.7 published limits, cost envelope calculated.
- [x] **Architecture document** — [docs/architecture.md](./docs/architecture.md), 1,100+ lines covering the full pipeline (preprocessing → school detection → cell extraction → rule-based validation → NPB 9.00 stats → event-sourced DB → RLS-protected multi-tenant sync → capture UX). Single source of truth; revisions go there first, code follows.
- [x] **Fewshot examples** — [src/ocr/prompts/waseda-fewshot.ts](./src/ocr/prompts/waseda-fewshot.ts), 7 text-based Waseda-shiki notations with explicit schemas (`I3` / `II6-3` / `IIIK` / `B` / `F8` / `犠` / `1B`). Image-based fewshot is deferred to Day 2 after OpenCV cell-boundary calibration.
- [x] **Layout ratios measured** — 6-iteration visual calibration on a real 2550×3300 scan (Seibido 9104 Waseda). Confirmed portrait file → landscape content (needs 90° rotate), 1 team per page, 9–11 variable batter rows, 13-inning grid. Full ratios in `docs/architecture.md` §20.2.
- [x] **Phase A — foundation** (22 tests). `src/types/` (image / quality / layout / cell / grid / validation / stats / event, aligned to the Supabase schema in §8) + `src/preprocess/normalize.ts` (EXIF auto-orient + 2576px resize + mozjpeg q90), `quality.ts` (3×3 Laplacian variance + mean luma, Dynamsoft thresholds), `crop-innings.ts` (8-region split using verified v2 ratios).
- [x] **Phase B — prompts + schemas** (26 tests). `src/ocr/schemas.ts` (Zod for Style / Cell / Stage2Column / SingleCellRetry + consistency checks) + `src/ocr/tools.ts` (Anthropic Tool definitions for `detect_style` / `extract_column_cells` / `read_single_cell`) + prompt files for Waseda (primary), Keio + Chiba (stubs for Day 2), and the low-confidence cell re-read pass. Strict enum parity between Zod and the JSON schemas shipped to the API is test-covered.
- [x] **Phase C — client + orchestration** (70 tests). `src/ocr/client.ts` is a thin wrapper over `@anthropic-ai/sdk` that attaches `cache_control: ephemeral` to the system block, forces `tool_choice: { type: "tool", name }`, retries 5xx / 429 responses up to 3× with exponential backoff + jitter, structured-logs each phase, and short-circuits when `DRY_RUN=1`. On top sit Stage 1 (style detection with a 768px downscale and Day-1 Waseda fallback when confidence < 0.5), Stage 2 (per-inning column OCR with style-dispatched prompts and a default concurrency cap of 3), merge (Grid reconstruction with higher-confidence-wins conflict resolution), retry-low-conf (individual cell re-reads for confidence < 0.5, review-flag threshold 0.7), and validate (4 of the 8 §6.1 rule checks: outs-per-inning, batting-order continuity, reached-base / outcome mismatch, mid-inning empty-cell warning — the remaining 4 are annotated as Day 2).
- [x] **Phase D — stats (NPB 9.00)** (52 tests). `src/stats/innings.ts` stores IP as an integer `outs` count and formats as `5 回 2/3` (JA) / `5 2/3` (EN) / `5.2` (decimal) per rule 9.02(c)(1). `compute.ts` aggregates `BattingStats` from `CellRead[]` following NPB `AB / H / 2B / 3B / HR / BB / HBP / SH / SF / SO / Int / Ob / FC / ROE / strikeoutReached / R`, with `extras` flags taking precedence over outcome to prevent double-counting when the model emits both. Rates `AVG / OBP / SLG / OPS / BABIP` (batting) and `ERA / WHIP / K9 / BB9 / KBB` (pitching) are computed with zero-division guards. `anomalies.ts` classifies the six OBP-paradox cases from §7.4 with tooltip text for the UI.
- [x] **Phase E — integration** (5 end-to-end tests). `src/pipeline.ts` chains all nine phases (normalize → quality → crop → Stage 1 → Stage 2 → merge → retry → validate → stats) and returns either a `PipelineResult` with `costEstimate` (Opus 4.7 token pricing) or a `PipelineDryRun` payload dump when `DRY_RUN=1`. The CLI at `experiments/ocr-baseline/run-pipeline.ts` checks the `.scorebook-test-approved` gate file, verifies `ANTHROPIC_API_KEY`, and writes a `.md` + `.json` report for each run.
- [x] **261 tests pass** on the GitHub Codespace (`bun run test`), typecheck is clean (`bun run typecheck`), and `DRY_RUN=1 bun run pipeline` on a sample image completes with the expected 14 planned Claude calls and zero API cost.
- [x] **Sub-agent review (first pass)** — A second Opus 4.7 instance reviewed phases A–E. Blocker count: 0. Two majors were surfaced and fixed in the same session: the `event.ts` `GameEventType` enum now matches the Supabase `game_events` schema (`plate_appearance / substitution / correction / inning_end / game_end` with a `correctionOf` envelope field), and `compute.ts` now treats an explicit `extras.SH / SF / HBP` flag as authoritative over the `outcome` branch so a Claude response combining e.g. `outcome=ground_out` with `extras.SH=true` no longer double-counts the plate appearance. Regression tests were added.
- [x] **Post-review hardening pass** (2026-04-19, 10 Majors + impactful Minors). A second round of parallel Opus reviews ran across preprocess / OCR / stats+pipeline layers before the real-API verification and surfaced ten Majors, all fixed in `fix/post-review-hardening` (merged as `15635a7`, `8973de2`, `1ced2b0`). The headline safety fixes: **Stage 2 `max_tokens` default raised 4096 → 16000** (architecture §3.2/§5.2) so an 11-batter column with evidence text cannot truncate the `tool_use` block and waste a real API spend; **the `.scorebook-test-approved` gate is now parsed and validated by the CLI itself**, not just the shell hook — `UNLOCK_UNTIL` is required as an ISO datetime, `REASON` as a non-empty string, and an expired `UNLOCK_UNTIL` fails closed with `exit 2`, so the gate holds even in a Codespace shell without hooks installed; and **`validate.ts` now emits `extras_outcome_conflict` / `sacrifice_batter_scored` warnings** when the model violates the Single-representation rule (`sac_bunt` + `extras.SH=true`, `walk` + `extras.HBP=true`, etc.) while `compute.ts` continues to aggregate correctly via the existing extras-precedence early returns. Additional fixes: `Math.max(1, ...)` clamp on `crop-innings.ts` rects (no sharp throw on tiny test inputs), a full **Zod ↔ JSON Schema structural parity test** covering required keys / nullable / min-max / items / `additionalProperties` (so a field added to one side but not the other fails loudly), a partial-`dryRun` invariant assertion in `retry-low-conf.ts`, an `empty_cell_in_progress` guard for innings that already recorded 3 outs or are beyond `lastPlayedInning`, cross-platform `pathToFileURL` entry-point detection in the CLI (the naive `new URL('file://' + resolve(...))` form produced `file://C:/...` on Windows vs Node's `file:///C:/...` and silently never ran `main()`), price constants now link to architecture §9, and EXIF Orientation=8 / =3 coverage in `normalize.test.ts`. The full diff adds **+833 insertions across 17 files** and lifts the test suite from 175 → 219.
- [x] **Sub-agent re-review** — Three Opus instances re-audited preprocess / OCR / stats+pipeline after the hardening pass. Blocker: 0. Major: 0 (one cross-platform regression in the entry-point guard was caught mid-review and fixed in the same branch before merging to `main`). Remaining minors are nice-to-haves deferred to Day 2.
- [x] **Day 2 pre-work (2026-04-19 evening, API-free)** — Filled three Day 2 prerequisites while the real-API verification decision is still pending. (1) **Keio / Chiba prompts promoted from stubs to production builders** (`5354b92` + `c64ab8c`, 27 tests added). `keio-fewshot.ts` now carries eight keio-specific examples — `BB` walk, `SO` for swinging strikeout, the keio-only `K` for *dropped-third-strike REACHED* (the single exception where `outcome=strikeout_swinging` and `extras.strikeout_reached=true` legitimately coexist), `O`+base for stolen bases, and the ◇-boxed-fielder = infield-hit convention that is the direct inverse of waseda's sacrifice-bunt reading. `chiba-fewshot.ts` carries three examples under an explicit "Day-1 stub + waseda fallback + low-confidence on chiba-specific marks" policy. `buildKeioSystemPrompt(fewshot)` / `buildChibaSystemPrompt(fewshot)` mirror `buildWasedaSystemPrompt` so `stage2-extract-cells::selectSystemPrompt` dispatches all three schools through the same builder path. The `WasedaFewshotExample` type now carries an optional `alternatives?: string[]` field so any example with `confidence < 0.7` can demonstrate the ≥2-alternatives invariant the Zod schema enforces (previously the chiba unknown example would have taught the model to omit it — caught by sub-agent review and fixed before merge). (2) **`validate.ts` rule #4 `diamond_reached_base_mismatch`** (`be1c790` + `4dd1ff3`, 12 tests added). `reached_base = 4` (scored) is only legal when one of four things holds: `outcome === "home_run"`, a subsequent at-bat exists in the same inning, `extras.stolen_bases.includes(4)` (stolen home specifically — 2B/3B alone can't score without later events), or `extras.wild_pitch` / `passed_ball` / `error_fielder` is set. Anything else is warned as a likely diamond-shading mis-read. This lifts `validate.ts` coverage from 6/8 to **7/8 of the §6.1 rules** — the remaining three (`runs_total_mismatch`, `pitcher_totals_mismatch`, `at_bats_mismatch`) need totals-row / pitcher-log OCR and are Day 2 work. Both sub-agent reviews flagged the initial `stolen_bases.length > 0` guard as too loose — tightened to `.includes(4)` with a regression test. (3) **`@techstark/opencv-js` Hough line detector** (`feat/hough-calibrate` branch, HEAD `1655bc5`, **not yet merged to main**). `src/preprocess/hough-calibrate.ts` exposes `getOpenCV()` as a lazy WASM singleton, `detectGridLines()` (sharp downscale → grayscale → Canny → `HoughLinesP` with angle-based horizontal / vertical classification and Mat memory hygiene via try/finally `delete()`), and `clusterVerticalBoundaries()` (line-length-weighted non-maxima suppression that picks N column-boundary x coordinates). 12 synthetic-grid tests cover the WASM singleton, expected line counts, the `maxLongEdge` downscale + coord-restoration round-trip, cluster peak accuracy within 24 px, and noise suppression. The module is intentionally decoupled from `cropInnings` — it becomes the Day 2 calibration step for camera-shot inputs where the static Seibido ratios don't fit due to perspective or rotation. The branch is parked off `main` because WASM initialization is slow enough that `bunx vitest` exceeded a 180-second ceiling on the Codespace in this session; the next session will run the file in isolation with a raised timeout and decide between merging, adding a `skipIf(!process.env.RUN_WASM_TESTS)` gate, or refactoring to a `beforeAll` warmup. **Test count lifted 219 → 261 on main; +12 further tests live on the Hough branch pending verification.**
- [ ] **First real API run — awaiting user authorization.** Cost model (architecture.md §16.2) puts the uncached first page at ~\$2.15 against a remaining balance of \$4.09 — about \$0.10 above the self-imposed "≤ 50% of remaining credit" gate in §15. Options on the table: proceed and accept the minor overshoot, warm the prompt cache with a single-column call first, or wait for the \$500 hackathon credit on 2026-04-21. The `.scorebook-test-approved` file has **not** been created.

### Safety rails

To prevent wasted API spend, three PreToolUse hooks are active in the parent Claude Code harness:

- `scorebook-preamble.sh` — injects the full accumulated research (schools, ratios, published Opus limits, cost estimates) into every conversation turn that mentions scorebook OCR, so the assistant cannot re-derive stale assumptions.
- `block-scorebook-api-call.sh` — refuses `bun run ocr:test` and similar commands unless a repo-local `.scorebook-test-approved` file exists with both `UNLOCK_UNTIL=<ISO datetime>` and `REASON=<string>`. The file is gitignored by default and must be recreated per test session.
- `block-local-node-run.sh` — refuses any local `bun` / `tsx` / `node <script>` / `npm run` / `vitest` invocation. All execution runs in the project's GitHub Codespace (`gh codespace ssh -c <name> -- 'bash -lc "<cmd>"'`). The local development machine (Celeron N4500) does not support `bun` and is explicitly a scaffolding workstation, not a test host.

These hooks compensate for a prior incident (2026-04-18) where a full-page OCR test was run before the cropping pipeline existed, burning ~$0.91 of a $5 manual top-up on a code path already documented as non-viable. The hook layer makes that mistake mechanically unreachable.

See [experiments/ocr-baseline/](./experiments/ocr-baseline/) for the initial accuracy probe artifacts.

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

## Competitive position

Japanese amateur baseball has roughly 4.7–5 million active players across 310,000 teams. The top scoring app ([スコアラー](https://apps.apple.com/jp/app/id1522649930)) holds a 4.5★ / 774-review position on the Japanese App Store. **No existing app in this market offers handwritten scorebook OCR.** The スコアラー developer publicly acknowledged in an August 2025 App Store reply that handwritten lineup-sheet OCR was "technically difficult with low feasibility" — the same class of problem this project is attempting to solve with Opus 4.7 Vision.

Other gaps that existing apps leave open:

- Multi-device concurrent entry with offline reconciliation
- Keio-shiki (NPB-style) scorekeeping support (every Japanese app is Waseda-shiki-only)
- MLB-style earned run accounting (every app hard-codes NPB rules)
- Alumni-era aggregated stats (current + OB player career totals)
- League-specific PDF report exports
- Per-at-bat video linkage in a Japanese-first UI

## Server-side architecture

Scorebook data is inherently an append-only event stream — each plate appearance is one event, corrections are recorded as new events referencing the original rather than in-place edits. This maps cleanly to a CQRS-style design and sidesteps the merge complexity that chat/document apps need.

### Stack

| Layer | Choice | License | Why |
|---|---|---|---|
| PWA framework | [@serwist/next v9.5+](https://github.com/serwist/serwist) | MIT | `next-pwa` has had no release since 2022 ([issue #508](https://github.com/shadowwalker/next-pwa/issues/508)); Serwist ships Next.js 15 / App Router / Turbopack / Bun support |
| Client-side DB | [Dexie.js](https://github.com/dexie/Dexie.js) | Apache-2.0 | Compound indexes + 735k weekly downloads; lighter than CRDT libraries |
| Realtime protocol | Supabase [Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast) | — | Officially recommended over Postgres Changes for scale |
| Conflict strategy | Append-only events + UUID v7 idempotency key + `(game_id, seq)` UNIQUE | — | CRDT (Automerge/Yjs) is overkill for an event log; UNIQUE-constraint OCC is sufficient |

`@supabase/supabase-js` does **not** ship offline write queuing for the web ([discussion #40664](https://github.com/orgs/supabase/discussions/40664)). Offline sync is implemented in-app.

### Dual-layer sync queue

- **Service Worker** (Serwist `BackgroundSyncQueue`): intercepts failing `POST /rest/v1/game_events` requests, replays them with exponential backoff for up to 24 h on Chromium.
- **App layer** (Dexie `pending_events` table): mirrors every write locally before it hits the network. Exposes a "unsynced" count to the UI and replays on `online` / app launch. This also covers Safari, where Background Sync is not yet implemented.

### Conflict shape

The server's `game_events` table declares `UNIQUE (game_id, seq)`. When two devices both append at `seq = 42`, the second insert returns Postgres error `23505`, the offending client re-reads the latest seq for that game, renumbers, and retries. UUID v7 primary keys make the insert itself idempotent — dedicated retries via the SW never double-insert.

### Postgres schema (draft)

```sql
create table games (
  id uuid primary key default gen_random_uuid(),
  team_home text not null, team_away text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  version bigint not null default 0
);

create table game_events (
  id            uuid primary key,              -- client-generated UUID v7 (idempotency)
  game_id       uuid not null references games(id) on delete cascade,
  seq           bigint not null,               -- monotonic within a game
  event_type    text not null,                 -- at_bat | run | substitution | correction
  payload       jsonb not null,
  correction_of uuid references game_events(id),
  client_id     text not null,
  occurred_at   timestamptz not null,
  recorded_at   timestamptz not null default now(),
  unique (game_id, seq)
);
create index on game_events (game_id, seq);
```

## Team access control

Teams have four roles — `owner` / `admin` / `scorer` / `viewer` — matching the real division of work in an amateur club (representative, manager, recorder, supporters). Invitations are short alphanumeric codes that can be read out loud on LINE or at a practice.

### Invitation codes

```ts
import { customAlphabet } from "nanoid";
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const inviteCode = customAlphabet(alphabet, 8);
// 57^8 ≈ 1.1e14 combinations; 0/O/1/I/l/L excluded to avoid voice-transcription confusion
```

Six-digit numeric codes are explicitly rejected — the space is small enough to enumerate. Codes carry a default 7-day expiry and 30-use cap. Supabase itself exposes only `inviteUserByEmail`; code-based invites are implemented in-app per [discussion #6055](https://github.com/supabase/supabase/discussions/6055).

### RLS performance

Official Supabase benchmarks ([discussion #14576](https://github.com/orgs/supabase/discussions/14576), [RLS-Performance repo](https://github.com/GaryAustin1/RLS-Performance)) show two orders of magnitude difference depending on policy shape:

- `auth.uid()` inline → wrap as `(select auth.uid())`: **179 ms → 9 ms** on a realistic dataset.
- Direct `team_members` join in a policy → move into `SECURITY DEFINER stable` function returning `setof uuid`, compare with `IN`: **>2 min → 2 ms**.
- Every policy declares `TO authenticated` to skip evaluation for anonymous requests.
- `team_members(user_id)` and `team_members(team_id)` carry btree indexes.

### Redemption RPC

Rather than letting the client SELECT from `invitations` directly (which would expose the code column to enumeration), redemption runs through a `SECURITY DEFINER` function that validates the code, checks rate limits on the per-user `invitation_attempts` table, inserts the row into `team_members`, and increments `use_count` — all in a single transaction. The client only calls `supabase.rpc('redeem_invitation', { p_code })`.

### Middleware

Next.js App Router middleware calls `supabase.auth.getClaims()` rather than `getSession()`, because `getSession()` trusts unverified cookie data. `getClaims()` performs the JWT signature check. Long-running sessions without refresh are rejected at the edge.

### Pitfalls to avoid (Supabase official docs)

- Using `user_metadata` for authorization (client-editable — use `app_metadata` or a DB table instead).
- PG14 views bypassing RLS of their underlying tables (use `WITH (security_invoker = true)` on PG15+).
- An UPDATE policy without a matching SELECT policy — the UPDATE has to read the existing row first.
- Ever shipping the `service_role` key to the client; that key bypasses RLS entirely.

## Capture UX

OCR accuracy is bounded by input quality. The capture UI follows a three-state model modeled after Adobe Scan:

1. **Searching** — camera feed is live but no quadrilateral has stabilized. Neutral overlay, subtitle *Looking for document*.
2. **Hold steady** — `jscanify` has reported four corners with drift under `CORNER_MOVE_PX` for `STABLE_FRAMES` consecutive frames and blur/luma checks pass. Accented overlay, auto-capture fires after the stability window.
3. **Manual fallback** — if auto-capture hasn't fired after a fixed timeout, surface a manual shutter so the user can force a shot. Avoids dead-ends on difficult lighting.

### Thresholds (seeded from Dynamsoft Document Scanner defaults)

```ts
const STABLE_FRAMES = 12;      // frames of corner-stability before auto-capture
const CORNER_MOVE_PX = 20;     // max drift between consecutive frames
const BLUR_VAR_MIN = 100;      // OpenCV Laplacian variance minimum
const DARK_LUMA_MAX = 80;      // mean luma (0-255) below which we warn "too dark"
```

Blur is detected via OpenCV.js `cv.Laplacian` + `cv.meanStdDev` — the squared standard deviation of the Laplacian image is a standard sharpness proxy ([Dynamsoft code pool](https://www.dynamsoft.com/codepool/quality-evaluation-of-scanned-document-images.html)). Auto-capture only fires when **all four conditions AND together**: corner stability, blur OK, luma OK, quadrilateral plausible.

### iOS Safari gotchas

- Use `facingMode: { ideal: 'environment' }`, never `{ exact: 'environment' }` — the `exact` form fails on iOS through the 16.4 range ([WebKit Bug 252560](https://bugs.webkit.org/show_bug.cgi?id=252560)).
- iPhone 15 Pro's Wide / Ultra-wide / Tele cameras are not cleanly enumerable via `navigator.mediaDevices.enumerateDevices()` in WebRTC contexts (Apple Developer Forum thread 776460). Accept the default and let the user tap-to-switch if needed.
- In installed PWAs, hook `video.onended` — Safari may end the stream when the app is backgrounded and needs explicit reacquire on resume.

### Library choices

| Library | Role | License | Size (approx.) | Why |
|---|---|---|---|---|
| [jscanify v1.4.2](https://github.com/puffinsoft/jscanify) | Quadrilateral detection & perspective unwarp | MIT | 3.7 MB + OpenCV.js (~8.7 MB) | ~1.7k stars, active, exposes `findPaperContour` / `getCornerPoints` / `extractPaper` directly |
| [OpenCV.js](https://github.com/opencv/opencv) | `cv.Laplacian` + `cv.meanStdDev` for blur scoring | Apache-2.0 | ~8-9 MB | Already loaded as a jscanify dependency |
| [cropperjs v2](https://github.com/fengyuanchen/cropperjs) | Post-capture manual crop / adjust | MIT | tens of KB | 13.4k stars, active through 2026-04 |
| [react-webcam](https://github.com/mozmorris/react-webcam) | `getUserMedia` + canvas bridge | MIT | ~10 KB | Minimal, stable |

Explicitly rejected:

- **Dynamsoft Document Scanner SDK** — commercially licensed, overkill for this scope.
- **TensorFlow.js-based detectors** — bundle size and startup cost not justified when classical CV (Hough + corner refinement via OpenCV.js) does the job.

## Priority order for the 2-day build

1. **OCR MVP**: jscanify preprocessing → Opus 4.7 Vision POST → parsed JSON. Day 1 spike; Day 2 prompt tuning and per-cell review UI.
2. **Capture UX**: Adobe-Scan three-state model with the thresholds above. OCR accuracy follows from clean input, so this comes *before* any server work.
3. **Offline event log**: @serwist/next + Dexie pending queue + Supabase `game_events` with `UNIQUE(game_id, seq)` and `ON CONFLICT (id) DO NOTHING`. Background sync on Chromium; app-layer flush on Safari.
4. **Team RLS**: nanoid 8-char invites, SECURITY DEFINER `user_team_ids` / `has_team_role` helpers, `(select auth.uid())` wrapping, `redeem_invitation` RPC with per-user rate limit.
5. **Realtime broadcast**: `realtime.broadcast_changes()` trigger on `game_events`; clients subscribe to `channel('game:'+gameId)` and merge into Dexie. Broadcast rather than Postgres Changes for scale.

Explicit non-goals for this build: CRDTs, PowerSync/ElectricSQL/RxDB, PDF league-report export, OB alumni lineage aggregation, Serializable transactions anywhere except the final game-close step.

## Development

All development runs in **GitHub Codespaces** — see [docs/codespace-setup.md](./docs/codespace-setup.md). The devcontainer installs bun + dependencies automatically; scorebook images go into `data/samples/` (gitignored — real scorebooks contain player names).

### Research archive

The architectural decisions in this README are distilled from three deep-research passes on scorebook notation schools, Japanese amateur baseball stats rules, Claude Vision prompt engineering, PWA offline sync, Supabase RLS, competitive landscape, and capture UX. The full PDFs are kept at `docs/research/` (gitignored, local-only). The decisions and their primary-source citations are summarised above; the PDFs are reference material if a decision needs to be revisited.

## License

MIT
