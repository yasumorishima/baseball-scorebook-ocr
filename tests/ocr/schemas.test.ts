/**
 * src/ocr/schemas.ts の単体テスト。
 */

import { describe, expect, it } from "vitest";

import {
  CellExtrasSchema,
  CellReadSchema,
  StyleDetectionSchema,
  Stage2ColumnResponseSchema,
  validateCellConsistency,
  type CellReadParsed,
} from "../../src/ocr/schemas.js";

const VALID_EXTRAS: CellReadParsed["extras"] = {
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
};

const VALID_CELL: CellReadParsed = {
  batting_order: 1,
  inning: 1,
  raw_notation: "6-3",
  outcome: "ground_out",
  fielders_involved: [6, 3],
  reached_base: 0,
  out_count_after: 1,
  pitch_count: null,
  extras: VALID_EXTRAS,
  evidence: "standard 6-3 SS-1B chain",
  confidence: 0.92,
  alternatives: [],
};

describe("StyleDetectionSchema", () => {
  it("accepts a valid detection", () => {
    const parsed = StyleDetectionSchema.parse({
      style: "waseda",
      evidence: {
        diamond_guide_lines: "present",
        ball_count_box: "left_vertical",
        first_base_position: "bottom_right",
        groundout_position: "bottom_right_small",
        error_symbol: "E_prefix",
        batting_order_style: "circled_digits",
      },
      confidence: 0.9,
    });
    expect(parsed.style).toBe("waseda");
  });

  it("rejects unknown style", () => {
    expect(() =>
      StyleDetectionSchema.parse({
        style: "nihon",
        evidence: {
          diamond_guide_lines: "present",
          ball_count_box: "left_vertical",
          first_base_position: "bottom_right",
          groundout_position: "bottom_right_small",
          error_symbol: "E_prefix",
          batting_order_style: "circled_digits",
        },
        confidence: 0.9,
      }),
    ).toThrow();
  });

  it("rejects confidence > 1", () => {
    expect(() =>
      StyleDetectionSchema.parse({
        style: "waseda",
        evidence: {
          diamond_guide_lines: "present",
          ball_count_box: "left_vertical",
          first_base_position: "bottom_right",
          groundout_position: "bottom_right_small",
          error_symbol: "E_prefix",
          batting_order_style: "circled_digits",
        },
        confidence: 1.5,
      }),
    ).toThrow();
  });
});

describe("CellReadSchema", () => {
  it("parses a valid ground-out cell", () => {
    const parsed = CellReadSchema.parse(VALID_CELL);
    expect(parsed.outcome).toBe("ground_out");
    expect(parsed.fielders_involved).toEqual([6, 3]);
  });

  it("parses a blank cell with nulls", () => {
    const parsed = CellReadSchema.parse({
      ...VALID_CELL,
      raw_notation: null,
      outcome: null,
      fielders_involved: null,
      reached_base: null,
      out_count_after: null,
      pitch_count: null,
      evidence: "blank cell",
      confidence: 1.0,
    });
    expect(parsed.raw_notation).toBeNull();
  });

  it("accepts pitch_count object", () => {
    const parsed = CellReadSchema.parse({
      ...VALID_CELL,
      pitch_count: { balls: 2, strikes: 1 },
    });
    expect(parsed.pitch_count).toEqual({ balls: 2, strikes: 1 });
  });

  it("rejects out_count_after=4", () => {
    expect(() =>
      CellReadSchema.parse({ ...VALID_CELL, out_count_after: 4 }),
    ).toThrow();
  });

  it("rejects batting_order out of 1-11", () => {
    expect(() =>
      CellReadSchema.parse({ ...VALID_CELL, batting_order: 12 }),
    ).toThrow();
    expect(() =>
      CellReadSchema.parse({ ...VALID_CELL, batting_order: 0 }),
    ).toThrow();
  });

  it("rejects fielders_involved with position 10", () => {
    expect(() =>
      CellReadSchema.parse({ ...VALID_CELL, fielders_involved: [10] }),
    ).toThrow();
  });

  it("rejects unknown outcome", () => {
    expect(() =>
      CellReadSchema.parse({ ...VALID_CELL, outcome: "stolen_home" }),
    ).toThrow();
  });
});

describe("CellExtrasSchema", () => {
  it("accepts a fully-populated extras object", () => {
    const parsed = CellExtrasSchema.parse({
      SH: true,
      SF: false,
      HBP: false,
      FC: false,
      error_fielder: 5,
      stolen_bases: [2, 3],
      passed_ball: true,
      wild_pitch: false,
      interference: "batter",
      strikeout_reached: false,
    });
    expect(parsed.interference).toBe("batter");
  });

  it("rejects error_fielder out of 1-9", () => {
    expect(() =>
      CellExtrasSchema.parse({ ...VALID_EXTRAS, error_fielder: 10 }),
    ).toThrow();
  });
});

describe("Stage2ColumnResponseSchema", () => {
  it("parses a full inning column with 10 cells", () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({
      ...VALID_CELL,
      batting_order: i + 1,
      inning: 1,
    }));
    const parsed = Stage2ColumnResponseSchema.parse({
      inning: 1,
      cells,
      column_quality: { legibility: 0.88, issues: [] },
    });
    expect(parsed.cells.length).toBe(10);
  });

  it("parses response without column_quality", () => {
    const parsed = Stage2ColumnResponseSchema.parse({ inning: 5, cells: [] });
    expect(parsed.column_quality).toBeUndefined();
  });
});

describe("validateCellConsistency", () => {
  it("flags low confidence without alternatives", () => {
    const issues = validateCellConsistency({
      ...VALID_CELL,
      confidence: 0.5,
      alternatives: ["6-3"],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/alternatives/);
  });

  it("accepts low confidence with >=2 alternatives", () => {
    expect(
      validateCellConsistency({
        ...VALID_CELL,
        confidence: 0.4,
        alternatives: ["6-3", "4-3"],
      }),
    ).toEqual([]);
  });

  it("flags out outcome with positive reached_base", () => {
    const issues = validateCellConsistency({
      ...VALID_CELL,
      outcome: "fly_out",
      reached_base: 1,
    });
    expect(issues[0]).toMatch(/reached_base=1/);
  });

  it("tolerates strikeout_reached=true with reached_base>0", () => {
    expect(
      validateCellConsistency({
        ...VALID_CELL,
        outcome: "strikeout_swinging",
        reached_base: 1,
        extras: { ...VALID_EXTRAS, strikeout_reached: true },
      }),
    ).toEqual([]);
  });

  it("flags single with reached_base=0", () => {
    const issues = validateCellConsistency({
      ...VALID_CELL,
      outcome: "single",
      reached_base: 0,
    });
    expect(issues[0]).toMatch(/single.*reached_base=0/);
  });

  it("accepts double with reached_base=3 (advanced on error)", () => {
    expect(
      validateCellConsistency({
        ...VALID_CELL,
        outcome: "double",
        reached_base: 3,
      }),
    ).toEqual([]);
  });
});
