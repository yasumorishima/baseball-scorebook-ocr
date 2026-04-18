/**
 * スコアブック版面の比率・領域・クロップ結果の型定義。
 *
 * 比率定数は docs/architecture.md §20.2（Seibido 9104 waseda、rotated 3300×2550 基準、
 * overlay 6 回反復で確定）と同期する。
 */

export type Ratio01 = number;

export type Rect = {
  /** 画像左上を (0,0) とする x 座標（pixel） */
  x: number;
  /** 画像左上を (0,0) とする y 座標（pixel） */
  y: number;
  width: number;
  height: number;
};

/**
 * 各論理領域の占有比率（0.0-1.0）。
 * x 方向: 左端 0、右端 1。y 方向: 上端 0、下端 1。
 */
export type ScorebookLayout = {
  /** 打順・選手列（左端から x=playerColRatio まで） */
  playerColRatio: Ratio01;
  /** スタッツ列（x=rightStatsRatio から右端まで） */
  rightStatsRatio: Ratio01;
  /** page_header（年月日・試合情報・チーム名）下端の y 比率 */
  pageHeaderBottom: Ratio01;
  /** inning_labels（"1 2 3 ... 13"）下端の y 比率 = play_grid 上端 */
  headerBottom: Ratio01;
  /** play_grid 下端の y 比率（totals_row 上端 = play_grid 下端） */
  playGridBottom: Ratio01;
  /** totals_row 下端の y 比率（pitcher_area 上端） */
  totalsRowBottom: Ratio01;
  /** pitcher_area 下端の y 比率（左下の投手ログ領域） */
  pitcherAreaBottom: Ratio01;
  /** イニング列の数（9 人制通常 13、延長考慮込み） */
  inningCount: number;
  /** 打順数（9〜11 可変） */
  batterCount: number;
};

/**
 * Seibido 9104 waseda 既定値（2026-04-19 overlay 6 回反復で確定）。
 * 画像は landscape 3300×2550 前提。
 */
export const SEIBIDO_9104_WASEDA: ScorebookLayout = {
  playerColRatio: 0.135,
  rightStatsRatio: 0.770,
  pageHeaderBottom: 0.080,
  headerBottom: 0.160,
  playGridBottom: 0.520,
  totalsRowBottom: 0.570,
  pitcherAreaBottom: 0.830,
  inningCount: 13,
  /** 草野球・練習試合で 10〜11 人打線あり得る（§20.3）。9 人制公式戦は 9、拡張は 10〜11 で切替。 */
  batterCount: 10,
};

/** 草野球・練習試合で 10〜11 人打線の場合に切替える。 */
export const SEIBIDO_9104_WASEDA_11: ScorebookLayout = {
  ...SEIBIDO_9104_WASEDA,
  batterCount: 11,
};

export const SEIBIDO_9104_WASEDA_9: ScorebookLayout = {
  ...SEIBIDO_9104_WASEDA,
  batterCount: 9,
};

/**
 * {@link cropInnings} の返却型。
 * innings は左から右の順で並ぶ。
 */
export type InningCropResult = {
  /** page_header（年月日・試合情報・審判・チーム名、§20.2 の y 0-0.080） */
  pageHeader: Buffer;
  /** inning_labels（"1 2 3 ... 13" 数字行、§20.2 の y 0.080-0.160） */
  inningLabels: Buffer;
  /** 打順・選手列 */
  player: Buffer;
  /** 各イニング列（左から右） */
  innings: Buffer[];
  /** 右端スタッツ列（打点・失策・犠打 等） */
  stats: Buffer;
  /** 合計行（安・失・四 の行、play_grid 下〜totals_row 下） */
  totals: Buffer;
  /** 投手ログ領域（下半分左） */
  pitcher: Buffer;
  /** 捕手・長打欄（下半分右） */
  catcher: Buffer;
  /** 切り出しに使った元画像の実サイズと各領域の pixel bounds（デバッグ用） */
  meta: {
    imageSize: { width: number; height: number };
    rects: {
      pageHeader: Rect;
      inningLabels: Rect;
      player: Rect;
      innings: Rect[];
      stats: Rect;
      totals: Rect;
      pitcher: Rect;
      catcher: Rect;
    };
  };
};
