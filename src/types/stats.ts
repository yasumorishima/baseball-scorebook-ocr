/**
 * 打撃・投球スタッツの型定義。
 * docs/architecture.md §7（NPB 公認野球規則 9.00 準拠）と同期。
 */

export type BattingStats = {
  /** 打数 */
  AB: number;
  /** 安打 */
  H: number;
  "2B": number;
  "3B": number;
  HR: number;
  /** 四球 */
  BB: number;
  /** 死球 */
  HBP: number;
  /** 犠打 */
  SH: number;
  /** 犠飛 */
  SF: number;
  /** 三振 */
  SO: number;
  /** 打撃妨害 */
  Int: number;
  /** 走塁妨害 */
  Ob: number;
  /** 野手選択 */
  FC: number;
  /** 出塁エラー（失策で出塁した回数） */
  ROE: number;
  /** 振り逃げ出塁 */
  strikeoutReached: number;
  /** 打点 */
  RBI: number;
  /** 得点 */
  R: number;
};

export type BattingRates = {
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
  BABIP: number;
};

/**
 * 投球回の内部表現（アウト数の整数）。
 * 表示時は {@link formatInnings} で「5 回 2/3」形式に整形する。
 */
export type InningsPitched = {
  outs: number;
};

export type PitchingStats = {
  /** 記録したアウト数 */
  outs: number;
  /** 奪三振 */
  SO: number;
  /** 与四球 */
  BB: number;
  /** 被安打 */
  H: number;
  /** 失点 */
  R: number;
  /** 自責点 */
  ER: number;
  /** 被本塁打 */
  HR: number;
  /** 投球数（取れる場合） */
  pitches: number | null;
};

export type PitchingRates = {
  ERA: number;
  WHIP: number;
  K9: number;
  BB9: number;
  /** BB > 0 のときのみ有効（0 割りは null） */
  KBB: number | null;
};

export type PlayerBattingLine = {
  playerId: string;
  playerName: string;
  stats: BattingStats;
  rates: BattingRates;
};

export type PlayerPitchingLine = {
  playerId: string;
  playerName: string;
  stats: PitchingStats;
  rates: PitchingRates;
};

export type TeamStats = {
  batting: PlayerBattingLine[];
  pitching: PlayerPitchingLine[];
  /** チーム合計（参考） */
  teamBatting?: BattingStats;
  teamPitching?: PitchingStats;
};
