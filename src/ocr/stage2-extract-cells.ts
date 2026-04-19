/**
 * Stage 2: 1 イニング列 × N の OCR orchestration。
 *
 * docs/architecture.md §5.2 / §20.6 準拠。
 *
 * - 入力: cropInnings() の innings[] と style
 * - 処理:
 *     1) 各列を native（例 161×1051）から 400×~2600 程度へ upscale（Opus 最小 200px 規定 §20.2）
 *     2) 流派に応じたプロンプトを選択（waseda / keio / chiba）
 *     3) callClaude(extract_column_cells tool)
 *     4) Stage2ColumnResponseSchema.parse
 *     5) 同時実行数制限付きで並列化（既定 3、Opus 4.7 RPM 節約）
 *
 * Stage 1 fallback: style="unknown" は呼び出し側で waseda に変換済み想定
 * （§20.5）。本関数は unknown を waseda として扱う。
 */

import sharp from "sharp";

import {
  callClaude,
  type ClaudeCallOptions,
  type ClaudeDryRunResult,
  type UsageStats,
} from "./client.js";
import type { Style } from "../types/style.js";
import {
  buildChibaUserText,
  CHIBA_EXTRACT_COLUMN_TOOL_NAME,
  CHIBA_SYSTEM_PROMPT,
} from "./prompts/chiba-system.js";
import {
  buildKeioUserText,
  KEIO_EXTRACT_COLUMN_TOOL_NAME,
  KEIO_SYSTEM_PROMPT,
} from "./prompts/keio-system.js";
import {
  buildWasedaSystemPrompt,
  buildWasedaUserText,
  EXTRACT_COLUMN_TOOL_NAME,
} from "./prompts/waseda-system.js";
import {
  Stage2ColumnResponseSchema,
  type Stage2ColumnResponseParsed,
} from "./schemas.js";
import { EXTRACT_COLUMN_CELLS_TOOL } from "./tools.js";

/** Opus 4.7 最小画像長辺（§20.2）。これ未満だとエラー or 低精度。 */
export const MIN_COLUMN_LONG_EDGE = 300;

/** Stage 2 の既定同時実行数（Opus 4.7 RPM 節約 + 13 列を 5 分以内に収めるバランス） */
export const DEFAULT_STAGE2_CONCURRENCY = 3;

/**
 * Stage 2 1 列あたりの既定 max_tokens。
 *
 * docs/architecture.md §3.2 / §5.2 準拠で 16000 に設定。
 * 11 打者 × ({各 CellRead の bare fields ~200 tok} + {evidence 文 + alternatives}) を
 * 安全に収められる余裕。4096 では `stop_reason:"max_tokens"` で tool_use block が
 * truncated → Zod parse 失敗 → 実費無駄のリスクが高いため、既定を 16000 に引き上げる。
 */
export const DEFAULT_STAGE2_MAX_TOKENS = 16000;

export type Stage2Input = {
  /** イニング番号（1-based） */
  inning: number;
  /** cropInnings() の innings[i] buffer */
  columnImage: Buffer;
};

export type Stage2ColumnResult = {
  inning: number;
  response: Stage2ColumnResponseParsed;
  usage: UsageStats;
  latencyMs: number;
  attempts: number;
};

export type Stage2ExtractOptions = ClaudeCallOptions & {
  /** Stage 2 の同時実行数（既定 3） */
  concurrency?: number;
  /** 列画像の最小長辺 px（既定 300、Opus 4.7 最小規定） */
  minLongEdge?: number;
  /**
   * max_tokens。既定は DEFAULT_STAGE2_MAX_TOKENS (16000)。
   * docs/architecture.md §3.2 / §5.2 で 11 打者 × evidence + alternatives の出力を
   * 安全に収める値として規定。4096 では途中切断のリスクがある。
   */
  maxTokens?: number;
};

/**
 * N イニング列を Stage 2 で並列 OCR。
 * style="unknown" は waseda として扱う（Day 1 fallback）。
 */
