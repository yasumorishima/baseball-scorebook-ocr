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
  | "empty_cell_in_progress";

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
