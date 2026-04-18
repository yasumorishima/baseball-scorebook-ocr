/**
 * 打順 × イニング グリッド表現。
 * docs/architecture.md §5.3 merge.ts が生成する 2 次元構造。
 */

import type { CellRead } from "./cell.js";

export type CellCoord = {
  batting_order: number;
  inning: number;
};

/**
 * grid[batting_order_index][inning_index]。
 * batting_order_index は 0-based（index=0 は打順 1 番）。
 * inning_index も 0-based（index=0 は 1 回）。
 * セルが未読取 / 空の場合は null。
 */
export type Grid<T = CellRead> = (T | null)[][];

export type GridDimensions = {
  batterCount: number;
  inningCount: number;
};

/** 空のグリッド（全セル null）を生成。 */
export function createEmptyGrid<T = CellRead>(dims: GridDimensions): Grid<T> {
  return Array.from({ length: dims.batterCount }, () =>
    Array.from({ length: dims.inningCount }, () => null as T | null),
  );
}