export async function extractStage2Columns(
  columns: Stage2Input[],
  style: Style,
  batterCount: number,
  options: Stage2ExtractOptions = {},
): Promise<Stage2ColumnResult[] | ClaudeDryRunResult[]> {
  const concurrency = options.concurrency ?? DEFAULT_STAGE2_CONCURRENCY;
  const minLongEdge = options.minLongEdge ?? MIN_COLUMN_LONG_EDGE;
  const effectiveStyle: Style = style === "unknown" ? "waseda" : style;
  const systemPrompt = selectSystemPrompt(effectiveStyle);
  const buildUserText = selectUserTextBuilder(effectiveStyle);
  const toolName = selectToolName(effectiveStyle);

  const raw = await runWithConcurrency<
    Stage2Input,
    Stage2ColumnResult | ClaudeDryRunResult
  >(columns, concurrency, async (col) => {
    const upscaled = await upscaleColumn(col.columnImage, minLongEdge);
    const result = await callClaude<unknown>(
      {
        system: systemPrompt,
        userImage: {
          base64: upscaled.toString("base64"),
          mediaType: "image/jpeg",
        },
        userText: buildUserText({ inning: col.inning, batterCount }),
        tools: [EXTRACT_COLUMN_CELLS_TOOL],
        toolName,
        maxTokens: options.maxTokens ?? DEFAULT_STAGE2_MAX_TOKENS,
      },
      options,
    );
    if ("dryRun" in result) {
      return result;
    }
    const parsed = Stage2ColumnResponseSchema.parse(result.toolInput);
    return {
      inning: col.inning,
      response: parsed,
      usage: result.usage,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    } satisfies Stage2ColumnResult;
  });

  // dryRun フラグは全 call に一律適用される前提 → 結果は homogeneous
  if (raw.length > 0 && "dryRun" in raw[0]) {
    return raw as ClaudeDryRunResult[];
  }
  return raw as Stage2ColumnResult[];
}

export async function upscaleColumn(
  columnImage: Buffer,
  minLongEdge: number,
): Promise<Buffer> {
  const meta = await sharp(columnImage).metadata();
  if (meta.width == null || meta.height == null) {
    throw new Error("extractStage2Columns: column image metadata missing");
  }
  const longEdge = Math.max(meta.width, meta.height);
  if (longEdge >= minLongEdge) {
    // 既に十分な解像度なら JPEG 再エンコードのみ
    return sharp(columnImage).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  const scale = minLongEdge / longEdge;
  const targetW = Math.round(meta.width * scale);
  const targetH = Math.round(meta.height * scale);
  return sharp(columnImage)
    .resize({
      width: targetW,
      height: targetH,
      // 線形補間で文字エッジを滑らかに（bicubic 代替）
      kernel: sharp.kernel.cubic,
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

// ── helpers ───────────────────────────────────────────────

function selectSystemPrompt(style: Style): string {
  switch (style) {
    case "waseda":
    case "unknown":
      return buildWasedaSystemPrompt();
    case "keio":
      return KEIO_SYSTEM_PROMPT;
    case "chiba":
      return CHIBA_SYSTEM_PROMPT;
  }
}

function selectUserTextBuilder(
  style: Style,
): (p: { inning: number; batterCount: number }) => string {
  switch (style) {
    case "waseda":
    case "unknown":
      return buildWasedaUserText;
    case "keio":
      return buildKeioUserText;
    case "chiba":
      return buildChibaUserText;
  }
}

function selectToolName(style: Style): string {
  // 3 流派とも同じ tool 名を使う（schema 共通）が、const としては prompt モジュールに紐付く
  switch (style) {
    case "waseda":
    case "unknown":
      return EXTRACT_COLUMN_TOOL_NAME;
    case "keio":
      return KEIO_EXTRACT_COLUMN_TOOL_NAME;
    case "chiba":
      return CHIBA_EXTRACT_COLUMN_TOOL_NAME;
  }
}

/**
 * 簡易 concurrency limiter。p-limit 等の外部依存を避けるため自前実装。
 * 入力配列の順序を保って結果配列を返す。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runOne(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}
