# baseball-scorebook-ocr

Read amateur Japanese baseball scorebook photos into structured at-bat data, with the OCR step done interactively inside a Claude Code session — no external API call required.

The original scope (April 2026 hackathon) was a full PWA with realtime sync. In May 2026 the focus narrowed to **OCR + local storage** based on user feedback. The pre-processing, schema, and CSV exporter from that earlier work remain; the OCR step now uses Claude Code's vision interactively via a skill.

## How to use

In a Claude Code session:

```
/scorebook 241201_1
```

The skill (source: `claude-skill/scorebook.md` in this repo, install location: `~/.claude/commands/scorebook.md`) does the following:

1. SSHes into the storage host (Raspberry Pi 5 in our setup), runs `scripts/hough-snap-prior.cjs` on the named image to crop the page into 13 inning columns, downloads them to a local temp directory.
2. For each inning column, Claude reads the PNG with its built-in vision and emits a markdown table of cells (batter × outcome × confidence + notes). Low-confidence cells are flagged with `⚠️` and two candidate readings.
3. You confirm each inning with `OK` or correct individual cells with free-text edits ("batter 3 is III F2"). The table re-renders with corrections applied.
4. Once all 13 innings are confirmed, the rows are written into a local SQLite database (`data/scorebook.smoke.db`) and exported to wide-format / long-format CSV.
5. Local temp files are deleted.

No external API call is made in this flow. Cost is $0 in addition to an existing Claude Code subscription.

### Sample output (inning 1)

```
## inning 1 (game 241201_1)
| batter | raw    | outcome                            | conf | note            |
|--------|--------|------------------------------------|------|-----------------|
| 1      | IK     | strikeout (逆K = swinging)          | 0.92 | 1st out         |
| 2      | IIF4   | fly_out F4 (二飛)                  | 0.85 | 2nd out         |
| 3      | III2   | ⚠️ ground_out P2 OR fly_out F2     | 0.72 | 3rd out, F unclear |
| 4-10   | (blank diamond) | -                          | 1.0  | not yet up      |
```

## What works (verified on real game scans)

- **Outs sequence**: Roman numerals `I` / `II` / `III` for 1st / 2nd / 3rd out of inning are read reliably.
- **Basic outcomes**: `K` (strikeout), `F` + position (`F8` = center fly, `F4` = fly to 2B), digit-digit (`6-3`, `4-3` = ground-out routes), single-digit ground-out (`2` = catcher, `1` = pitcher), `犠` (sac bunt), `nE` (error), `DB` (double play).
- **Empty cells**: blank diamonds for batters past the 3rd out are recognized at confidence 1.0 — no spurious notation is written.
- **Layout generality**: calibration ratios (`playerColRatio: 0.196`, `rightStatsRatio: 0.812`) for the Seibido 9104 Waseda template have been verified on two different game photos, so a single calibration covers a template — not just one image.

## What is harder

- **Dense innings**: cells containing stolen bases, double plays, and consecutive substitutions in one at-bat slot are read, but per-symbol confidence drops. Expect to manually confirm 30-50% of cells in a busy game.
- **Decorative glyphs**: Greek-letter-shaped marks (`ν`, `ℓ`) and kanji decorations (`行`, `正`) are captured as raw notation, but their semantic meaning is keeper-dependent.
- **Backwards-K vs forward-K**: distinguishing 空振り三振 (swinging) vs 見逃し三振 (looking) on small handwriting is unreliable; both are reported as `strikeout` with the orientation noted in `evidence`.
- **Inning 13 right edge**: the rightmost column on a 13-inning grid sometimes loses a few pixels of notation. Tracked as a calibration tweak (`rightStatsRatio` 0.812 → 0.85 candidate).
- **Handwriting variance across photos**: a clean sheet gives ~0.7 average legibility; a busy or messy sheet drops to ~0.45. The review step is essential, not optional.

## What is out of scope

