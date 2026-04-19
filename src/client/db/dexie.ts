/**
 * Dexie クライアントスキーマ（docs/architecture.md §8.2 準拠）。
 *
 * Supabase 側テーブル名は snake_case（§8.3）ですが、クライアント層は
 * camelCase で扱い、同期レイヤ（`src/client/sync/`、Day 2 後半で実装予定）
 * で変換します。index 定義上の複合キー `[gameId+seq]` は (gameId, seq) の
 * UNIQUE 取得高速化用で、Supabase 側 UNIQUE (game_id, seq) と対応します。
 *
 * ブラウザ専用。Node / テスト環境では `getScorebookDb()` を呼ばないこと。
 */

import Dexie, { type Table } from "dexie";
import type {
  EventSource,
  GameEventEnvelope,
  GameEventType,
  OcrMetadata,
} from "@/src/types/event";

export type GameStatus = "in_progress" | "finished" | "suspended";

export type GameRow = {
  id: string;
  teamId: string;
  date: string;
  opponent: string;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
};

export type GameEventRow = {
  id: string;
  gameId: string;
  seq: number;
  ts: string;
  type: GameEventType;
  correctionOf: string | null;
  payload: unknown;
  authorUserId: string;
  source: EventSource;
  ocrMetadata: OcrMetadata | null;
};

export type PendingEventRow = {
  id: string;
  gameId: string;
  retryCount: number;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  envelope: GameEventEnvelope;
};

export type TeamRow = {
  id: string;
  ownerUserId: string;
  name: string;
  inviteCode: string;
};

export type TeamMemberRow = {
  teamId: string;
  userId: string;
  role: "owner" | "scorer" | "viewer";
  joinedAt: string;
};

export type PlayerRow = {
  id: string;
  teamId: string;
  displayName: string;
  uniformNumber: number | null;
  position: number | null;
};

export class ScorebookDexie extends Dexie {
  games!: Table<GameRow, string>;
  gameEvents!: Table<GameEventRow, string>;
  pendingEvents!: Table<PendingEventRow, string>;
  teams!: Table<TeamRow, string>;
  teamMembers!: Table<TeamMemberRow, [string, string]>;
  players!: Table<PlayerRow, string>;

  constructor() {
    super("scorebook");

    this.version(1).stores({
      games: "&id, teamId, date, status",
      gameEvents: "&id, gameId, seq, [gameId+seq], ts",
      pendingEvents: "&id, gameId, retryCount",
      teams: "&id, ownerUserId, inviteCode",
      teamMembers: "&[teamId+userId], teamId, userId",
      players: "&id, teamId",
    });
  }
}

let cachedDb: ScorebookDexie | null = null;

export function getScorebookDb(): ScorebookDexie {
  if (typeof window === "undefined") {
    throw new Error(
      "getScorebookDb() はブラウザ専用です。サーバコンポーネントから呼ばないでください。",
    );
  }
  if (!cachedDb) {
    cachedDb = new ScorebookDexie();
  }
  return cachedDb;
}

/** テスト専用。IndexedDB を閉じ、シングルトンを破棄します。 */
export function resetScorebookDb(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
  }
}
