/**
 * NPB 公認野球規則 9.00 準拠のスタッツ集計 + レート算出。
 *
 * docs/architecture.md §7 / NPB 規則 9.02 / 9.04 / 9.23 準拠。
 *
 * - 打者: AB/H/2B/3B/HR/BB/HBP/SH/SF/SO/Int/Ob/FC/ROE/strikeoutReached/RBI/R
 * - 投手: outs/SO/BB/H/R/ER/HR/pitches
 * - レート: AVG/OBP/SLG/OPS/BABIP（打撃）、ERA/WHIP/K9/BB9/KBB（投球）
 * - 0 割り: 分母 0 のとき 0 を返す（KBB のみ null 許容）
 */

import type { CellRead, Outcome } from "../types/cell.js";
import type {
  BattingRates,
  BattingStats,
  PitchingRates,
  PitchingStats,
} from "../types/stats.js";

export function emptyBattingStats(): BattingStats {
  return {
    AB: 0,
    H: 0,
    "2B": 0,
    "3B": 0,
    HR: 0,
    BB: 0,
    HBP: 0,
    SH: 0,
    SF: 0,
    SO: 0,
    Int: 0,
    Ob: 0,
    FC: 0,
    ROE: 0,
    strikeoutReached: 0,
    RBI: 0,
    R: 0,
  };
}

export function emptyPitchingStats(): PitchingStats {
  return {
    outs: 0,
    SO: 0,
    BB: 0,
    H: 0,
    R: 0,
    ER: 0,
    HR: 0,
    pitches: null,
  };
}

/**
 * CellRead 配列（= 1 打者の全打席 or 全セル）から BattingStats を集計。
 *
 * outcome と extras に基づき NPB 規則の通り加算する。
 */
export function aggregateBattingFromCells(cells: CellRead[]): BattingStats {
  const s = emptyBattingStats();
  for (const cell of cells) {
    applyCell(s, cell);
  }
  return s;
}

function applyCell(s: BattingStats, cell: CellRead): void {
  if (cell.outcome == null) return;

  switch (cell.outcome) {
    case "single":
      s.AB += 1;
      s.H += 1;
      break;
    case "double":
      s.AB += 1;
      s.H += 1;
      s["2B"] += 1;
      break;
    case "triple":
      s.AB += 1;
      s.H += 1;
      s["3B"] += 1;
      break;
    case "home_run":
      s.AB += 1;
      s.H += 1;
      s.HR += 1;
      break;
    case "walk":
      s.BB += 1;
      break;
    case "hbp":
      s.HBP += 1;
      break;
    case "strikeout_swinging":
    case "strikeout_looking":
      s.AB += 1;
      s.SO += 1;
      if (cell.extras.strikeout_reached) {
        s.strikeoutReached += 1;
      }
      break;
    case "sac_bunt":
      s.SH += 1;
      break;
    case "sac_fly":
      s.SF += 1;
      break;
    case "fielders_choice":
      s.AB += 1;
      s.FC += 1;
      break;
    case "error":
      s.AB += 1;
      s.ROE += 1;
      break;
    case "ground_out":
    case "fly_out":
    case "line_out":
    case "pop_out":
      s.AB += 1;
      break;
    case "interference":
      if (cell.extras.interference === "batter") {
        // 打撃妨害: 打者は出塁、AB・at-bat にカウントせず PA のみ
        s.Int += 1;
      } else if (cell.extras.interference === "runner") {
        // 走塁妨害: 記録上 out（AB にカウント、走者の Ob として扱う）
        s.AB += 1;
        s.Ob += 1;
      } else {
        // 不明な interference 方向は数値集計から除外（OCR 側で補正待ち）
        s.Int += 1;
      }
      break;
    case "unknown":
      // 不明な outcome は集計から除外（低信頼セルとして retry 済みの前提）
      return;
  }

  // extras（outcome と独立のフラグ）
  if (cell.extras.SH && cell.outcome !== "sac_bunt") s.SH += 1;
  if (cell.extras.SF && cell.outcome !== "sac_fly") s.SF += 1;
  if (cell.extras.HBP && cell.outcome !== "hbp") s.HBP += 1;

  // 得点: 自打者が到達塁 4（得点）に達したセル
  if (cell.reached_base === 4) {
    s.R += 1;
  }
}

// ── レート算出 ───────────────────────────────────────────

export function computeBattingRates(stats: BattingStats): BattingRates {
  const singles = stats.H - stats["2B"] - stats["3B"] - stats.HR;
  const totalBases = singles + 2 * stats["2B"] + 3 * stats["3B"] + 4 * stats.HR;

  const obpDenom = stats.AB + stats.BB + stats.HBP + stats.SF;
  const obpNum = stats.H + stats.BB + stats.HBP;

  const babipDenom = stats.AB - stats.SO - stats.HR + stats.SF;
  const babipNum = stats.H - stats.HR;

  const AVG = safeDiv(stats.H, stats.AB);
  const OBP = safeDiv(obpNum, obpDenom);
  const SLG = safeDiv(totalBases, stats.AB);
  const BABIP = babipDenom > 0 ? babipNum / babipDenom : 0;

  return {
    AVG: round3(AVG),
    OBP: round3(OBP),
    SLG: round3(SLG),
    OPS: round3(OBP + SLG),
    BABIP: round3(BABIP),
  };
}

export function computePitchingRates(stats: PitchingStats): PitchingRates {
  const ip = stats.outs / 3;
  const ERA = ip > 0 ? (9 * stats.ER) / ip : 0;
  const WHIP = ip > 0 ? (stats.BB + stats.H) / ip : 0;
  const K9 = ip > 0 ? (9 * stats.SO) / ip : 0;
  const BB9 = ip > 0 ? (9 * stats.BB) / ip : 0;
  const KBB = stats.BB > 0 ? stats.SO / stats.BB : null;
  return {
    ERA: round2(ERA),
    WHIP: round3(WHIP),
    K9: round2(K9),
    BB9: round2(BB9),
    KBB: KBB == null ? null : round2(KBB),
  };
}

// ── 導出ヘルパ ───────────────────────────────────────────

/** BattingStats から 1B（単打数）を導出（H - 2B - 3B - HR）。 */
export function singlesOf(stats: BattingStats): number {
  return stats.H - stats["2B"] - stats["3B"] - stats.HR;
}

/** BattingStats から PA（打席数）を導出: AB + BB + HBP + SH + SF + Int。 */
export function plateAppearancesOf(stats: BattingStats): number {
  return stats.AB + stats.BB + stats.HBP + stats.SH + stats.SF + stats.Int;
}

// ── 内部ユーティリティ ───────────────────────────────────

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/** 打率系: 小数第 3 位（.333 形式） */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** ERA/K9/BB9/KBB: 小数第 2 位（3.75） */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
