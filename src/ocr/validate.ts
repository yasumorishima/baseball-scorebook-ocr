/**
 * OCR 結果（Grid<CellRead>）のルールベース検証。
 *
 * docs/architecture.md §6.1 / §6.2 準拠。
 *
 * 検査 8 種のうち Day 1 で実装するのは 4 種:
 *   ✓ #1 outs_per_inning               ≤3 per inning; =3 except last unfinished
 *   ✓ #2 batting_order_continuity      打順連続性
 *   ✓ #3 reached_base_outcome_mismatch outcome ↔ reached_base 整合
 *   ✓ #8 empty_cell_in_progress        進行中イニングの空セル warning
 *
 * Day 2 で追加:
 *   - #4 diamond_reached_base_mismatch （菱形観測値 vs reached_base、model 側 CoT で代替中）
 *   - #5 runs_total_mismatch           （合計行 OCR が必要）
 *   - #6 pitcher_totals_mismatch       （投手ログ OCR が必要）
 *   - #7 at_bats_mismatch              （stats/compute との連携で判定）
 *
 * fail-closed: `errors.length > 0` なら自動保存しない（§6.2）。
 */

import type { CellRead, Outcome } from "../types/cell.js";
import type { Grid } from "../types/grid.js";
import type {
  ValidationReport,
  Violation,
  ViolationKind,
} from "../types/validation.js";

const OUT_OUTCOMES: ReadonlySet<Outcome> = new Set<Outcome>([
  "strikeout_swinging",
  "strikeout_looking",
  "ground_out",
  "fly_out",
  "line_out",
  "pop_out",
]);

const HIT_BASES: Partial<Record<Outcome, 1 | 2 | 3 | 4>> = {
  single: 1,
  double: 2,
  triple: 3,
  home_run: 4,
};

export type ValidateOptions = {
  /** true なら最終イニングの未了（< 3 outs）は warning 扱い、false なら error */
  allowUnfinishedLastInning?: boolean;
  /** 試合が現在どのイニングで止まっているか（inclusive, 1-based）。未指定なら最終埋まりイニングを推定 */
  lastPlayedInning?: number;
};

