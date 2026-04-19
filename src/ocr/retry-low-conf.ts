/**
 * 低信頼セル再読みオーケストレーション。
 *
 * docs/architecture.md §5.4 / §20.6 準拠。
 *
 * - 入力: 初回マージ後の Grid<CellRead> + 元画像（landscape 正規化済み） + InningCropResult.meta
 * - 処理:
 *     1) confidence < threshold のセルを抽出
 *     2) 各セルの pixel bounds を grid geometry（イニング列 / batterCount）から推定
 *     3) セル単独 crop → 上 upscale（最小 400px 長辺）
 *     4) single-cell retry prompt で callClaude
 *     5) 応答を Zod CellReadSchema で parse、上書きは confidence 高い方
 *     6) retry 後も低信頼なら flagForReview=true
 *
 * Day 2 で opencv-based セル bbox 校正に入れ替え予定（§20.2）。
 */

import sharp from "sharp";

import {
  callClaude,
  type ClaudeCallOptions,
  type ClaudeDryRunResult,
  type UsageStats,
} from "./client.js";
import {
  buildSingleCellRetryUserText,
  SINGLE_CELL_RETRY_SYSTEM_PROMPT,
  SINGLE_CELL_RETRY_TOOL_NAME,
} from "./prompts/single-cell-retry.js";
import { CellReadSchema } from "./schemas.js";
import { READ_SINGLE_CELL_TOOL } from "./tools.js";
import { runWithConcurrency } from "./stage2-extract-cells.js";
import type { Grid } from "../types/grid.js";
import type { CellRead } from "../types/cell.js";
import type { Rect } from "../types/layout.js";

/** single-cell retry 時の画像最小長辺 px（cell 単独なので大きめが望ましい） */
export const SINGLE_CELL_MIN_LONG_EDGE = 400;
/** retry 対象にする confidence 閾値（§5.4） */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
/** retry 後もこの値未満なら人間レビュー対象 */
export const POST_RETRY_REVIEW_THRESHOLD = 0.7;
/** 単発 single-cell retry の既定同時実行数 */
export const DEFAULT_RETRY_CONCURRENCY = 3;

export type RetryReport = {
  grid: Grid<CellRead>;
  retried: Array<{
    coord: { batting_order: number; inning: number };
    before: CellRead;
    after: CellRead;
    upgraded: boolean;
  }>;
  reviewFlags: Array<{ batting_order: number; inning: number; confidence: number }>;
  totalUsage: UsageStats;
};

export type RetryOptions = ClaudeCallOptions & {
  concurrency?: number;
  lowConfidenceThreshold?: number;
  postRetryReviewThreshold?: number;
  minLongEdge?: number;
};

/**
 * @param grid 初回 OCR 結果
 * @param source normalized landscape 画像（crop の元）
 * @param inningsRects InningCropResult.meta.rects.innings
 * @param batterCount 打順数（Layout.batterCount と一致）
 */
