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
    // env 未設定時は middleware を no-op にして開発を阻害しない。
    // 本番 build は env 無しでは起動できないので運用事故は起きない。
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
