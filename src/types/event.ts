/**
 * イベントソーシング用のイベント型定義。
 * docs/architecture.md §8.1 append-only、(game_id, seq) UNIQUE。
 */

export type GameEventType =
  | "plate_appearance"
  | "substitution"
  | "inning_change"
  | "pitching_change"
  | "game_start"
  | "game_end"
  | "manual_correction";

/**
 * 1 試合内で連番 (seq) を持つ。UUID v7（時刻ソート可能）で event_id を採る。
 */
export type GameEventEnvelope<T = unknown> = {
  /** UUID v7 */
  eventId: string;
  gameId: string;
  /** 1 試合内での連番（append-only、UNIQUE (gameId, seq)） */
  seq: number;
  type: GameEventType;
  /** ISO 8601、サーバ側タイムスタンプ */
  occurredAt: string;
  /** 作成者（player UUID or device id） */
  actorId: string;
  /** 型ごとのペイロード */
  payload: T;
};

/** 打席イベントのペイロード（CellRead 由来の集約済み情報） */
export type PlateAppearancePayload = {
  batting_order: number;
  inning: number;
  batterId: string;
  pitcherId: string;
  outcome: string;
  reached_base: 0 | 1 | 2 | 3 | 4;
  rbi: number;
  runs: number;
  raw_notation: string | null;
  /** 低信頼セルだった場合、人間レビュー済みか */
  humanReviewed: boolean;
  sourceCellConfidence: number;
};

/** 交代イベントのペイロード（守備交代・代打・代走） */
export type SubstitutionPayload = {
  kind: "defensive" | "pinch_hitter" | "pinch_runner";
  inning: number;
  /** 交代で下がる選手 */
  outPlayerId: string;
  /** 新しく入る選手 */
  inPlayerId: string;
  /** 新しい守備位置（defensive 時のみ） */
  newPosition: number | null;
};

/** 投手交代 */
export type PitchingChangePayload = {
  inning: number;
  /** 交代直前の投手が記録したアウト数合計 */
  outPitcherOutsRecorded: number;
  outPitcherId: string;
  inPitcherId: string;
};

/** イニング切替（攻守交代） */
export type InningChangePayload = {
  inning: number;
  /** "top" = 表、"bottom" = 裏 */
  half: "top" | "bottom";
};

/** 手動修正（人間がレビューで書き換えた場合） */
export type ManualCorrectionPayload = {
  targetEventId: string;
  /** 修正前の JSON（任意） */
  before: unknown;
  /** 修正後の JSON */
  after: unknown;
  note: string | null;
};
