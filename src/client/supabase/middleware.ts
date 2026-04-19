/**
 * Next.js middleware から呼ぶ session refresh ヘルパ。
 *
 * `@supabase/ssr` の公式パターン: middleware で `getUser()` を呼んで
 * Access Token を検証 + リフレッシュし、`response.cookies` に書き戻す。
 *
 * docs/architecture.md §10.6: `getSession()` は JWT 署名検証しないので
 * 使わず、`getUser()` もしくは `getClaims()` を使う。ここでは `getUser()`
 * （auth server へ検証依頼）で Access Token のライフサイクルを回す。
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function refreshSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // 本番で env 未設定なら silent に unauthenticated 動作するのは事故の元。
    // dev/test では no-op 許容、production では fail-closed で阻止する。
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Supabase middleware: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が production で未設定です。session refresh を行わずに動作継続するのはセキュリティリスクなので停止します。",
      );
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: request.headers } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}
