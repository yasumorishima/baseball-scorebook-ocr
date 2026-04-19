/**
 * Supabase Realtime **Broadcast** チャネル購読ヘルパ
 * （docs/architecture.md §9.1）。
 *
 * Postgres Changes ではなく Broadcast を採用する理由:
 * - Broadcast は 1 game_id = 1 チャネルで listener を張れるので fan-out コスト低
 * - Postgres Changes は大規模になると replication 経路が詰まる（公式推奨理由）
 * - SECURITY DEFINER トリガから `realtime.broadcast_changes()` を発火する方式で
 *   auth.uid() コンテキストを確実に伝搬できる
 *
 * SQL 側は `supabase/migrations/0001_init.sql` の trg_broadcast_game_event を参照。
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import type { GameEventEnvelope } from "@/src/types/event";
import { supabaseRowToEnvelope } from "@/src/client/sync/envelope-convert";
import type { SupabaseGameEventRow } from "@/src/client/sync/envelope-convert";

export type GameEventBroadcastListener = (
  envelope: GameEventEnvelope,
) => void | Promise<void>;

export type BroadcastSubscription = {
  channel: RealtimeChannel;
  unsubscribe: () => Promise<void>;
};

/**
 * 指定 gameId のイベントを購読。trigger が `realtime.broadcast_changes()`
 * 経由で送った row (snake_case) を envelope (camelCase + `undefined` 正規化)
 * に変換してから listener に渡す。
 */
export function subscribeGameEvents(
  client: SupabaseClient,
  gameId: string,
  listener: GameEventBroadcastListener,
): BroadcastSubscription {
  const channel = client.channel(`game:${gameId}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  channel.on("broadcast", { event: "*" }, ({ payload }) => {
    // trigger は常に `jsonb_build_object('record', row_to_json(new))` を送る
    // ので `payload.record` は必ず存在する前提。fallback を置くと shape が
    // 変わったときに silent に壊れるので、record が無ければ warn + drop。
    const envelope = (payload as { record?: SupabaseGameEventRow } | null)
      ?.record;
    if (!envelope) {
      console.warn(
        "[realtime] broadcast payload missing .record — shape mismatch. Trigger out of sync?",
        payload,
      );
      return;
    }
    void listener(supabaseRowToEnvelope(envelope));
  });

  void channel.subscribe();

  return {
    channel,
    unsubscribe: async () => {
      await client.removeChannel(channel);
    },
  };
}