export function validateGrid(
  grid: Grid<CellRead>,
  options: ValidateOptions = {},
): ValidationReport {
  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  const batterCount = grid.length;
  const inningCount = batterCount > 0 ? grid[0].length : 0;

  const { perInningOuts, battingOrderSequence } = summarizeGrid(grid, inningCount);

  const lastFilledInning = detectLastInningWithCells(grid);
  const lastPlayedInning =
    options.lastPlayedInning ?? (lastFilledInning > 0 ? lastFilledInning : 0);
  const allowUnfinished = options.allowUnfinishedLastInning ?? true;

  // ── #1 outs_per_inning ──────────────────────────────────
  for (let ii = 0; ii < inningCount; ii++) {
    const outs = perInningOuts[ii];
    if (outs > 3) {
      errors.push(
        violation(
          "outs_per_inning",
          "error",
          `inning ${ii + 1}: recorded outs = ${outs}, cannot exceed 3`,
          { inning: ii },
        ),
      );
    } else if (outs < 3 && ii + 1 < lastPlayedInning) {
      errors.push(
        violation(
          "outs_per_inning",
          "error",
          `inning ${ii + 1}: only ${outs} outs recorded but inning is not the last (${lastPlayedInning})`,
          { inning: ii },
        ),
      );
    } else if (outs < 3 && ii + 1 === lastPlayedInning) {
      if (!allowUnfinished) {
        errors.push(
          violation(
            "outs_per_inning",
            "error",
            `inning ${ii + 1}: only ${outs} outs in (final) inning`,
            { inning: ii },
          ),
        );
      } else {
        warnings.push(
          violation(
            "outs_per_inning",
            "warning",
            `inning ${ii + 1}: only ${outs} outs (last inning, unfinished)`,
            { inning: ii },
          ),
        );
      }
    }
  }

  // ── #2 batting_order_continuity ─────────────────────────
  for (let ii = 0; ii < inningCount; ii++) {
    const seq = battingOrderSequence[ii];
    if (seq.length < 2) continue;
    // 同一イニング内の打順は単調増加し、かつ隣接差は +1 or (batterCount を跨ぐ +1 が 1 に戻る)
    for (let k = 1; k < seq.length; k++) {
      const prev = seq[k - 1];
      const cur = seq[k];
      const expected = (prev % batterCount) + 1;
      if (cur !== expected) {
        errors.push(
          violation(
            "batting_order_continuity",
            "error",
            `inning ${ii + 1}: batting order went ${prev} → ${cur} (expected → ${expected})`,
            {
              inning: ii,
              cells: [
                { batting_order: prev, inning: ii + 1 },
                { batting_order: cur, inning: ii + 1 },
              ],
            },
          ),
        );
      }
    }
  }

  // ── #3 reached_base_outcome_mismatch ─────────────────────
  for (let bi = 0; bi < batterCount; bi++) {
    for (let ii = 0; ii < inningCount; ii++) {
      const cell = grid[bi][ii];
      if (cell == null || cell.outcome == null) continue;

      // out outcomes → reached_base must be 0 unless strikeout_reached (振り逃げ)
      if (
        OUT_OUTCOMES.has(cell.outcome) &&
        !cell.extras.strikeout_reached &&
        cell.reached_base !== 0 &&
        cell.reached_base !== null
      ) {
        errors.push(
          violation(
            "reached_base_outcome_mismatch",
            "error",
            `cell (${cell.batting_order}, ${cell.inning}): outcome=${cell.outcome} but reached_base=${cell.reached_base}`,
            { cells: [{ batting_order: cell.batting_order, inning: cell.inning }] },
          ),
        );
      }
      // hit outcomes → reached_base must be >= the hit's base number
      const hitBase = HIT_BASES[cell.outcome];
      if (
        hitBase != null &&
        cell.reached_base != null &&
        cell.reached_base < hitBase
      ) {
        errors.push(
          violation(
            "reached_base_outcome_mismatch",
            "error",
            `cell (${cell.batting_order}, ${cell.inning}): outcome=${cell.outcome} but reached_base=${cell.reached_base} < ${hitBase}`,
            { cells: [{ batting_order: cell.batting_order, inning: cell.inning }] },
          ),
        );
      }
    }
  }

  // ── #8 empty_cell_in_progress ────────────────────────────
  // 対象: 進行中の試合で途中に空セルがある場合
  //   同一イニングで batting_order k が埋まっているが k-1 が空 → warning
  for (let ii = 0; ii < inningCount; ii++) {
    for (let bi = 1; bi < batterCount; bi++) {
      const cur = grid[bi][ii];
      const prev = grid[bi - 1][ii];
      if (cur != null && prev == null) {
        warnings.push(
          violation(
            "empty_cell_in_progress",
            "warning",
            `inning ${ii + 1}: batter ${bi + 1} filled but batter ${bi} is empty`,
            {
              inning: ii,
              cells: [
                { batting_order: bi, inning: ii + 1 },
                { batting_order: bi + 1, inning: ii + 1 },
              ],
            },
          ),
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    perInningOuts,
    battingOrderSequence,
  };
}

// ── helpers ───────────────────────────────────────────────

function summarizeGrid(
  grid: Grid<CellRead>,
  inningCount: number,
): {
  perInningOuts: number[];
  battingOrderSequence: number[][];
} {
  const perInningOuts = new Array<number>(inningCount).fill(0);
  const battingOrderSequence: number[][] = Array.from(
    { length: inningCount },
    () => [],
  );
  // 打順順（上→下）にイニング単位で走査
  for (let ii = 0; ii < inningCount; ii++) {
    for (let bi = 0; bi < grid.length; bi++) {
      const cell = grid[bi][ii];
      if (cell == null) continue;
      battingOrderSequence[ii].push(cell.batting_order);
      const isOut =
        cell.outcome != null &&
        OUT_OUTCOMES.has(cell.outcome) &&
        !cell.extras.strikeout_reached;
      if (isOut) perInningOuts[ii] += 1;
      // sac_bunt / sac_fly / fielders_choice で打者がアウトになるケースも out_count_after で拾う
      // （reached_base=0 & out_count_after!=null を out として計上）
      else if (
        cell.outcome != null &&
        cell.out_count_after != null &&
        cell.reached_base === 0
      ) {
        perInningOuts[ii] += 1;
      }
    }
  }
  return { perInningOuts, battingOrderSequence };
}

function detectLastInningWithCells(grid: Grid<CellRead>): number {
  const inningCount = grid.length > 0 ? grid[0].length : 0;
  for (let ii = inningCount - 1; ii >= 0; ii--) {
    for (let bi = 0; bi < grid.length; bi++) {
      if (grid[bi][ii] != null) return ii + 1;
    }
  }
  return 0;
}

function violation(
  kind: ViolationKind,
  severity: "error" | "warning",
  message: string,
  extra: { inning?: number; cells?: Violation["cells"] } = {},
): Violation {
  return {
    kind,
    severity,
    message,
    ...(extra.cells ? { cells: extra.cells } : {}),
    ...(extra.inning != null ? { inning: extra.inning } : {}),
  };
}
