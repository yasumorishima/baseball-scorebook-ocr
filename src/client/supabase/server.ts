/**
 * Supabase Server Component / Route Handler / Server Action 用クライアント。
 *
 * Next.js 15 の `cookies()` は非同期なので `createSupabaseServerClient` は
 * `async` 関数。Server Component 側で毎 request 生成する想定で、キャッシュは
 * しない（request-scope が混線するため）。
 *
 * docs/architecture.md §10.6 の「`getSession()` を信頼しない」原則に従い、
 * 呼び出し側は `supabase.auth.getClaims()` を使うこと（このファイル自身は
 * client 生成のみ）。
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase サーバクライアント初期化失敗: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        // Server Component からは cookie を書けない（throw する）ので
        // try/catch で握りつぶす。middleware.ts 側で session refresh を
        // 担当するため、この経路で書けなくても session は維持される。
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op
        }
      },
    },
  });
}
