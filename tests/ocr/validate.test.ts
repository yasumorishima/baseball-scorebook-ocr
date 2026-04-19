/**
 * validate.ts の単体テスト。
 *
 * 合成グリッド（valid, 各 violation の発生）で期待 report を確認。
 */

import { describe, expect, it } from "vitest";

import { validateGrid } from "../../src/ocr/validate.js";
import type { CellRead, Outcome } from "../../src/types/cell.js";
import type { Grid } from "../../src/types/grid.js";

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

function cell(
  bo: number,
  inn: number,
  outcome: Outcome | null,
  reached: CellRead["reached_base"],
  out_after: CellRead["out_count_after"] = null,
  overrides: Partial<CellRead> = {},
): CellRead {
  return {
    batting_order: bo,
    inning: inn,
    raw_notation: outcome ?? "blank",
    outcome,
    fielders_involved: null,
    reached_base: reached,
    out_count_after: out_after,
    pitch_count: null,
    extras: EXTRAS,
    evidence: "synthetic",
    confidence: 0.9,
    alternatives: [],
    ...overrides,
  };
}

function makeGrid(
  cells: CellRead[],
  batterCount = 9,
  inningCount = 9,
): Grid<CellRead> {
  const g: Grid<CellRead> = Array.from({ length: batterCount }, () =>
    Array.from({ length: inningCount }, () => null),
  );
  for (const c of cells) g[c.batting_order - 1][c.inning - 1] = c;
  return g;
}

