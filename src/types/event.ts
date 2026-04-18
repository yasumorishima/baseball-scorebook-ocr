/**
 * イベントソーシング用のイベント型定義。
 *
 * docs/architecture.md §8.1 / §8.3 の Supabase `game_events` スキーマと同期:
 *   - type: plate_appearance | substitution | correction | inning_end | game_end
 *   - correction_of: 訂正対象の元 event id（append-only、in-place 更新なし）
 *   - source: "manual" | "ocr"
 *   - ocr_metadata: confidence / evidence / alternatives / raw_notation / image_path
 *
 * UNIQUE (gameId, seq)。再送は on conflict (id) do nothing で冪等化。
 */

/**
 * §8.1 Supabase スキーマ準拠。5 種のみ。
 * - `plate_appearance`: 打席完了
 * - `substitution`: 守備交代 / 代打 / 代走 / 投手交代（kind でサブ分類）
 * - `correction`: 既存イベントの訂正（`correctionOf` に元 event id）
 * - `inning_end`: イニング終了（攻守交代）
 * - `game_end`: 試合終了
 */
export type GameEventType =
  | "plate_appearance"
  | "substitution"
  | "correction"
  | "inning_end"
  | "game_end";

export type EventSource = "manual" | "ocr";

/**
 * OCR 由来イベントに付与するメタデータ（§8.1 `ocr_metadata`）。
 * Supabase 側は `jsonb` で保存。
 */
export type OcrMetadata = {
  confidence: number;
  evidence: string;
  alternatives: string[];
  raw_notation: string | null;
  /** S3 / Supabase Storage 上の画像 key or URL */
  image_path: string;
};

/**
 * `game_events` テーブル行に対応する envelope。
 * Supabase スキーマのカラム名は snake_case、アプリ層 TS は camelCase。
 */
export type GameEventEnvelope<T = unknown> = {
  /** UUID v7（時刻ソート可能） */
  eventId: string;
  gameId: string;
  /** 1 試合内での連番（UNIQUE (gameId, seq)） */
  seq: number;
  /** ISO 8601、サーバ側タイムスタンプ */
  ts: string;
  type: GameEventType;
  /** 訂正イベント（type === "correction"）の場合のみ、元イベント id */
  correctionOf?: string;
  /** 型ごとのペイロード（jsonb 保存） */
  payload: T;
  authorUserId: string;
  source: EventSource;
  /** OCR 由来 (source="ocr") の場合のみ */
  ocrMetadata?: OcrMetadata;
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

/** 交代イベントのペイロード（守備交代・代打・代走・投手交代を統合） */
export type SubstitutionPayload = {
  kind: "defensive" | "pinch_hitter" | "pinch_runner" | "pitching_change";
  inning: number;
  /** 交代で下がる選手 */
  outPlayerId: string;
  /** 新しく入る選手 */
  inPlayerId: string;
  /** 新しい守備位置（defensive / pitching_change 時のみ） */
  newPosition: number | null;
  /** pitching_change 時のみ、交代直前の投手が記録したアウト数合計 */
  outPitcherOutsRecorded?: number;
};

/** 訂正イベントのペイロード */
export type CorrectionPayload = {
  /** 修正前の JSON（任意） */
  before: unknown;
  /** 修正後の JSON */
  after: unknown;
  note: string | null;
};

/** イニング終了（攻守交代） */
export type InningEndPayload = {
  inning: number;
  /** "top" = 表、"bottom" = 裏 */
  half: "top" | "bottom";
};

/** 試合終了 */
export type GameEndPayload = {
  finalInning: number;
  /** 終了事由 */
  reason: "regulation" | "mercy_rule" | "time_limit" | "forfeit" | "suspended";
};
