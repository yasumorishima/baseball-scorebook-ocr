/**
 * Supabase ブラウザクライアント（`@supabase/ssr` 公式パターン）。
 *
 * Client Component 専用。Server Component / Route Handler では
 * `src/client/supabase/server.ts` の `createSupabaseServerClient()` を使う。
 *
 * docs/architecture.md §10.6: middleware.ts で `getSession()` を信頼せず
 * `getClaims()` を使うルールはこちらではなく `middleware.ts` 側で守る。
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase ブラウザクライアント初期化失敗: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。`.env.local.example` を参照してください。",
    );
  }

  cached = createBrowserClient(url, anonKey);
  return cached;
}

/**
 * Phase 3 placeholder 用: env 未設定でも throw しない変種。
 * 画面を描画はさせたいが、ボタン押下時に初めて Supabase と通信する場合に使う。
 * 本番動線（auth 済前提のページ）では `getSupabaseBrowserClient()` を使い、
 * env 欠落を即エラーにする。
 */
export function tryGetSupabaseBrowserClient():
  | { client: SupabaseClient; error: null }
  | { client: null; error: string } {
  try {
    return { client: getSupabaseBrowserClient(), error: null };
  } catch (err) {
    return {
      client: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
