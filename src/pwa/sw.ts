/**
 * Service Worker エントリ。Serwist v9 + Workbox BackgroundSyncQueue で
 * `pending_events` を回線復帰時に指数バックオフで再送します
 * （docs/architecture.md §9.2 / §12）。
 *
 * - Chrome 系: Background Sync API + 24h 保持キュー
 * - Safari: SW ライフサイクル外で再送できないため、アプリ層 Dexie
 *   `pending_events` を online イベントで flush する二層構成
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
  maxRetentionTime: 24 * 60,
  onSync: async ({ queue }) => {
    let entry = await queue.shiftRequest();
    while (entry) {
      try {
        await fetch(entry.request.clone());
      } catch {
        await queue.unshiftRequest(entry);
        throw new Error("scorebook-events-queue: retry deferred");
      }
      entry = await queue.shiftRequest();
    }
  },
});

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
        plugins: [
          {
            fetchDidFail: async ({ request }) => {
              await eventsQueue.pushRequest({ request });
            },
          },
        ],
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
