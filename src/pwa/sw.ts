/**
 * Service Worker エントリ。Serwist v9 + Workbox BackgroundSyncQueue で
 * `pending_events` を回線復帰時に指数バックオフで再送します
 * （docs/architecture.md §9.2 / §12）。
 *
 * - Chrome 系: Background Sync API + 24h 保持キュー
 * - Safari: SW ライフサイクル外で再送できないため、アプリ層 Dexie
 *   `pending_events` を online イベントで flush する二層構成
 *
 * BackgroundSyncQueue はデフォルトで `maxRetentionTime` 切れまで
 * `shiftRequest → fetch → 成功時次へ / 失敗時 unshift → throw` を
 * 指数バックオフで回してくれるので、カスタム onSync は実装しない。
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  BackgroundSyncQueue,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const EVENTS_QUEUE_NAME = "scorebook-events-queue";

const eventsQueue = new BackgroundSyncQueue(EVENTS_QUEUE_NAME, {
  // Workbox/Serwist の単位は分。24 * 60 分 = 24h 保持で §9.2 に合わせる。
  maxRetentionTime: 24 * 60,
});

/**
 * `POST /api/events` が (1) ネットワーク失敗で throw する または
 * (2) サーバ 5xx を返す 場合に、同じリクエストを BackgroundSyncQueue に
 * 積んで後で再送する。
 *
 * イベントは `(gameId, seq)` UNIQUE + `id` UUID v7 で冪等化済みなので
 * 5xx 二重リトライしても衝突は `on conflict (id) do nothing` で吸収される。
 */
const enqueueOnFailure = {
  fetchDidFail: async ({ request }: { request: Request }) => {
    await eventsQueue.pushRequest({ request: request.clone() });
  },
  fetchDidSucceed: async ({
    request,
    response,
  }: {
    request: Request;
    response: Response;
  }) => {
    if (response.status >= 500) {
      await eventsQueue.pushRequest({ request: request.clone() });
    }
    return response;
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.method === "POST" && url.pathname.startsWith("/api/events"),
      handler: new NetworkOnly({
        plugins: [enqueueOnFailure],
      }),
      method: "POST",
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new StaleWhileRevalidate({ cacheName: "scorebook-api" }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
