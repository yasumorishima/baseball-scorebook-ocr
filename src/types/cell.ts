/**
 * セル（打席）読み取り結果の型定義。
 * docs/architecture.md §5.2 の Tool schema と対応。
 */

export type Outcome =
  | "single"
  | "double"
  | "triple"
  | "home_run"
  | "walk"
  | "hbp"
  | "strikeout_swinging"
  | "strikeout_looking"
  | "sac_bunt"
  | "sac_fly"
  | "fielders_choice"
  | "error"
  | "ground_out"
  | "fly_out"
  | "line_out"
  | "pop_out"
  | "interference"
  | "unknown";

export type Interference = "batter" | "runner" | null;

export type CellExtras = {
  /** 犠打 */
  SH: boolean;
  /** 犠飛 */
  SF: boolean;
  /** 死球 */
  HBP: boolean;
  /** 野手選択 */
  FC: boolean;
  /** エラー守備位置 */
  error_fielder: number | null;
  /** 盗塁到達塁（複数可） */
  stolen_bases: number[];
  passed_ball: boolean;
  wild_pitch: boolean;
  interference: Interference;
  /** 振り逃げで出塁したか */
  strikeout_reached: boolean;
};

export type PitchCount = {
  balls: number;
  strikes: number;
};

/**
 * 1 セル（1 打席）の OCR 読み取り結果。
 */
export type CellRead = {
  /** 打順 1〜11 */
  batting_order: number;
  /** イニング 1〜15 */
  inning: number;
  /** セル内の生記法（手書き文字列）。空セルは null */
  raw_notation: string | null;
  outcome: Outcome | null;
  fielders_involved: number[] | null;
  /** 到達塁 0=out / 1=1B / 2=2B / 3=3B / 4=得点 */
  reached_base: 0 | 1 | 2 | 3 | 4 | null;
  /** このセル完了時点のアウトカウント（1st/2nd/3rd out） */
  out_count_after: 1 | 2 | 3 | null;
  pitch_count: PitchCount | null;
  extras: CellExtras;
  /** OCR が何を見て判断したかの短い説明（CoT） */
  evidence: string;
  /** 0.0-1.0 */
  confidence: number;
  /** confidence < 0.7 時に ≥2 個提示 */
  alternatives: string[];
};

/**
 * 空セル用の既定 CellExtras（Few-shot で毎回書かない場合用）。
 */
export const EMPTY_CELL_EXTRAS: CellExtras = {
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
