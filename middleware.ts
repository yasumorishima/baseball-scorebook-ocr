import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/src/client/supabase/middleware";

export async function middleware(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    // 以下は除外:
    // - _next/static, _next/image, favicon: 静的資産
    // - /sw.js, /manifest.webmanifest: PWA shell
    // - /icons/: アプリアイコン
    // - /api/events: オフラインキュー再送経路、Bearer token で別ルート認証予定
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|api/events).*)",
  ],
};
