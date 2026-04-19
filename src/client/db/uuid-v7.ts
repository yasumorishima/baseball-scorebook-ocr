/**
 * UUID v7 ヘルパー。時刻先頭（ms 精度）+ ランダム 74bit で時刻ソート可能。
 *
 * docs/architecture.md §8.1 で event.id を UUID v7 に固定しているのは、
 * `(gameId, seq)` の UNIQUE と別軸で、グローバル時刻ソート（複数端末の
 * append 順序再現）を成立させるためです。
 *
 * 実装は `uuid@11` の `v7()` を薄くラップ。ブラウザでも Node でも動作します。
 */

import { v7 as uuidV7 } from "uuid";

export function newEventId(): string {
  return uuidV7();
}

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(id: string): boolean {
  return UUID_V7_REGEX.test(id);
}
