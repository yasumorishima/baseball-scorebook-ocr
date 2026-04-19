/**
 * Anthropic Claude Tool 定義集（tool_use による JSON 強制出力用）。
 *
 * docs/architecture.md §3 / §5.1 / §5.2 準拠。
 *
 * Zod スキーマ（schemas.ts）と二重定義だが、JSON Schema は Anthropic API の
 * `tools` フィールドに送る必要があるため手書き。tests/ocr/schemas.test.ts と
 * tests/ocr/tools.test.ts で両者の整合性を検証している。
 *
 * 将来 zod-to-json-schema を導入しても良いが、description 等の細部を API 応答
 * 品質に合わせて手動チューニングできる利点があるため当面は手書き維持。
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";

import {
  STYLE_DETECT_TOOL_NAME,
} from "./prompts/style-detect.js";
import {
  EXTRACT_COLUMN_TOOL_NAME,
} from "./prompts/waseda-system.js";
import {
  SINGLE_CELL_RETRY_TOOL_NAME,
} from "./prompts/single-cell-retry.js";

// ── 共通サブスキーマ ────────────────────────────────────────

const cellExtrasSchema = {
  type: "object" as const,
  required: [
    "SH",
    "SF",
    "HBP",
    "FC",
    "error_fielder",
    "stolen_bases",
    "passed_ball",
    "wild_pitch",
    "interference",
    "strikeout_reached",
  ],
  properties: {
    SH: { type: "boolean" as const, description: "Sacrifice bunt (犠打)" },
    SF: { type: "boolean" as const, description: "Sacrifice fly (犠飛)" },
    HBP: { type: "boolean" as const, description: "Hit by pitch" },
    FC: { type: "boolean" as const, description: "Fielder's choice" },
    error_fielder: {
      type: ["integer", "null"] as const,
      minimum: 1,
      maximum: 9,
      description: "Position number of the fielder who committed the error, or null",
    },
    stolen_bases: {
      type: "array" as const,
      items: { type: "integer" as const, minimum: 1, maximum: 4 },
      description: "Base numbers reached by stealing (can be multiple within the at-bat)",
    },
    passed_ball: { type: "boolean" as const },
    wild_pitch: { type: "boolean" as const },
    interference: {
      type: ["string", "null"] as const,
      enum: ["batter", "runner", null],
    },
    strikeout_reached: {
      type: "boolean" as const,
      description: "Batter reached base on dropped 3rd strike (振り逃げ)",
    },
  },
  additionalProperties: false,
};

const cellReadSchema = {
  type: "object" as const,
  required: [
    "batting_order",
    "inning",
    "raw_notation",
    "outcome",
    "fielders_involved",
    "reached_base",
    "out_count_after",
    "pitch_count",
    "extras",
    "evidence",
    "confidence",
    "alternatives",
  ],
  properties: {
    batting_order: { type: "integer" as const, minimum: 1, maximum: 11 },
    inning: { type: "integer" as const, minimum: 1, maximum: 15 },
    raw_notation: {
      type: ["string", "null"] as const,
      description: "Literal characters visible in the cell (or null for blank cells)",
    },
    outcome: {
      type: ["string", "null"] as const,
      enum: [
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
        null,
      ],
    },
    fielders_involved: {
      type: ["array", "null"] as const,
      items: { type: "integer" as const, minimum: 1, maximum: 9 },
      description: "Ordered chain of fielder positions (e.g., [6,4,3] for 6-4-3 DP)",
    },
    reached_base: {
      type: ["integer", "null"] as const,
      enum: [0, 1, 2, 3, 4, null],
      description: "0=out, 1-3=reached base, 4=scored",
    },
    out_count_after: {
      type: ["integer", "null"] as const,
      enum: [1, 2, 3, null],
      description: "If the cell is an out, which out number (1-3)",
    },
    pitch_count: {
      type: ["object", "null"] as const,
      required: ["balls", "strikes"],
      properties: {
        balls: { type: "integer" as const, minimum: 0, maximum: 4 },
        strikes: { type: "integer" as const, minimum: 0, maximum: 3 },
      },
      additionalProperties: false,
    },
    extras: cellExtrasSchema,
    evidence: {
      type: "string" as const,
      description: "Short (1-2 sentence) rationale describing what was observed",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Calibrated confidence (0.9+ = sure, 0.5 = 50/50)",
    },
    alternatives: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Competing raw_notation interpretations; MUST have >= 2 entries if confidence < 0.7",
      // NOTE: JSON Schema 側では minItems を硬く縛らない（conditional required は
      // Anthropic tool schema のサポート外 + モデルが強制制約で出力を歪める副作用を避けるため）。
      // 「confidence < 0.7 ⇒ alternatives.length >= 2」の検証は Zod 側の
      // validateCellConsistency() で実施する（src/ocr/schemas.ts）。
    },
  },
  additionalProperties: false,
};

// ── Tool 定義 ───────────────────────────────────────────────

export const DETECT_STYLE_TOOL: Tool = {
  name: STYLE_DETECT_TOOL_NAME,
  description:
    "Classify a Japanese amateur baseball scorebook's printed style (waseda / keio / chiba / unknown) based on six decisive visual features of the printed template. Used in Stage 1 of the OCR pipeline.",
  input_schema: {
    type: "object",
    required: ["style", "evidence", "confidence"],
    properties: {
      style: {
        type: "string",
        enum: ["waseda", "keio", "chiba", "unknown"],
      },
      evidence: {
        type: "object",
        required: [
          "diamond_guide_lines",
          "ball_count_box",
          "first_base_position",
          "groundout_position",
          "error_symbol",
          "batting_order_style",
        ],
        properties: {
          diamond_guide_lines: { type: "string", enum: ["present", "absent"] },
          ball_count_box: {
            type: "string",
            enum: ["left_vertical", "top_horizontal"],
          },
          first_base_position: {
            type: "string",
            enum: ["bottom_right", "top_right"],
          },
          groundout_position: {
            type: "string",
            enum: ["bottom_right_small", "center_fraction"],
          },
          error_symbol: {
            type: "string",
            enum: ["E_prefix", "prime_superscript"],
          },
          batting_order_style: {
            type: "string",
            enum: ["circled_digits", "lowercase_latin"],
          },
        },
        additionalProperties: false,
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    additionalProperties: false,
  },
};

export const EXTRACT_COLUMN_CELLS_TOOL: Tool = {
  name: EXTRACT_COLUMN_TOOL_NAME,
  description:
    "Extract every at-bat cell in a single inning column from a scorebook page. Return one CellRead per batter in batting-order sequence (including blank cells). Used in Stage 2 of the OCR pipeline.",
  input_schema: {
    type: "object",
    required: ["inning", "cells"],
    properties: {
      inning: { type: "integer", minimum: 1, maximum: 15 },
      cells: {
        type: "array",
        items: cellReadSchema,
      },
      column_quality: {
        type: "object",
        // NOTE: ルート `required` には含めない（optional）が、オブジェクト自体を
        // 返す場合は legibility/issues 両方必須とする。waseda-system の
        // prompt 側で「Output column_quality」と指示しているため現実的には
        // ほぼ返ってくるが、列全体が空セルの場合に無くても parse が通るよう
        // トップレベルは optional のまま維持（Zod schemas.ts と整合）。
        required: ["legibility", "issues"],
        properties: {
          legibility: { type: "number", minimum: 0, maximum: 1 },
          issues: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
};

export const READ_SINGLE_CELL_TOOL: Tool = {
  name: SINGLE_CELL_RETRY_TOOL_NAME,
  description:
    "Re-read a single scorebook cell that was low-confidence on the first pass. Return one CellRead. The caller provides batting_order and inning out-of-band — include those values in the returned CellRead.",
  input_schema: cellReadSchema,
};

export const ALL_TOOLS: readonly Tool[] = [
  DETECT_STYLE_TOOL,
  EXTRACT_COLUMN_CELLS_TOOL,
  READ_SINGLE_CELL_TOOL,
];
