/**
 * スコアブック OCR の E2E オーケストレーション。
 *
 * docs/architecture.md §1（全体像）§13 Phase E / §15（受け入れ条件）準拠。
 *
 * 実 API に直接当たる唯一のエントリポイント。`.scorebook-test-approved`
 * ゲートと block-scorebook-api-call hook は別レイヤで守る（CLI 側で確認）。
 *
 * 流れ:
 *   1. normalize (+ forceRotate for portrait Seibido 9104)
 *   2. assessQuality（warning 生成、fail でも continue）
 *   3. cropInnings（8 領域分割）
 *   4. detectStyle（Stage 1）
 *   5. extractStage2Columns（Stage 2、各イニング列）
 *   6. mergeStage2Results → Grid
 *   7. retryLowConfCells（必要なら）
 *   8. validateGrid（ルール検査）
 *   9. 打者別 BattingStats 集計
 *
 * DRY_RUN=1 のときは 4〜7 は callClaude が payload を返すので、
 * pipeline 全体としては「実装パス確認用ダンプ」を返す。
 */

import { readFileSync } from "node:fs";

import { normalize, type NormalizeOptions } from "./preprocess/normalize.js";
import { assessQuality } from "./preprocess/quality.js";
import { cropInnings } from "./preprocess/crop-innings.js";
import { detectStyle } from "./ocr/stage1-detect-style.js";
import { extractStage2Columns } from "./ocr/stage2-extract-cells.js";
import { mergeStage2Results } from "./ocr/merge.js";
import {
  LOW_CONFIDENCE_THRESHOLD,
  retryLowConfCells,
} from "./ocr/retry-low-conf.js";
import { validateGrid } from "./ocr/validate.js";
import {
  aggregateBattingFromCells,
  computeBattingRates,
} from "./stats/compute.js";
import type { BattingRates, BattingStats } from "./types/stats.js";
import type {
  InningCropResult,
  ScorebookLayout,
} from "./types/layout.js";
import { SEIBIDO_9104_WASEDA } from "./types/layout.js";
import type { ValidationReport } from "./types/validation.js";
import type { CellRead } from "./types/cell.js";
import type { Grid } from "./types/grid.js";
import type { QualityReport } from "./types/quality.js";
import type {
  ClaudeCallOptions,
  ClaudeDryRunResult,
  UsageStats,
} from "./ocr/client.js";
import type {
  Stage2ColumnResult,
  Stage2ExtractOptions,
} from "./ocr/stage2-extract-cells.js";
import type { Style } from "./types/style.js";

// Opus 4.7 公式料金（USD / Mtok）
const PRICE_INPUT_PER_MTOK = 15;
const PRICE_OUTPUT_PER_MTOK = 75;
const PRICE_CACHE_WRITE_PER_MTOK = 18.75; // 1.25x
const PRICE_CACHE_READ_PER_MTOK = 1.5; // 0.1x

export type PipelineInput = {
  /** 画像 Buffer を渡すか、ファイルパスを指定 */
  image: Buffer | string;
  layout?: ScorebookLayout;
  batterCount?: number;
  /** 画像向き補正（Seibido 9104 のように保存 portrait / 内容 landscape は 90） */
  forceRotate?: NormalizeOptions["forceRotate"];
  /** 強制流派（指定なしなら Stage 1 自動判別） */
  forcedStyle?: Style;
  /** stage2 同時実行数（既定は stage2 のデフォルト 3） */
  stage2Concurrency?: number;
  /** low-conf retry threshold（既定 0.5） */
  lowConfidenceThreshold?: number;
  /** 既定は環境変数 DRY_RUN=1 で自動 true */
  dryRun?: boolean;
};

export type PipelinePhase =
  | "normalize"
  | "quality"
  | "crop"
  | "stage1"
  | "stage2"
  | "merge"
  | "retry"
  | "validate"
  | "stats";

export type PlayerLine = {
  batting_order: number;
  cells: CellRead[];
  stats: BattingStats;
  rates: BattingRates;
};

export type PipelineCostEstimate = {
  totalUsdCents: number;
  breakdown: {
    inputUsdCents: number;
    outputUsdCents: number;
    cacheWriteUsdCents: number;
    cacheReadUsdCents: number;
  };
  totalUsage: UsageStats;
};

