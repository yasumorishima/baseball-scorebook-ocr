/**
 * アプリ層同期キュー flush（docs/architecture.md §9.2、Safari フォールバック）。
 *
 * Serwist BackgroundSyncQueue は Safari で動かないので、アプリ層 Dexie
 * `pendingEvents` を以下タイミングで `POST /api/events` に送り直す:
 * - `window.addEventListener("online", ...)` で回線復帰時
 * - アプリ起動時（`useEffect` + `getScorebookDb()` 後）
 *
 * 冪等性は `(gameId, seq)` UNIQUE + `id` UUID v7 で担保（§8.1）、
 * 5xx は server 側キャッシュせず再試行、`retryCount` をインクリメントして
 * 上限超過で manual review UI に出す想定（本ファイルは flush ループのみ）。
 *
 * このファイルは DOM / fetch / Dexie を触るのでブラウザ専用。
 */

import type { ScorebookDexie, PendingEventRow } from "@/src/client/db/dexie";
import { envelopeToSupabaseRow } from "@/src/client/sync/envelope-convert";

export type FlushOutcome = {
  attempted: number;
  succeeded: number;
  failed: number;
  lastError: string | null;
};

export type FlushOptions = {
  /** 送信先エンドポイント。既定は `/api/events`。 */
  endpoint?: string;
  /** 1 回 flush で処理する最大件数。既定 100。 */
  maxBatch?: number;
  /** 直列送信用 fetch。テスト差し込み可能。 */
  fetchImpl?: typeof fetch;
};

export async function flushPendingEvents(
  db: ScorebookDexie,
  options: FlushOptions = {},
): Promise<FlushOutcome> {
  const endpoint = options.endpoint ?? "/api/events";
  const maxBatch = options.maxBatch ?? 100;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

  const outcome: FlushOutcome = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    lastError: null,
  };

  const pending = await db.pendingEvents
    .orderBy("retryCount")
    .limit(maxBatch)
    .toArray();

  for (const row of pending) {
    outcome.attempted += 1;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelopeToSupabaseRow(row.envelope)),
      });

      if (response.ok) {
        await db.pendingEvents.delete(row.id);
        outcome.succeeded += 1;
      } else {
        await markFailed(
          db,
          row,
          `HTTP ${response.status} ${response.statusText}`,
        );
        outcome.failed += 1;
        outcome.lastError = `HTTP ${response.status}`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(db, row, message);
      outcome.failed += 1;
      outcome.lastError = message;
    }
  }

  return outcome;
}

async function markFailed(
  db: ScorebookDexie,
  row: PendingEventRow,
  message: string,
): Promise<void> {
  await db.pendingEvents.update(row.id, {
    retryCount: row.retryCount + 1,
    lastAttemptAt: new Date().toISOString(),
    lastErrorMessage: message,
  });
}
