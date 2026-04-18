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

## Development

All development runs in **GitHub Codespaces** — see [docs/codespace-setup.md](./docs/codespace-setup.md). The devcontainer installs bun + dependencies automatically; scorebook images go into `data/samples/` (gitignored — real scorebooks contain player names).

## License

MIT
