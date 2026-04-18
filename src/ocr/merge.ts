/**
 * Stage 2 各列の結果を Grid<CellRead> に統合。
 *
 * docs/architecture.md §5.3 準拠。
 *
 * - 入力: N 個の Stage2ColumnResult + batterCount + inningCount
 * - 出力: Grid<CellRead>（打順 index × イニング index）＋マージメタ
 * - 衝突解決: 同一セルが複数列から報告された場合 confidence が高い方を採用
 *   （通常は Stage 1 の per-inning crop 方針のため衝突しない、Day 2 の overlap 考慮）
 */

import { createEmptyGrid, type Grid } from "../types/grid.js";
import type { CellRead } from "../types/cell.js";
import type { Stage2ColumnResult } from "./stage2-extract-cells.js";

export type MergeReport = {
  grid: Grid<CellRead>;
  /** 埋まったセル数（null ではないセル） */
  filledCount: number;
  /** 報告されたがスキップしたセル（範囲外打順・イニング） */
  droppedCells: Array<{ reason: string; cell: CellRead }>;
  /** 衝突して低 confidence 側を捨てたケース */
  conflicts: Array<{
    coord: { batting_order: number; inning: number };
    kept: CellRead;
    dropped: CellRead;
  }>;
  /** confidence ヒストグラム（高・中・低） */
  confidenceHist: { high: number; mid: number; low: number };
};

export type MergeOptions = {
  batterCount: number;
  inningCount: number;
};

export function mergeStage2Results(
  columns: Stage2ColumnResult[],
  options: MergeOptions,
): MergeReport {
  const { batterCount, inningCount } = options;
  const grid = createEmptyGrid<CellRead>({ batterCount, inningCount });
  const droppedCells: MergeReport["droppedCells"] = [];
  const conflicts: MergeReport["conflicts"] = [];

  for (const col of columns) {
    for (const cell of col.response.cells) {
      // 範囲チェック
      if (
        cell.batting_order < 1 ||
        cell.batting_order > batterCount ||
        cell.inning < 1 ||
        cell.inning > inningCount
      ) {
        droppedCells.push({
          reason: `out of bounds: batting_order=${cell.batting_order}, inning=${cell.inning} (expected 1..${batterCount} × 1..${inningCount})`,
          cell,
        });
        continue;
      }
      const bi = cell.batting_order - 1;
      const ii = cell.inning - 1;
      const existing = grid[bi][ii];
      if (existing == null) {
        grid[bi][ii] = cell;
      } else if (cell.confidence > existing.confidence) {
        conflicts.push({
          coord: { batting_order: cell.batting_order, inning: cell.inning },
          kept: cell,
          dropped: existing,
        });
        grid[bi][ii] = cell;
      } else {
        conflicts.push({
          coord: { batting_order: cell.batting_order, inning: cell.inning },
          kept: existing,
          dropped: cell,
        });
      }
    }
  }

  let filledCount = 0;
  const hist = { high: 0, mid: 0, low: 0 };
  for (let bi = 0; bi < batterCount; bi++) {
    for (let ii = 0; ii < inningCount; ii++) {
      const cell = grid[bi][ii];
      if (cell == null) continue;
      filledCount += 1;
      if (cell.confidence >= 0.8) hist.high += 1;
      else if (cell.confidence >= 0.5) hist.mid += 1;
      else hist.low += 1;
    }
  }

  return { grid, filledCount, droppedCells, conflicts, confidenceHist: hist };
}

/** grid を CellRead[] にフラット化（validate / retry で便利）。 */
export function flattenGrid(grid: Grid<CellRead>): CellRead[] {
  const out: CellRead[] = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell != null) out.push(cell);
    }
  }
  return out;
}

/** confidence < threshold のセルだけ抽出（retry 用）。 */
export function findLowConfidenceCells(
  grid: Grid<CellRead>,
  threshold: number,
): CellRead[] {
  return flattenGrid(grid).filter((c) => c.confidence < threshold);
}