export type PipelineResult = {
  grid: Grid<CellRead>;
  validation: ValidationReport;
  style: Style;
  styleFallbackApplied: boolean;
  players: PlayerLine[];
  cropMeta: InningCropResult["meta"];
  quality: QualityReport;
  warnings: string[];
  reviewFlags: Array<{
    batting_order: number;
    inning: number;
    confidence: number;
  }>;
  costEstimate: PipelineCostEstimate;
  phaseTimingsMs: Record<PipelinePhase, number>;
  /** Stage 1 / 2 / retry の attempts 合計 */
  apiAttempts: number;
};

export type PipelineDryRun = {
  dryRun: true;
  /** Stage 1 + Stage 2（列ごと）+ retry（セルごと）の payload を集約 */
  payloads: ClaudeDryRunResult["payload"][];
  normalizedSize: { width: number; height: number };
  cropMeta: InningCropResult["meta"];
  quality: QualityReport;
};

export async function runPipeline(
  input: PipelineInput,
  callOptions: ClaudeCallOptions = {},
): Promise<PipelineResult | PipelineDryRun> {
  const buf = typeof input.image === "string"
    ? readFileSync(input.image)
    : input.image;
  const layout = input.layout ?? SEIBIDO_9104_WASEDA;
  const batterCount = input.batterCount ?? layout.batterCount;
  const dryRun =
    input.dryRun ?? (process.env.DRY_RUN === "1" || callOptions.dryRun === true);
  const callOpts: ClaudeCallOptions = { ...callOptions, dryRun };

  const phaseTimings: Record<PipelinePhase, number> = {
    normalize: 0,
    quality: 0,
    crop: 0,
    stage1: 0,
    stage2: 0,
    merge: 0,
    retry: 0,
    validate: 0,
    stats: 0,
  };
  const warnings: string[] = [];
  const dryRunPayloads: ClaudeDryRunResult["payload"][] = [];

  // ── 1. normalize ───────────────────────────────────
  const t1 = Date.now();
  const normalized = await normalize(buf, {
    forceRotate: input.forceRotate,
  });
  phaseTimings.normalize = Date.now() - t1;
  const landscapeBuf = Buffer.from(normalized.base64, "base64");

  // ── 2. quality ──────────────────────────────────────
  const t2 = Date.now();
  const quality = await assessQuality(landscapeBuf);
  phaseTimings.quality = Date.now() - t2;
  if (!quality.ok) {
    warnings.push(
      `quality issues detected: ${quality.issues.join(", ")} (pipeline continues but accuracy may drop)`,
    );
  }

  // ── 3. crop ─────────────────────────────────────────
  const t3 = Date.now();
  const crop = await cropInnings(landscapeBuf, {
    layout: { ...layout, batterCount },
  });
  phaseTimings.crop = Date.now() - t3;

  // ── 4. stage1 ───────────────────────────────────────
  const t4 = Date.now();
  let style: Style;
  let styleFallbackApplied = false;
  let stage1Attempts = 0;
  const totalUsage: UsageStats = zeroUsage();

  if (input.forcedStyle) {
    style = input.forcedStyle;
  } else {
    const s1 = await detectStyle(landscapeBuf, callOpts);
    if ("dryRun" in s1) {
      dryRunPayloads.push(s1.payload);
      style = "waseda"; // fallback for dryRun continuation
    } else {
      style = s1.style;
      styleFallbackApplied = s1.fallbackApplied;
      accumulateUsage(totalUsage, s1.usage);
      stage1Attempts += s1.attempts;
      if (s1.fallbackApplied) {
        warnings.push(
          `style fallback applied (raw=${s1.raw.style}, conf=${s1.confidence.toFixed(2)} → using waseda)`,
        );
      }
    }
  }
  phaseTimings.stage1 = Date.now() - t4;

  // ── 5. stage2 ───────────────────────────────────────
  const t5 = Date.now();
  const stage2Options: Stage2ExtractOptions = {
    ...callOpts,
    concurrency: input.stage2Concurrency,
  };
  const stage2 = await extractStage2Columns(
    crop.innings.map((columnImage, i) => ({
      inning: i + 1,
      columnImage,
    })),
    style,
    batterCount,
    stage2Options,
  );
  phaseTimings.stage2 = Date.now() - t5;

  const stage2Success: Stage2ColumnResult[] = [];
  let stage2Attempts = 0;
  for (const r of stage2) {
    if ("dryRun" in r) {
      dryRunPayloads.push(r.payload);
    } else {
      stage2Success.push(r);
      accumulateUsage(totalUsage, r.usage);
      stage2Attempts += r.attempts;
    }
  }

  // DRY_RUN の場合はここで終了（pipeline の残り phase は実結果前提）
  if (dryRun) {
    return {
      dryRun: true,
      payloads: dryRunPayloads,
      normalizedSize: normalized.sentSize,
      cropMeta: crop.meta,
      quality,
    } satisfies PipelineDryRun;
  }

  // ── 6. merge ────────────────────────────────────────
  const t6 = Date.now();
  const merged = mergeStage2Results(stage2Success, {
    batterCount,
    inningCount: layout.inningCount,
  });
  phaseTimings.merge = Date.now() - t6;
  if (merged.droppedCells.length > 0) {
    warnings.push(
      `merge dropped ${merged.droppedCells.length} out-of-bounds cells`,
    );
  }
  if (merged.conflicts.length > 0) {
    warnings.push(
      `merge resolved ${merged.conflicts.length} conflicts (higher confidence kept)`,
    );
  }

  // ── 7. retry low-conf ───────────────────────────────
  const t7 = Date.now();
  let finalGrid = merged.grid;
  let reviewFlags: PipelineResult["reviewFlags"] = [];
  let retryAttempts = 0;
  const lowThreshold = input.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;

  const anyLowConf = merged.confidenceHist.low > 0;
  if (anyLowConf) {
    const retryRes = await retryLowConfCells(
      merged.grid,
      landscapeBuf,
      crop.meta.rects.innings,
      batterCount,
      {
        ...callOpts,
        lowConfidenceThreshold: lowThreshold,
      },
    );
    if (Array.isArray(retryRes)) {
      // dryRun path（実際には dryRun 判定で既に早期 return しているので通常到達しない）
      for (const r of retryRes) dryRunPayloads.push(r.payload);
    } else {
      finalGrid = retryRes.grid;
      reviewFlags = retryRes.reviewFlags;
      accumulateUsage(totalUsage, retryRes.totalUsage);
      retryAttempts = retryRes.retried.reduce(
        (s, _) => s + 1,
        0,
      );
    }
  }
  phaseTimings.retry = Date.now() - t7;

  // ── 8. validate ─────────────────────────────────────
  const t8 = Date.now();
  const validation = validateGrid(finalGrid);
  phaseTimings.validate = Date.now() - t8;

  // ── 9. stats ────────────────────────────────────────
  const t9 = Date.now();
  const players = buildPlayerLines(finalGrid, batterCount);
  phaseTimings.stats = Date.now() - t9;

  return {
    grid: finalGrid,
    validation,
    style,
    styleFallbackApplied,
    players,
    cropMeta: crop.meta,
    quality,
    warnings,
    reviewFlags,
    costEstimate: estimateCost(totalUsage),
    phaseTimingsMs: phaseTimings,
    apiAttempts: stage1Attempts + stage2Attempts + retryAttempts,
  };
}

