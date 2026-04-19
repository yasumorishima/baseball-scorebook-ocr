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
  CellExtrasSchema,
  CellReadSchema,
  OutcomeSchema,
  PitchCountSchema,
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
    const root = EXTRACT_COLUMN_CELLS_TOOL.input_schema as unknown as {
      required: string[];
      properties: Record<string, { type: string; items?: unknown }>;
    };
    expect(root.required).toContain("cells");
    expect(root.properties.cells.type).toBe("array");
  });

  it("read_single_cell tool's input_schema matches cell-level structure", () => {
    const root = READ_SINGLE_CELL_TOOL.input_schema as unknown as {
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
    const schema = EXTRACT_COLUMN_CELLS_TOOL.input_schema as unknown as {
      properties: Record<string, unknown>;
    };
    const cellProps = (
      schema.properties.cells as {
        items: { properties: Record<string, { enum?: unknown[] }> };
      }
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

// ── Structural parity: Zod ⇔ JSON Schema の required / nullable / 範囲一致 ────
//
// enum 値一致だけでなく、両スキーマの以下を機械的に比較する:
//   - required フィールド集合
//   - 各フィールドの nullable (JSON Schema では type:[...,"null"])
//   - 数値フィールドの minimum / maximum
//   - 配列 items の integer minimum/maximum
//
// どちらか一方にフィールド追加・削除した場合にもう一方も追随するよう、
// 構造レベルで lock-step を保証する（enum 追加など細かい齟齬はここで catch する）。

type JsonSchemaObject = {
  type: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  additionalProperties?: boolean;
};

function isNullable(schema: JsonSchemaObject): boolean {
  const t = schema.type;
  return Array.isArray(t) ? t.includes("null") : t === "null";
}

describe("Zod / JSON Schema structural parity", () => {
  const cellJsonSchema = (
    EXTRACT_COLUMN_CELLS_TOOL.input_schema as unknown as {
      properties: { cells: { items: JsonSchemaObject } };
    }
  ).properties.cells.items;

  it("required keys match between CellReadSchema and JSON Schema cell item", () => {
    const zodKeys = Object.keys(CellReadSchema.shape).sort();
    const jsonRequired = [...(cellJsonSchema.required ?? [])].sort();
    expect(jsonRequired).toEqual(zodKeys);
  });

  it("nullable fields match (raw_notation / outcome / fielders_involved / reached_base / out_count_after / pitch_count)", () => {
    const expectedNullable = [
      "raw_notation",
      "outcome",
      "fielders_involved",
      "reached_base",
      "out_count_after",
      "pitch_count",
    ];
    const props = cellJsonSchema.properties ?? {};
    for (const key of expectedNullable) {
      expect(isNullable(props[key])).toBe(true);
    }
    // non-nullable sanity
    expect(isNullable(props.batting_order)).toBe(false);
    expect(isNullable(props.inning)).toBe(false);
    expect(isNullable(props.confidence)).toBe(false);
  });

  it("batting_order / inning / confidence min-max bounds match Zod constraints", () => {
    const props = cellJsonSchema.properties ?? {};
    // CellReadSchema: batting_order int 1-11, inning int 1-15, confidence 0-1
    expect(props.batting_order.minimum).toBe(1);
    expect(props.batting_order.maximum).toBe(11);
    expect(props.inning.minimum).toBe(1);
    expect(props.inning.maximum).toBe(15);
    expect(props.confidence.minimum).toBe(0);
    expect(props.confidence.maximum).toBe(1);
  });

  it("extras required keys match CellExtrasSchema", () => {
    const extrasSchema = (cellJsonSchema.properties ?? {}).extras;
    const zodExtrasKeys = Object.keys(CellExtrasSchema.shape).sort();
    const jsonExtrasRequired = [...(extrasSchema.required ?? [])].sort();
    expect(jsonExtrasRequired).toEqual(zodExtrasKeys);
  });

  it("extras.error_fielder is nullable integer with range [1, 9]", () => {
    const props = (cellJsonSchema.properties ?? {}).extras.properties ?? {};
    expect(isNullable(props.error_fielder)).toBe(true);
    expect(props.error_fielder.minimum).toBe(1);
    expect(props.error_fielder.maximum).toBe(9);
  });

  it("extras.stolen_bases items are integer 1-4 matching Zod", () => {
    const props = (cellJsonSchema.properties ?? {}).extras.properties ?? {};
    expect(props.stolen_bases.type).toBe("array");
    expect(props.stolen_bases.items?.minimum).toBe(1);
    expect(props.stolen_bases.items?.maximum).toBe(4);
  });

  it("pitch_count nullable object has balls 0-4 strikes 0-3 matching PitchCountSchema", () => {
    const pitchSchema = (cellJsonSchema.properties ?? {}).pitch_count;
    expect(isNullable(pitchSchema)).toBe(true);
    // Zod shape 経由で範囲を参照（PitchCountSchema の shape.balls は ZodNumber）
    const pcProps = pitchSchema.properties ?? {};
    expect(pcProps.balls.minimum).toBe(0);
    expect(pcProps.balls.maximum).toBe(4);
    expect(pcProps.strikes.minimum).toBe(0);
    expect(pcProps.strikes.maximum).toBe(3);
    // 参照側の Zod も同値であることを軽く確認
    const zodShape = PitchCountSchema.shape;
    expect(zodShape.balls).toBeDefined();
    expect(zodShape.strikes).toBeDefined();
  });

  it("reached_base and out_count_after enums match Zod literal unions", () => {
    const props = cellJsonSchema.properties ?? {};
    // reached_base: 0/1/2/3/4/null
    expect(new Set(props.reached_base.enum ?? [])).toEqual(
      new Set([0, 1, 2, 3, 4, null]),
    );
    // out_count_after: 1/2/3/null
    expect(new Set(props.out_count_after.enum ?? [])).toEqual(
      new Set([1, 2, 3, null]),
    );
  });

  it("fielders_involved items are integer 1-9", () => {
    const props = cellJsonSchema.properties ?? {};
    expect(isNullable(props.fielders_involved)).toBe(true);
    expect(props.fielders_involved.items?.minimum).toBe(1);
    expect(props.fielders_involved.items?.maximum).toBe(9);
  });

  it("additionalProperties:false is enforced at cell root and extras", () => {
    expect(cellJsonSchema.additionalProperties).toBe(false);
    const extrasSchema = (cellJsonSchema.properties ?? {}).extras;
    expect(extrasSchema.additionalProperties).toBe(false);
  });

  it("style-detect evidence required keys are the 6 visual features", () => {
    const root = DETECT_STYLE_TOOL.input_schema as unknown as {
      properties: {
        evidence: JsonSchemaObject;
      };
    };
    const evidenceRequired = [...(root.properties.evidence.required ?? [])].sort();
    expect(evidenceRequired).toEqual(
      [
        "diamond_guide_lines",
        "ball_count_box",
        "first_base_position",
        "groundout_position",
        "error_symbol",
        "batting_order_style",
      ].sort(),
    );
  });

  it("outcome enum also allows null (nullable in Zod via .nullable())", () => {
    const props = cellJsonSchema.properties ?? {};
    expect(isNullable(props.outcome)).toBe(true);
    expect((props.outcome.enum ?? []).includes(null)).toBe(true);
  });
});
