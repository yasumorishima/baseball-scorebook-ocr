/**
 * anomalies.ts の単体テスト。
 */

import { describe, expect, it } from "vitest";

import {
  classifyCellAnomaly,
  diagnoseObpDelta,
  listAnomalyKinds,
  type ObpAnomalyKind,
} from "../../src/stats/anomalies.js";
import {
  aggregateBattingFromCells,
  emptyBattingStats,
} from "../../src/stats/compute.js";
import type { CellRead, Outcome } from "../../src/types/cell.js";

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
  outcome: Outcome | null,
  overrides: Partial<CellRead> = {},
): CellRead {
  return {
    batting_order: 1,
    inning: 1,
    raw_notation: "test",
    outcome,
    fielders_involved: null,
    reached_base: null,
    out_count_after: null,
    pitch_count: null,
    extras: EXTRAS,
    evidence: "test",
    confidence: 0.9,
    alternatives: [],
    ...overrides,
  };
}

describe("classifyCellAnomaly", () => {
  it("strikeout_reached (振り逃げ)", () => {
    const a = classifyCellAnomaly(
      cell("strikeout_looking", {
        extras: { ...EXTRAS, strikeout_reached: true },
        reached_base: 1,
      }),
    );
    expect(a?.kind).toBe("strikeout_reached");
    expect(a?.direction).toBe("obp_down");
  });

  it("fielders_choice", () => {
    const a = classifyCellAnomaly(cell("fielders_choice", { reached_base: 1 }));
    expect(a?.kind).toBe("fielders_choice");
    expect(a?.direction).toBe("obp_down");
  });

  it("reach_on_error", () => {
    const a = classifyCellAnomaly(cell("error", { reached_base: 1 }));
    expect(a?.kind).toBe("reach_on_error");
    expect(a?.direction).toBe("obp_down");
  });

  it("sac_bunt → sacrifice_no_stats_change", () => {
    const a = classifyCellAnomaly(cell("sac_bunt"));
    expect(a?.kind).toBe("sacrifice_no_stats_change");
    expect(a?.direction).toBe("no_change");
  });

  it("batter interference", () => {
    const a = classifyCellAnomaly(
      cell("interference", {
        extras: { ...EXTRAS, interference: "batter" },
        reached_base: 1,
      }),
    );
    expect(a?.kind).toBe("batter_interference_no_change");
    expect(a?.direction).toBe("no_change");
  });

  it("runner interference", () => {
    const a = classifyCellAnomaly(
      cell("interference", {
        extras: { ...EXTRAS, interference: "runner" },
      }),
    );
    expect(a?.kind).toBe("runner_interference");
    expect(a?.direction).toBe("obp_down");
  });

  it("normal single is NOT an anomaly", () => {
    expect(
      classifyCellAnomaly(cell("single", { reached_base: 1 })),
    ).toBeNull();
  });

  it("blank cell (outcome=null) returns null", () => {
    expect(classifyCellAnomaly(cell(null))).toBeNull();
  });

  it("regular strikeout (no 振り逃げ) is NOT an anomaly", () => {
    expect(
      classifyCellAnomaly(
        cell("strikeout_swinging", { reached_base: 0, out_count_after: 1 }),
      ),
    ).toBeNull();
  });
});

describe("diagnoseObpDelta", () => {
  it("reaches base via FC → paradox=true (OBP drops)", () => {
    const beforeCells = [cell("single", { reached_base: 1 })];
    const before = aggregateBattingFromCells(beforeCells);
    const after = aggregateBattingFromCells([
      ...beforeCells,
      cell("fielders_choice", { reached_base: 1 }),
    ]);
    const d = diagnoseObpDelta(before, after, 1);
    expect(d.reachedBase).toBe(true);
    expect(d.paradox).toBe(true);
    expect(d.obpDelta).toBeLessThan(0);
  });

  it("single does NOT trigger paradox (OBP rises)", () => {
    const before = emptyBattingStats();
    const after = aggregateBattingFromCells([cell("single")]);
    const d = diagnoseObpDelta(before, after, 1);
    expect(d.paradox).toBe(false);
    expect(d.obpDelta).toBeGreaterThan(0);
  });

  it("batter interference does NOT change rates", () => {
    const beforeCells = [cell("single"), cell("walk")];
    const before = aggregateBattingFromCells(beforeCells);
    const after = aggregateBattingFromCells([
      ...beforeCells,
      cell("interference", { extras: { ...EXTRAS, interference: "batter" } }),
    ]);
    const d = diagnoseObpDelta(before, after, 1);
    expect(Math.abs(d.avgDelta)).toBeLessThan(1e-9);
    expect(Math.abs(d.obpDelta)).toBeLessThan(1e-9);
  });

  it("did not reach base → paradox=false regardless", () => {
    const before = emptyBattingStats();
    const after = aggregateBattingFromCells([cell("ground_out")]);
    const d = diagnoseObpDelta(before, after, 0);
    expect(d.reachedBase).toBe(false);
    expect(d.paradox).toBe(false);
  });
});

describe("listAnomalyKinds", () => {
  it("exposes all 6 canonical kinds for UI help modal", () => {
    const all = listAnomalyKinds();
    const kinds: ObpAnomalyKind[] = [
      "strikeout_reached",
      "fielders_choice",
      "reach_on_error",
      "sacrifice_no_stats_change",
      "batter_interference_no_change",
      "runner_interference",
    ];
    expect(all.map((a) => a.kind).sort()).toEqual([...kinds].sort());
    for (const a of all) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.tooltip.length).toBeGreaterThan(0);
    }
  });
});