- **Tilt / perspective correction.** The pipeline assumes near-orthogonal scans.
- **Other notation schools.** Stub prompt files exist for Keio / BFJ / Chiba but have not been verified end-to-end.
- **Player-name OCR.** The first column (player names) is currently not read; a placeholder display name is written for each batter slot.
- **Continuous capture from a phone camera.** Input is a still photo at scanner-or-equivalent resolution.

## Pre-processing pipeline

`scripts/hough-snap-prior.cjs` (runs on the storage host, requires `@techstark/opencv-js`):

1. Auto-rotate (EXIF), resize to 2576 px on the long edge.
2. Compute a fixed N-equal-spaced prior for the 14 inning column boundaries using Seibido Waseda layout ratios.
3. Run Canny + `cv.HoughLinesP` on the grid region; classify near-vertical lines.
4. For each prior boundary, search ±25% of the inning width for a Hough peak; snap if found, fall back to the prior if not.
5. Write 13 PNG inning columns plus an `inning_boundaries.json` audit file.

Snap-to-prior gives complete coverage even when half the printed grid lines fail Canny. Typical snap rate on verified samples: 3 / 14 to 6 / 14 boundaries snap, the rest fall back to prior, max delta 13-28 px.

## Storage

`data/migrations/0001_init.sql` defines a five-table SQLite schema:

| Table | Purpose |
|---|---|
| `games` | One row per scorebook image. `image_sha256` is `UNIQUE` so re-ingesting the same photo is idempotent. |
| `players` | Per-game lineup snapshot, `UNIQUE(game_id, batting_order)`. |
| `cells` | One row per (game, batter, inning). `outcome` is a CHECK enum, `extras_json` / `alternatives_json` carry structured side data, `confidence < 0.7` is indexed for review queues. |
| `ocr_runs` | One row per OCR session (skill mode = one row per `/scorebook` invocation). |
| `crop_jobs` | Pre-processing audit: which calibration method produced which inning boundaries. |

`scripts/export-csv.sh data/scorebook.smoke.db data/exports` writes both `at_bats_long.csv` (one row per cell) and `at_bats_wide.csv` (batters × innings, raw notation only).

## Notation reference (Seibido Waseda)

| Mark | Meaning |
|---|---|
| `I` / `II` / `III` | 1st / 2nd / 3rd out of inning (Roman numeral prefix) |
| `K` | strikeout |
| Mirrored K (逆K) | swinging strikeout |
| Right-side-up K (正K) | looking strikeout |
| `F` + digit | flyout to that fielder position (F8 = CF, F4 = 2B fly) |
| digit-digit | ground out, fielding sequence (6-3 = SS to 1B) |
| single digit | ground out captured by that position (2 = catcher, 1 = pitcher) |
| `犠` | sacrifice bunt |
| `犠飛` | sacrifice fly |
| `nE` | error by fielder n |
| `DB` / `db` | double play |
| `(n)` / `○n` | runner annotation, position n |
| filled diamond | scored |
| partial-shaded diamond | reached the shaded base |

## Setup notes

- Runtime: Node 20+ for the pre-processing scripts.
- Storage host: any machine with `sqlite3`, `ssh`, and disk for game data. Tested on Raspberry Pi 5 over Tailscale.
- Claude Code: copy `claude-skill/scorebook.md` from this repo into `~/.claude/commands/scorebook.md` on the workstation that runs Claude Code.

## Historical note: API-based implementation

The April 2026 hackathon submission used `@anthropic-ai/sdk` to call Claude Opus 4.7 directly for OCR, with a Stage 1 (school detection) + Stage 2 (cell extraction) + retry pipeline under `src/ocr/`. That code is still in the tree and works (one full game costs roughly $0.55 using Claude Sonnet 4.6, $3.80 with Claude Opus 4.7), but is no longer the recommended path — the interactive skill flow is faster, cheaper, and produces the same data quality. The API code path is kept as a reference for headless batch operation; see `scripts/stage2-one-column.ts` and `experiments/ocr-baseline/` for the entry points.

## License

MIT.
