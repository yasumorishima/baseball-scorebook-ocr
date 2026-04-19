/**
 * GameEventEnvelope と永続化境界の相互変換。
 *
 * 3 つの表現が存在する:
 * - **envelope (app 層)**: camelCase、optional は `?:` (undefined)
 * - **Dexie row (IndexedDB)**: camelCase、optional は `null` 統一
 * - **Supabase row (PostgreSQL)**: snake_case、optional は `null` 統一
 *
 * sync layer がこの 3 境界を全て通るので、変換関数は単一ファイルに集約する。
 * 変換は純粋関数 + Node 上で回るので vitest (node 環境) でテスト可能。
 *
 * docs/architecture.md §8.1 / §8.3
 */

import type { GameEventRow } from "@/src/client/db/dexie";
import type {
  EventSource,
  GameEventEnvelope,
  GameEventType,
  OcrMetadata,
} from "@/src/types/event";

/**
 * Supabase `game_events` テーブルの row shape。§8.3 のカラム順で定義。
 */
export type SupabaseGameEventRow = {
  id: string;
  game_id: string;
  seq: number;
  ts: string;
  type: GameEventType;
  correction_of: string | null;
  payload: unknown;
  author_user_id: string;
  source: EventSource;
  ocr_metadata: OcrMetadata | null;
};

// ---------- Envelope ⇄ Dexie row ----------

export function envelopeToDexieRow<T>(env: GameEventEnvelope<T>): GameEventRow {
  return {
    id: env.eventId,
    gameId: env.gameId,
    seq: env.seq,
    ts: env.ts,
    type: env.type,
    correctionOf: env.correctionOf ?? null,
    payload: env.payload,
    authorUserId: env.authorUserId,
    source: env.source,
    ocrMetadata: env.ocrMetadata ?? null,
  };
}

export function dexieRowToEnvelope<T = unknown>(
  row: GameEventRow,
): GameEventEnvelope<T> {
  const envelope: GameEventEnvelope<T> = {
    eventId: row.id,
    gameId: row.gameId,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    payload: row.payload as T,
    authorUserId: row.authorUserId,
    source: row.source,
  };
  if (row.correctionOf !== null) envelope.correctionOf = row.correctionOf;
  if (row.ocrMetadata !== null) envelope.ocrMetadata = row.ocrMetadata;
  return envelope;
}

// ---------- Envelope ⇄ Supabase row ----------

export function envelopeToSupabaseRow<T>(
  env: GameEventEnvelope<T>,
): SupabaseGameEventRow {
  return {
    id: env.eventId,
    game_id: env.gameId,
    seq: env.seq,
    ts: env.ts,
    type: env.type,
    correction_of: env.correctionOf ?? null,
    payload: env.payload,
    author_user_id: env.authorUserId,
    source: env.source,
    ocr_metadata: env.ocrMetadata ?? null,
  };
}

export function supabaseRowToEnvelope<T = unknown>(
  row: SupabaseGameEventRow,
): GameEventEnvelope<T> {
  const envelope: GameEventEnvelope<T> = {
    eventId: row.id,
    gameId: row.game_id,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    payload: row.payload as T,
    authorUserId: row.author_user_id,
    source: row.source,
  };
  if (row.correction_of !== null) envelope.correctionOf = row.correction_of;
  if (row.ocr_metadata !== null) envelope.ocrMetadata = row.ocr_metadata;
  return envelope;
}