describe("validateGrid", () => {
  it("accepts a clean 1-inning grid with 3 outs and correct batting order", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      cell(2, 1, "fly_out", 0, 2),
      cell(3, 1, "strikeout_swinging", 0, 3),
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.perInningOuts[0]).toBe(3);
  });

  it("flags >3 outs in a single inning", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      cell(2, 1, "fly_out", 0, 2),
      cell(3, 1, "pop_out", 0, 3),
      cell(4, 1, "line_out", 0, null), // would be a 4th out
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(report.valid).toBe(false);
    expect(
      report.errors.find((e) => e.kind === "outs_per_inning"),
    ).toBeDefined();
  });

  it("flags an inning with fewer than 3 outs when it's not the last", () => {
    const grid = makeGrid(
      [
        cell(1, 1, "ground_out", 0, 1),
        cell(2, 1, "fly_out", 0, 2),
        // missing 3rd out for inning 1
        cell(3, 2, "strikeout_swinging", 0, 1),
        cell(4, 2, "ground_out", 0, 2),
        cell(5, 2, "fly_out", 0, 3),
      ],
      9,
      9,
    );
    const report = validateGrid(grid, { lastPlayedInning: 2 });
    expect(
      report.errors.find(
        (e) => e.kind === "outs_per_inning" && e.inning === 0,
      ),
    ).toBeDefined();
  });

  it("tolerates an unfinished last inning as a warning by default", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      cell(2, 1, "fly_out", 0, 2),
      // only 2 outs in inning 1 which is the last played
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(report.valid).toBe(true);
    expect(
      report.warnings.find((w) => w.kind === "outs_per_inning"),
    ).toBeDefined();
  });

  it("flags batting order discontinuity within an inning (e.g., 1 → 3)", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      cell(3, 1, "fly_out", 0, 2), // skipped #2
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.errors.find((e) => e.kind === "batting_order_continuity"),
    ).toBeDefined();
  });

  it("wraps batting order correctly at batterCount boundary", () => {
    // batter_count=9: after #9 comes #1 again
    const grid = makeGrid(
      [
        cell(7, 1, "ground_out", 0, 1),
        cell(8, 1, "fly_out", 0, 2),
        cell(9, 1, "fly_out", 0, 3),
      ],
      9,
      9,
    );
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.errors.some((e) => e.kind === "batting_order_continuity"),
    ).toBe(false);
  });

  it("flags outcome/reached_base mismatch: ground_out with reached_base=1", () => {
    const grid = makeGrid([cell(1, 1, "ground_out", 1, null)]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.errors.find((e) => e.kind === "reached_base_outcome_mismatch"),
    ).toBeDefined();
  });

  it("tolerates strikeout with reached_base=1 when strikeout_reached=true (振り逃げ)", () => {
    const grid = makeGrid([
      cell(1, 1, "strikeout_swinging", 1, null, {
        extras: { ...EXTRAS, strikeout_reached: true },
      }),
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.errors.some((e) => e.kind === "reached_base_outcome_mismatch"),
    ).toBe(false);
  });

  it("flags a single with reached_base=0", () => {
    const grid = makeGrid([cell(1, 1, "single", 0, null)]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.errors.find((e) => e.kind === "reached_base_outcome_mismatch"),
    ).toBeDefined();
  });

  it("warns on empty cells appearing mid-inning", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      // batter 2 empty
      cell(3, 1, "fly_out", 0, 2),
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(
      report.warnings.find((w) => w.kind === "empty_cell_in_progress"),
    ).toBeDefined();
  });

  it("returns perInningOuts and battingOrderSequence summaries", () => {
    const grid = makeGrid([
      cell(1, 1, "ground_out", 0, 1),
      cell(2, 1, "fly_out", 0, 2),
      cell(3, 1, "strikeout_swinging", 0, 3),
    ]);
    const report = validateGrid(grid, { lastPlayedInning: 1 });
    expect(report.perInningOuts[0]).toBe(3);
    expect(report.battingOrderSequence[0]).toEqual([1, 2, 3]);
  });

  // ── #9 extras_outcome_conflict ───────────────────────────
  describe("extras_outcome_conflict", () => {
    it("warns when outcome=sac_bunt and extras.SH=true (double representation)", () => {
      const grid = makeGrid([
        cell(1, 1, "sac_bunt", 0, 1, {
          extras: { ...EXTRAS, SH: true },
        }),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      const w = report.warnings.find((v) => v.kind === "extras_outcome_conflict");
      expect(w).toBeDefined();
      expect(w?.message).toContain("sac_bunt");
      expect(w?.message).toContain("SH");
    });

    it("warns when outcome=walk and extras.HBP=true (mutually exclusive)", () => {
      const grid = makeGrid([
        cell(1, 1, "walk", 1, null, {
          extras: { ...EXTRAS, HBP: true },
        }),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "extras_outcome_conflict"),
      ).toBeDefined();
    });

    it("warns when multiple extras flags are set simultaneously (SH + SF)", () => {
      const grid = makeGrid([
        cell(1, 1, "ground_out", 0, 1, {
          extras: { ...EXTRAS, SH: true, SF: true },
        }),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      const w = report.warnings.find((v) => v.kind === "extras_outcome_conflict");
      expect(w).toBeDefined();
      expect(w?.message).toContain("multiple extras flags");
    });

    it("does NOT warn for canonical outcome-only representation (sac_bunt with no extras)", () => {
      const grid = makeGrid([cell(1, 1, "sac_bunt", 0, 1)]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "extras_outcome_conflict"),
      ).toBeUndefined();
    });

    it("does NOT warn for strikeout + strikeout_reached (legitimate 振り逃げ combo)", () => {
      const grid = makeGrid([
        cell(1, 1, "strikeout_swinging", 1, null, {
          extras: { ...EXTRAS, strikeout_reached: true },
        }),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "extras_outcome_conflict"),
      ).toBeUndefined();
    });
  });

  // ── #10 sacrifice_batter_scored ──────────────────────────
  describe("sacrifice_batter_scored", () => {
    it("warns when outcome=sac_bunt and reached_base=4", () => {
      const grid = makeGrid([cell(1, 1, "sac_bunt", 4, null)]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "sacrifice_batter_scored"),
      ).toBeDefined();
    });

    it("warns when extras.SF=true and reached_base=4 even without sac_fly outcome", () => {
      const grid = makeGrid([
        cell(1, 1, "fly_out", 4, null, {
          extras: { ...EXTRAS, SF: true },
        }),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "sacrifice_batter_scored"),
      ).toBeDefined();
    });

    it("does NOT warn for canonical sac_bunt with reached_base=0 (batter out)", () => {
      const grid = makeGrid([cell(1, 1, "sac_bunt", 0, 1)]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.find((v) => v.kind === "sacrifice_batter_scored"),
      ).toBeUndefined();
    });
  });

  // ── #8 empty_cell_in_progress のガード ───────────────────
  describe("empty_cell_in_progress guards", () => {
    it("does NOT warn for empty cells after 3 outs in that inning", () => {
      const grid = makeGrid([
        cell(1, 1, "ground_out", 0, 1),
        cell(2, 1, "fly_out", 0, 2),
        cell(3, 1, "strikeout_swinging", 0, 3),
        // batter 4 空のまま（3 アウト済み）
        cell(5, 1, "fly_out", 0, null), // これは有効でないが empty_cell_in_progress は発火しない
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      // empty_cell_in_progress は 3 アウト到達後のイニングでは発火しない
      expect(
        report.warnings.filter((w) => w.kind === "empty_cell_in_progress"),
      ).toHaveLength(0);
    });

    it("does NOT warn for empty cells in innings beyond lastPlayedInning", () => {
      const grid = makeGrid([
        cell(1, 1, "ground_out", 0, 1),
        cell(2, 1, "fly_out", 0, 2),
        cell(3, 1, "strikeout_swinging", 0, 3),
        // inning 2 は未開始（lastPlayedInning=1）
        cell(5, 2, "fly_out", 0, null),
      ]);
      const report = validateGrid(grid, { lastPlayedInning: 1 });
      expect(
        report.warnings.filter((w) => w.kind === "empty_cell_in_progress"),
      ).toHaveLength(0);
    });
  });
});
