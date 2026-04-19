import { NextResponse } from "next/server";

/**
 * オフラインキュー（Serwist BackgroundSyncQueue + Dexie `pendingEvents`）
 * からの `POST /api/events` をサーバ側で受ける予定のルート。
 *
 * ⚠️ **現時点では未実装 & 未認証**。
 *
 * - Next.js middleware の matcher は `/api/events` を除外している（cookie
 *   session refresh を避けるため）。つまりこのルートは middleware を
 *   通らず、Supabase cookie-based auth がかからない。
 * - そのため future の実装者は以下のいずれかで必ず認可を入れること:
 *   (a) `Authorization: Bearer <supabase-access-token>` を client から送り、
 *       ここで `supabase.auth.getUser(token)` で検証してから
 *       `supabase.from('game_events').insert(...)` に渡す
 *   (b) middleware から外さず、cookie session を使う（SW 経由でも
 *       cookie は運ばれる）
 * - 無認可で insert を通すと RLS `to authenticated` で弾かれるので破綻
 *   しないが、エラーハンドリングが煩雑になるので (a) を推奨。
 *
 * Phase 2 の scaffold では敢えて 501 を返して、誤って公開デプロイしても
 * event が通らないようにしている。Phase 3 の実装で差し替える。
 */
export function POST(): NextResponse {
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "POST /api/events is not yet wired. See app/api/events/route.ts header comment for the auth plan.",
    },
    { status: 501 },
  );
}
