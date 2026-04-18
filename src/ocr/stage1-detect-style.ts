/**
 * Stage 1: スコアブック流派判別の orchestration。
 *
 * docs/architecture.md §5.1 / §20.5 準拠。
 *
 * - 入力: 正規化済み画像（long edge 2576px 前提）
 * - 内部処理:
 *     1) 768px ダウンスケール（$0.002 程度に節約）
 *     2) callClaude(detect_style tool)
 *     3) StyleDetectionSchema.parse
 *     4) Day 1 fallback: unknown / confidence<0.5 → waseda に切替（warning 付）
 * - 出力: StyleDetectionResult（adjusted 値 + 元の raw 値も保持）
 */

import sharp from "sharp";

import {
  callClaude,
  type ClaudeCallOptions,
  type ClaudeDryRunResult,
  type UsageStats,
} from "./client.js";
import {
  STYLE_DETECT_SYSTEM_PROMPT,
  STYLE_DETECT_TOOL_NAME,
  STYLE_DETECT_USER_TEXT,
} from "./prompts/style-detect.js";
import {
  StyleDetectionSchema,
  type StyleDetectionSchemaOutput,
} from "./schemas.js";
import { DETECT_STYLE_TOOL } from "./tools.js";

/** Stage 1 で画像を送る長辺 px（cost-optimized） */
export const STYLE_DETECT_LONG_EDGE = 768;

/** Day 1 fallback 閾値（これ未満 or "unknown" なら waseda を採用） */
export const STYLE_CONFIDENCE_FLOOR = 0.5;

export type StyleDetectionResult = {
  /** Day 1 fallback 適用後の流派（アプリが実際に使う値） */
  style: StyleDetectionSchemaOutput["style"];
  /** 最終 confidence（fallback 時は元の値のまま） */
  confidence: number;
  /** Claude が返した生の判定 */
  raw: StyleDetectionSchemaOutput;
  /** fallback が適用されたか（warning を UI に出す） */
  fallbackApplied: boolean;
  /** ダウンスケール後の画像サイズ */
  detectedFromSize: { width: number; height: number };
  usage: UsageStats;
  latencyMs: number;
  attempts: number;
};

export type DetectStyleOptions = ClaudeCallOptions & {
  /** ダウンスケール後の長辺 px（既定 768） */
  detectLongEdge?: number;
  /** fallback を無効化したい場合（Day 2 の UI モーダル優先時） */
  disableFallback?: boolean;
};

/**
 * スコアブック全体像を流派分類する。dryRun 時は ClaudeDryRunResult を透過して返す。
 */
export async function detectStyle(
  normalizedImage: Buffer,
  options: DetectStyleOptions = {},
): Promise<StyleDetectionResult | ClaudeDryRunResult> {
  const longEdge = options.detectLongEdge ?? STYLE_DETECT_LONG_EDGE;

  const downscaled = await sharp(normalizedImage)
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  const meta = await sharp(downscaled).metadata();

  const result = await callClaude<unknown>(
    {
      system: STYLE_DETECT_SYSTEM_PROMPT,
      userImage: {
        base64: downscaled.toString("base64"),
        mediaType: "image/jpeg",
      },
      userText: STYLE_DETECT_USER_TEXT,
      tools: [DETECT_STYLE_TOOL],
      toolName: STYLE_DETECT_TOOL_NAME,
      maxTokens: 1024,
    },
    options,
  );

  if ("dryRun" in result) return result;

  const parsed = StyleDetectionSchema.parse(result.toolInput);

  let style = parsed.style;
  let fallbackApplied = false;
  if (
    !options.disableFallback &&
    (parsed.style === "unknown" || parsed.confidence < STYLE_CONFIDENCE_FLOOR)
  ) {
    style = "waseda";
    fallbackApplied = true;
  }

  return {
    style,
    confidence: parsed.confidence,
    raw: parsed,
    fallbackApplied,
    detectedFromSize: {
      width: meta.width ?? longEdge,
      height: meta.height ?? longEdge,
    },
    usage: result.usage,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
  };
}