export async function retryLowConfCells(
  grid: Grid<CellRead>,
  source: Buffer,
  inningsRects: Rect[],
  batterCount: number,
  options: RetryOptions = {},
): Promise<RetryReport | ClaudeDryRunResult[]> {
  const threshold = options.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const reviewThreshold =
    options.postRetryReviewThreshold ?? POST_RETRY_REVIEW_THRESHOLD;
  const concurrency = options.concurrency ?? DEFAULT_RETRY_CONCURRENCY;
  const minLongEdge = options.minLongEdge ?? SINGLE_CELL_MIN_LONG_EDGE;

  const targets = collectTargets(grid, threshold);

  if (targets.length === 0) {
    return {
      grid,
      retried: [],
      reviewFlags: [],
      totalUsage: zeroUsage(),
    };
  }

  const results = await runWithConcurrency(targets, concurrency, async (t) => {
    const rect = computeCellRect(inningsRects, t.inning - 1, t.batting_order - 1, batterCount);
    const cellBuf = await sharp(source)
      .extract({
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      })
      .toBuffer();
    const upscaled = await upscaleToMin(cellBuf, minLongEdge);

    const res = await callClaude<unknown>(
      {
        system: SINGLE_CELL_RETRY_SYSTEM_PROMPT,
        userImage: {
          base64: upscaled.toString("base64"),
          mediaType: "image/jpeg",
        },
        userText: buildSingleCellRetryUserText({
          batting_order: t.batting_order,
          inning: t.inning,
          priorReading: {
            raw_notation: t.before.raw_notation,
            outcome: t.before.outcome,
            confidence: t.before.confidence,
          },
        }),
        tools: [READ_SINGLE_CELL_TOOL],
        toolName: SINGLE_CELL_RETRY_TOOL_NAME,
        maxTokens: 1024,
      },
      options,
    );
    if ("dryRun" in res) return { dryRun: true as const, payload: res.payload };

    // Claude から返る CellRead の batting_order / inning は caller 提供値で上書き保証
    const parsed = CellReadSchema.parse({
      ...(res.toolInput as object),
      batting_order: t.batting_order,
      inning: t.inning,
    });
    return { parsed, usage: res.usage };
  });

  // dryRun が混ざる場合は既存 grid を返す型不可。呼び出し側仕様: dryRun 時は payload 群を返却
  if (results.some((r) => "dryRun" in r)) {
    return results.filter((r): r is ClaudeDryRunResult => "dryRun" in r);
  }

  const retried: RetryReport["retried"] = [];
  const totalUsage = zeroUsage();
  const newGrid = grid.map((row) => row.slice());
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    const r = results[k] as { parsed: CellRead; usage: UsageStats };
    accumulateUsage(totalUsage, r.usage);
    const bi = t.batting_order - 1;
    const ii = t.inning - 1;
    const before = t.before;
    // >= で tie の場合は retry 結果を採用（alternatives 等が最新で有用なため）
    const after = r.parsed.confidence >= before.confidence ? r.parsed : before;
    newGrid[bi][ii] = after;
    retried.push({
      coord: { batting_order: t.batting_order, inning: t.inning },
      before,
      after,
      upgraded: after !== before,
    });
  }

  const reviewFlags = retried
    .filter((r) => r.after.confidence < reviewThreshold)
    .map((r) => ({
      batting_order: r.coord.batting_order,
      inning: r.coord.inning,
      confidence: r.after.confidence,
    }));

  return { grid: newGrid, retried, reviewFlags, totalUsage };
}

// ── helpers ───────────────────────────────────────────────

type RetryTarget = {
  batting_order: number;
  inning: number;
  before: CellRead;
};

function collectTargets(
  grid: Grid<CellRead>,
  threshold: number,
): RetryTarget[] {
  const out: RetryTarget[] = [];
  for (let bi = 0; bi < grid.length; bi++) {
    for (let ii = 0; ii < grid[bi].length; ii++) {
      const cell = grid[bi][ii];
      if (cell != null && cell.confidence < threshold) {
        out.push({
          batting_order: cell.batting_order,
          inning: cell.inning,
          before: cell,
        });
      }
    }
  }
  return out;
}

export function computeCellRect(
  inningsRects: Rect[],
  inningIndex: number,
  batterIndex: number,
  batterCount: number,
): Rect {
  if (inningIndex < 0 || inningIndex >= inningsRects.length) {
    throw new Error(
      `computeCellRect: inningIndex ${inningIndex} out of range (0..${inningsRects.length - 1})`,
    );
  }
  if (batterIndex < 0 || batterIndex >= batterCount) {
    throw new Error(
      `computeCellRect: batterIndex ${batterIndex} out of range (0..${batterCount - 1})`,
    );
  }
  const col = inningsRects[inningIndex];
  const cellHeight = Math.floor(col.height / batterCount);
  const y = col.y + batterIndex * cellHeight;
  // 最下段のみ残りピクセルを吸収
  const h =
    batterIndex === batterCount - 1
      ? col.height - batterIndex * cellHeight
      : cellHeight;
  return {
    x: col.x,
    y,
    width: col.width,
    height: h,
  };
}

async function upscaleToMin(buf: Buffer, minEdge: number): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  if (meta.width == null || meta.height == null) {
    throw new Error("upscaleToMin: missing dimensions");
  }
  const longEdge = Math.max(meta.width, meta.height);
  if (longEdge >= minEdge) {
    return sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  }
  const scale = minEdge / longEdge;
  return sharp(buf)
    .resize({
      width: Math.round(meta.width * scale),
      height: Math.round(meta.height * scale),
      kernel: sharp.kernel.cubic,
    })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

function zeroUsage(): UsageStats {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function accumulateUsage(acc: UsageStats, add: UsageStats): void {
  acc.input_tokens += add.input_tokens;
  acc.output_tokens += add.output_tokens;
  acc.cache_creation_input_tokens += add.cache_creation_input_tokens;
  acc.cache_read_input_tokens += add.cache_read_input_tokens;
}
