/**
 * compute.ts の単体テスト。手計算フィクスチャで rate 正当性を検証。
 */

import { describe, expect, it } from "vitest";

import {
  aggregateBattingFromCells,
  computeBattingRates,
  computePitchingRates,
  emptyBattingStats,
  emptyPitchingStats,
  plateAppearancesOf,
  singlesOf,
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

describe("aggregateBattingFromCells", () => {
  it("counts singles correctly (AB+1, H+1, no extra-base)", () => {
    const s = aggregateBattingFromCells([cell("single"), cell("single")]);
    expect(s.AB).toBe(2);
    expect(s.H).toBe(2);
    expect(s["2B"]).toBe(0);
    expect(singlesOf(s)).toBe(2);
  });

  it("counts HR with reached_base=4 as R too", () => {
    const s = aggregateBattingFromCells([cell("home_run", { reached_base: 4 })]);
    expect(s.HR).toBe(1);
    expect(s.H).toBe(1);
    expect(s.AB).toBe(1);
    expect(s.R).toBe(1);
  });

  it("walk is PA but not AB", () => {
    const s = aggregateBattingFromCells([cell("walk")]);
    expect(s.AB).toBe(0);
    expect(s.BB).toBe(1);
    expect(plateAppearancesOf(s)).toBe(1);
  });

  it("sac_bunt: SH+1, AB+0, PA+1", () => {
    const s = aggregateBattingFromCells([cell("sac_bunt")]);
    expect(s.SH).toBe(1);
    expect(s.AB).toBe(0);
    expect(plateAppearancesOf(s)).toBe(1);
  });

  it("sac_fly: SF+1, AB+0, PA+1", () => {
    const s = aggregateBattingFromCells([cell("sac_fly")]);
    expect(s.SF).toBe(1);
    expect(s.AB).toBe(0);
    expect(plateAppearancesOf(s)).toBe(1);
  });

  it("strikeout_swinging: AB+1 SO+1", () => {
    const s = aggregateBattingFromCells([cell("strikeout_swinging")]);
    expect(s.AB).toBe(1);
    expect(s.SO).toBe(1);
  });

  it("strikeout with 振り逃げ: strikeoutReached+1 alongside AB/SO", () => {
    const s = aggregateBattingFromCells([
      cell("strikeout_looking", {
        extras: { ...EXTRAS, strikeout_reached: true },
      }),
    ]);
    expect(s.AB).toBe(1);
    expect(s.SO).toBe(1);
    expect(s.strikeoutReached).toBe(1);
  });

  it("fielders_choice: AB+1 FC+1 H+0", () => {
    const s = aggregateBattingFromCells([cell("fielders_choice")]);
    expect(s.AB).toBe(1);
    expect(s.FC).toBe(1);
    expect(s.H).toBe(0);
  });

  it("error outcome: AB+1 ROE+1 H+0", () => {
    const s = aggregateBattingFromCells([cell("error")]);
    expect(s.AB).toBe(1);
    expect(s.ROE).toBe(1);
    expect(s.H).toBe(0);
  });

  it("batter interference (打撃妨害): AB+0 Int+1 PA+1", () => {
    const s = aggregateBattingFromCells([
      cell("interference", { extras: { ...EXTRAS, interference: "batter" } }),
    ]);
    expect(s.AB).toBe(0);
    expect(s.Int).toBe(1);
    expect(plateAppearancesOf(s)).toBe(1);
  });

  it("runner interference (走塁妨害): AB+1 Ob+1", () => {
    const s = aggregateBattingFromCells([
      cell("interference", { extras: { ...EXTRAS, interference: "runner" } }),
    ]);
    expect(s.AB).toBe(1);
    expect(s.Ob).toBe(1);
  });

  it("null outcome (blank cell) ignored", () => {
    expect(aggregateBattingFromCells([cell(null)])).toEqual(emptyBattingStats());
  });

  it("unknown outcome is skipped (low-conf retry pending)", () => {
    const s = aggregateBattingFromCells([cell("unknown")]);
    expect(s.AB).toBe(0);
    expect(plateAppearancesOf(s)).toBe(0);
  });

  // 回帰テスト: Phase E-4 レビューで検出された AB 二重計上バグ
  describe("extras precedence (no double-counting with outcome)", () => {
    it("extras.SH=true with outcome=ground_out → SH+1, AB=0 (not double-counted)", () => {
      const s = aggregateBattingFromCells([
        cell("ground_out", { extras: { ...EXTRAS, SH: true } }),
      ]);
      expect(s.SH).toBe(1);
      expect(s.AB).toBe(0);
    });

    it("extras.SF=true with outcome=fly_out → SF+1, AB=0", () => {
      const s = aggregateBattingFromCells([
        cell("fly_out", { extras: { ...EXTRAS, SF: true } }),
      ]);
      expect(s.SF).toBe(1);
      expect(s.AB).toBe(0);
    });

    it("extras.HBP=true with outcome!=hbp → HBP+1, AB=0", () => {
      const s = aggregateBattingFromCells([
        cell("unknown", { extras: { ...EXTRAS, HBP: true } }),
      ]);
      expect(s.HBP).toBe(1);
      expect(s.AB).toBe(0);
    });

    it("canonical sac_bunt still counts as SH only", () => {
      const s = aggregateBattingFromCells([cell("sac_bunt")]);
      expect(s.SH).toBe(1);
      expect(s.AB).toBe(0);
    });
  });
});

describe("computeBattingRates", () => {
  it("typical line: 4-for-10, 1 2B, 1 HR, 2 BB, 0 HBP, 1 SF → verify rates", () => {
    const s = {
      ...emptyBattingStats(),
      AB: 10,
      H: 4,
      "2B": 1,
      HR: 1,
      BB: 2,
      SF: 1,
      SO: 2,
    };
    const r = computeBattingRates(s);
    // AVG = 4/10 = .400
    expect(r.AVG).toBe(0.4);
    // OBP = (4+2+0) / (10+2+0+1) = 6/13 = .462 (四捨五入)
    expect(r.OBP).toBe(0.462);
    // 1B = 4 - 1 - 0 - 1 = 2; TB = 2 + 2*1 + 3*0 + 4*1 = 8; SLG = 8/10 = .800
    expect(r.SLG).toBe(0.8);
    // OPS = .462 + .800 = 1.262
    expect(r.OPS).toBeCloseTo(1.262, 3);
    // BABIP = (4-1) / (10-2-1+1) = 3/8 = .375
    expect(r.BABIP).toBe(0.375);
  });

  it("zero AB: rates are 0 (no NaN)", () => {
    const r = computeBattingRates({ ...emptyBattingStats(), BB: 2 });
    expect(r.AVG).toBe(0);
    expect(r.SLG).toBe(0);
    expect(Number.isNaN(r.OPS)).toBe(false);
  });

  it("OBP independent of SF: walk-only batter", () => {
    const r = computeBattingRates({ ...emptyBattingStats(), BB: 3 });
    // OBP = 3 / (0+3+0+0) = 1.000
    expect(r.OBP).toBe(1);
  });

  it("perfect 1.000 AVG: 3-for-3 all singles", () => {
    const r = computeBattingRates({
      ...emptyBattingStats(),
      AB: 3,
      H: 3,
    });
    expect(r.AVG).toBe(1);
    expect(r.SLG).toBe(1);
  });
});

describe("computePitchingRates", () => {
  it("6 IP, 3 ER, 5 SO, 2 BB, 7 H → ERA 4.50 / WHIP 1.500 / K/9 7.50 / BB/9 3.00 / K/BB 2.5", () => {
    const s = {
      ...emptyPitchingStats(),
      outs: 18,
      SO: 5,
      BB: 2,
      H: 7,
      R: 4,
      ER: 3,
      HR: 1,
    };
    const r = computePitchingRates(s);
    expect(r.ERA).toBe(4.5);
    expect(r.WHIP).toBe(1.5);
    expect(r.K9).toBe(7.5);
    expect(r.BB9).toBe(3);
    expect(r.KBB).toBe(2.5);
  });

  it("fractional IP 5 2/3 (17 outs), 2 ER → ERA = 9*2 / (17/3) = 3.1764... ≈ 3.18", () => {
    const s = {
      ...emptyPitchingStats(),
      outs: 17,
      ER: 2,
    };
    const r = computePitchingRates(s);
    expect(r.ERA).toBe(3.18);
  });

  it("zero IP: all rates are 0 (no Infinity)", () => {
    const r = computePitchingRates({ ...emptyPitchingStats() });
    expect(r.ERA).toBe(0);
    expect(r.WHIP).toBe(0);
    expect(r.K9).toBe(0);
    expect(r.BB9).toBe(0);
  });

  it("zero BB: KBB is null (∞ 防止)", () => {
    const s = {
      ...emptyPitchingStats(),
      outs: 9,
      SO: 5,
      BB: 0,
    };
    const r = computePitchingRates(s);
    expect(r.KBB).toBeNull();
  });
});
