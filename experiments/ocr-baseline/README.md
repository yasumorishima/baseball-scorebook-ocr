# OCR Baseline Experiment

Goal: **how accurately can Claude Opus 4.7 read a Japanese amateur-baseball scorebook from a single photo?**

This is the riskiest part of the project. If accuracy is production-ready (≥90%), the app becomes "snap a photo → stats appear." If it's in the 60–80% range, we pivot to "magic autofill with review." Below 60% and we de-emphasize this entry path.

## How to run

```bash
# 1. Drop scorebook images (jpg/jpeg/png) into ../data/samples/
# 2. Set your Anthropic API key:
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Install deps (first time only):
bun install      # or: npm install

# 4. Run the OCR probe on a single image:
bun run ocr:test -- ../../data/samples/your-photo.jpg
```

Output is written to `./output/<image-name>.json` and a human-readable `./output/<image-name>.md`.

## Prompt strategy

Seeded from [`docs/scorebook-notation.md`](../../docs/scorebook-notation.md). We pass:

1. The full notation reference as a system prompt.
2. An instruction to emit **per-cell confidence scores** (0–1).
3. A request to describe the **grid position** (inning × batting order) for each extracted event.
4. A fallback of `null` for blank cells — **no hallucinated guesses**.

## Evaluation

For each sample image we'll track:

| Metric | Target |
|--------|--------|
| Cells read | 100% attempted |
| High-confidence (≥0.8) accuracy | ≥95% |
| Overall cell accuracy | ≥70% |
| Hallucinated non-null on blank cells | 0 |

A human-compiled ground truth (`./ground-truth/<image-name>.json`) will be compared against the model output.

## Status

- [ ] First image processed
- [ ] Ground truth labeled
- [ ] Accuracy numbers recorded
- [ ] Prompt iteration round 1 complete