// ── helpers ───────────────────────────────────────────────

function buildPlayerLines(
  grid: Grid<CellRead>,
  batterCount: number,
): PlayerLine[] {
  const out: PlayerLine[] = [];
  for (let bi = 0; bi < batterCount; bi++) {
    const row = grid[bi];
    if (!row) continue;
    const cells = row.filter((c): c is CellRead => c != null);
    const stats = aggregateBattingFromCells(cells);
    out.push({
      batting_order: bi + 1,
      cells,
      stats,
      rates: computeBattingRates(stats),
    });
  }
  return out;
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

export function estimateCost(usage: UsageStats): PipelineCostEstimate {
  const input = (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK;
  const output = (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  const cacheWrite =
    (usage.cache_creation_input_tokens / 1_000_000) *
    PRICE_CACHE_WRITE_PER_MTOK;
  const cacheRead =
    (usage.cache_read_input_tokens / 1_000_000) * PRICE_CACHE_READ_PER_MTOK;
  const total = input + output + cacheWrite + cacheRead;
  const toCents = (x: number): number => Math.round(x * 100_00) / 100; // USD → 0.01 cent precision
  return {
    totalUsdCents: toCents(total),
    breakdown: {
      inputUsdCents: toCents(input),
      outputUsdCents: toCents(output),
      cacheWriteUsdCents: toCents(cacheWrite),
      cacheReadUsdCents: toCents(cacheRead),
    },
    totalUsage: usage,
  };
}
