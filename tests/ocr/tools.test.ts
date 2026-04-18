/**
 * Anthropic Tool 定義の sanity test。
 *
 * - 各 Tool に必要な構造（name/description/input_schema）が揃っているか
 * - Zod スキーマ（schemas.ts）と enum 値が一致するか
 */

import { describe, expect, it } from "vitest";

import {
  ALL_TOOLS,
  DETECT_STYLE_TOOL,
  EXTRACT_COLUMN_CELLS_TOOL,
  READ_SINGLE_CELL_TOOL,
} from "../../src/ocr/tools.js";
import {
  CellReadSchema,
  OutcomeSchema,
  StyleSchema,
} from "../../src/ocr/schemas.js";

describe("Tool definitions", () => {
  it("exports all three tools via ALL_TOOLS", () => {
    expect(ALL_TOOLS.length).toBe(3);
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      "detect_style",
      "extract_column_cells",
      "read_single_cell",
    ]);
  });

  it("detect_style tool has expected enum for style", () => {
    const props = DETECT_STYLE_TOOL.input_schema.properties as Record<
      string,
      { enum?: unknown[] }
    >;
    expect(props.style?.enum).toEqual(StyleSchema.options);
  });

  it("extract_column_cells tool wraps cells array", () => {
    const root = EXTRACT_COLUMN_CELLS_TOOL.input_schema as {
      required: string[];
      properties: Record<string, { type: string; items?: unknown }>;
    };
    expect(root.required).toContain("cells");
    expect(root.properties.cells.type).toBe("array");
  });

  it("read_single_cell tool's input_schema matches cell-level structure", () => {
    const root = READ_SINGLE_CELL_TOOL.input_schema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(root.required).toContain("batting_order");
    expect(root.required).toContain("outcome");
    expect(root.required).toContain("confidence");
  });
});

describe("Schema / Tool enum parity", () => {
  it("outcome enum in JSON Schema matches Zod OutcomeSchema (plus null)", () => {
    const cellProps = (
      (EXTRACT_COLUMN_CELLS_TOOL.input_schema.properties as Record<string, unknown>)
        .cells as { items: { properties: Record<string, { enum?: unknown[] }> } }
    ).items.properties;
    const jsonEnum = new Set(cellProps.outcome.enum as unknown[]);
    for (const v of OutcomeSchema.options) {
      expect(jsonEnum.has(v)).toBe(true);
    }
    expect(jsonEnum.has(null)).toBe(true);
  });

  it("CellReadSchema accepts a cell that satisfies tool input_schema example", () => {
    const example = {
      batting_order: 3,
      inning: 4,
      raw_notation: "6-4-3",
      outcome: "ground_out",
      fielders_involved: [6, 4, 3],
      reached_base: 0,
      out_count_after: 2,
      pitch_count: { balls: 1, strikes: 2 },
      extras: {
        SH: false,
        SF: false,
        HBP: false,
        FC: false,
        error_fielder: null,
        stolen_bases: [],
        passed_ball: false,
        wild_pitch: false,
        interference: null,
        strikeout_reached: false,
      },
      evidence: "clear 6-4-3 double play chain",
      confidence: 0.95,
      alternatives: [],
    };
    const parsed = CellReadSchema.parse(example);
    expect(parsed.outcome).toBe("ground_out");
  });
});
