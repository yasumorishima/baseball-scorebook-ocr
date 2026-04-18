/**
 * merge.ts の単体テスト。
 */

import { describe, expect, it } from "vitest";

import {
  findLowConfidenceCells,
  flattenGrid,
  mergeStage2Results,
} from "../../src/ocr/merge.js";
import type { CellRead } from "../../src/types/cell.js";
import type { Stage2ColumnResult } from "../../src/ocr/stage2-extract-cells.js";

const EXTRAS: CellRead["extras"] = {
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

function makeCell(
  batting_order: number,
  inning: number,
  confidence: number,
  extra: Partial<CellRead> = {},
): CellRead {
  return {
    batting_order,
    inning,
    raw_notation: "6-3",
    outcome: "ground_out",
    fielders_involved: [6, 3],
    reached_base: 0,
    out_count_after: 1,
    pitch_count: null,
    extras: EXTRAS,
    evidence: "test",
    confidence,
    alternatives: [],
    ...extra,
  };
}

function makeColumn(inning: number, cells: CellRead[]): Stage2ColumnResult {
  return {
    inning,
    response: {
      inning,
      cells,
      column_quality: { legibility: 0.9, issues: [] },
    },
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    latencyMs: 100,
    attempts: 1,
  };
}

describe("mergeStage2Results", () => {
  it("places cells correctly into the grid (batting_order x inning)", () => {
    const cols = [
      makeColumn(1, [makeCell(1, 1, 0.95), makeCell(2, 1, 0.9)]),
      makeColumn(2, [makeCell(1, 2, 0.92)]),
    ];
    const { grid, filledCount } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(grid[0][0]?.raw_notation).toBe("6-3");
    expect(grid[1][0]?.batting_order).toBe(2);
    expect(grid[0][1]?.inning).toBe(2);
    expect(filledCount).toBe(3);
  });

  it("drops out-of-bounds cells", () => {
    const cols = [
      makeColumn(1, [
        makeCell(1, 1, 0.95),
        makeCell(15, 1, 0.9), // batter 15 out of bounds
        makeCell(1, 99, 0.9), // inning 99 out of bounds
      ]),
    ];
    const { grid, filledCount, droppedCells } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(filledCount).toBe(1);
    expect(droppedCells.length).toBe(2);
    expect(grid[0][0]).not.toBeNull();
  });

  it("keeps higher-confidence cell on conflict and records the drop", () => {
    const cols = [
      makeColumn(1, [makeCell(1, 1, 0.6)]),
      makeColumn(1, [makeCell(1, 1, 0.9, { raw_notation: "F8" })]),
    ];
    const { grid, conflicts } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(grid[0][0]?.raw_notation).toBe("F8");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].kept.confidence).toBe(0.9);
    expect(conflicts[0].dropped.confidence).toBe(0.6);
  });

  it("builds confidenceHist (high >= 0.8, mid >= 0.5, low < 0.5)", () => {
    const cols = [
      makeColumn(1, [
        makeCell(1, 1, 0.95), // high
        makeCell(2, 1, 0.7), // mid
        makeCell(3, 1, 0.3), // low
        makeCell(4, 1, 0.8), // high (boundary)
        makeCell(5, 1, 0.5), // mid (boundary)
      ]),
    ];
    const { confidenceHist } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(confidenceHist).toEqual({ high: 2, mid: 2, low: 1 });
  });

  it("tolerates empty columns (valid game with blanks)", () => {
    const cols = [makeColumn(1, []), makeColumn(2, [])];
    const { grid, filledCount } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(filledCount).toBe(0);
    expect(grid.length).toBe(10);
    expect(grid[0].length).toBe(13);
  });
});

describe("flattenGrid + findLowConfidenceCells", () => {
  it("flattens non-null cells", () => {
    const cols = [
      makeColumn(1, [makeCell(1, 1, 0.9), makeCell(2, 1, 0.4)]),
    ];
    const { grid } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    expect(flattenGrid(grid).length).toBe(2);
  });

  it("findLowConfidenceCells filters by threshold", () => {
    const cols = [
      makeColumn(1, [
        makeCell(1, 1, 0.95),
        makeCell(2, 1, 0.4),
        makeCell(3, 1, 0.45),
      ]),
    ];
    const { grid } = mergeStage2Results(cols, {
      batterCount: 10,
      inningCount: 13,
    });
    const lows = findLowConfidenceCells(grid, 0.5);
    expect(lows.length).toBe(2);
    expect(lows.every((c) => c.confidence < 0.5)).toBe(true);
  });
});
