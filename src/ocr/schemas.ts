/**
 * Zod スキーマ集。
 *
 * docs/architecture.md §5.1 (Stage 1) / §5.2 (Stage 2) の Tool schema と対応し、
 * ランタイム検証と JSON Schema 生成（tools.ts）の双方の単一ソースとする。
 *
 * TS 型定義（src/types/*.ts）は型推論でもスキーマ由来でも良いが、ここでは
 * 既存型と整合するよう手書きしている。型ずれ防止のため、
 * `z.infer<typeof CellReadSchema>` と `CellRead` は tests で equivalence を検証する。
 */

import { z } from "zod";

// ── Stage 1: 流派判別 ────────────────────────────────────────

export const StyleSchema = z.enum(["waseda", "keio", "chiba", "unknown"]);

export const StyleEvidenceSchema = z.object({
  diamond_guide_lines: z.enum(["present", "absent"]),
  ball_count_box: z.enum(["left_vertical", "top_horizontal"]),
  first_base_position: z.enum(["bottom_right", "top_right"]),
  groundout_position: z.enum(["bottom_right_small", "center_fraction"]),
  error_symbol: z.enum(["E_prefix", "prime_superscript"]),
  batting_order_style: z.enum(["circled_digits", "lowercase_latin"]),
});

export const StyleDetectionSchema = z.object({
  style: StyleSchema,
  evidence: StyleEvidenceSchema,
  confidence: z.number().min(0).max(1),
});

export type StyleDetectionSchemaInput = z.input<typeof StyleDetectionSchema>;
export type StyleDetectionSchemaOutput = z.output<typeof StyleDetectionSchema>;

// ── Stage 2: セル読み取り ────────────────────────────────────

export const OutcomeSchema = z.enum([
  "single",
  "double",
  "triple",
  "home_run",
  "walk",
  "hbp",
  "strikeout_swinging",
  "strikeout_looking",
  "sac_bunt",
  "sac_fly",
  "fielders_choice",
  "error",
  "ground_out",
  "fly_out",
  "line_out",
  "pop_out",
  "interference",
  "unknown",
]);

export const PitchCountSchema = z.object({
  balls: z.number().int().min(0).max(4),
  strikes: z.number().int().min(0).max(3),
});

export const CellExtrasSchema = z.object({
  SH: z.boolean(),
  SF: z.boolean(),
  HBP: z.boolean(),
  FC: z.boolean(),
  error_fielder: z.number().int().min(1).max(9).nullable(),
  stolen_bases: z.array(z.number().int().min(1).max(4)),
  passed_ball: z.boolean(),
  wild_pitch: z.boolean(),
  interference: z.enum(["batter", "runner"]).nullable(),
  strikeout_reached: z.boolean(),
});

export const CellReadSchema = z.object({
  batting_order: z.number().int().min(1).max(11),
  inning: z.number().int().min(1).max(15),
  raw_notation: z.string().nullable(),
  outcome: OutcomeSchema.nullable(),
  fielders_involved: z.array(z.number().int().min(1).max(9)).nullable(),
  reached_base: z
    .union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ])
    .nullable(),
  out_count_after: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .nullable(),
  pitch_count: PitchCountSchema.nullable(),
  extras: CellExtrasSchema,
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.string()),
});

/**
 * Stage 2 の 1 イニング列呼び出しが返す構造。
 * イニング分の複数セル（通常 9〜11 個、空セル含む）と列メタを持つ。
 */
export const Stage2ColumnResponseSchema = z.object({
  inning: z.number().int().min(1).max(15),
  cells: z.array(CellReadSchema),
  column_quality: z
    .object({
      legibility: z.number().min(0).max(1),
      issues: z.array(z.string()),
    })
    .optional(),
});

/** single-cell retry 時の 1 セル単独応答（inning/batting_order は呼び出し側で注入）。 */
export const SingleCellRetryResponseSchema = CellReadSchema;

// 型エクスポート（z.infer）
export type CellReadParsed = z.output<typeof CellReadSchema>;
export type Stage2ColumnResponseParsed = z.output<
  typeof Stage2ColumnResponseSchema
>;

// ── 整合性検証ヘルパ ─────────────────────────────────────────

/**
 * Architecture §6.1 の一部を field-level で先行検証:
 * - confidence < 0.7 のとき alternatives.length >= 2
 * - outcome が out 系（*_out / strikeout_* / sac_*）のとき reached_base === 0
 * - outcome が hit 系（single/double/triple/home_run）のとき reached_base は塁数と整合
 */
export function validateCellConsistency(cell: CellReadParsed): string[] {
  const issues: string[] = [];
  if (cell.confidence < 0.7 && cell.alternatives.length < 2) {
    issues.push(
      `confidence ${cell.confidence.toFixed(2)} < 0.7 but alternatives has only ${cell.alternatives.length} entries (need ≥ 2)`,
    );
  }
  const outOutcomes = new Set([
    "strikeout_swinging",
    "strikeout_looking",
    "ground_out",
    "fly_out",
    "line_out",
    "pop_out",
  ]);
  if (
    cell.outcome &&
    outOutcomes.has(cell.outcome) &&
    !cell.extras.strikeout_reached &&
    cell.reached_base !== 0 &&
    cell.reached_base !== null
  ) {
    issues.push(
      `outcome=${cell.outcome} but reached_base=${cell.reached_base} (expected 0)`,
    );
  }
  const hitBase: Partial<Record<string, number>> = {
    single: 1,
    double: 2,
    triple: 3,
    home_run: 4,
  };
  if (cell.outcome && hitBase[cell.outcome] != null) {
    const expected = hitBase[cell.outcome]!;
    if (cell.reached_base !== null && cell.reached_base < expected) {
      issues.push(
        `outcome=${cell.outcome} but reached_base=${cell.reached_base} < ${expected}`,
      );
    }
  }
  return issues;
}
