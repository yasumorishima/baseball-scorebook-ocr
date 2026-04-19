/**
 * ルール検証結果の型定義。
 * docs/architecture.md §6 で定義した 8 種の検査に対応。
 */

import type { CellCoord } from "./grid.js";

export type ViolationSeverity = "error" | "warning";

export type ViolationKind =
  | "outs_per_inning"
  | "batting_order_continuity"
  | "reached_base_outcome_mismatch"
  | "diamond_reached_base_mismatch"
  | "runs_total_mismatch"
  | "pitcher_totals_mismatch"
  | "at_bats_mismatch"
  | "empty_cell_in_progress"
  /**
   * outcome と extras フラグが排他規則（waseda-system Single-representation rule）
   * に違反しているケース。たとえば outcome="walk" + extras.HBP=true のような
   * 二重表現。compute.ts の extras 優先ロジックで集計は正しく続行されるが、
   * OCR 側のプロンプト逸脱の兆候として warning に計上する。
   */
  | "extras_outcome_conflict"
  /**
   * 犠打・犠飛なのに打者本人が得点（reached_base=4）に到達しているケース。
   * 規則上は打者アウト or 一塁残のみが正常なので anomaly として warning。
   */
  | "sacrifice_batter_scored";

export type Violation = {
  kind: ViolationKind;
  severity: ViolationSeverity;
  message: string;
  /** 対象セル（複数あり得る） */
  cells?: CellCoord[];
  /** 該当イニング index（0-based） */
  inning?: number;
};

export type ValidationReport = {
  /** errors.length === 0 のとき true */
  valid: boolean;
  errors: Violation[];
  warnings: Violation[];
  /** イニングごとのアウト数（未了イニングは < 3 があり得る） */
  perInningOuts: number[];
  /** イニングごとの打順 sequence（途中交代検出に利用） */
  battingOrderSequence: number[][];
};
