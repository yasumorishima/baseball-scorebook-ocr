import type { Metadata } from "next";
import { JoinForm } from "./_join-form";

export const metadata: Metadata = {
  title: "チーム参加 | 草野球スコアブック",
};

type SearchParams = Promise<{ code?: string | string[] }>;

export default async function JoinPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const rawCode = sp.code;
  const initialCode = Array.isArray(rawCode) ? rawCode[0] ?? "" : rawCode ?? "";

  return (
    <main
      style={{
        padding: "2rem 1rem",
        maxWidth: 480,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>チームに参加</h1>
      <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#475569" }}>
        配布された 8 文字の招待コードを入力してチームに参加します。
        有効期限切れや使用上限を超えたコードは使えません。
      </p>
      <JoinForm initialCode={initialCode} />
    </main>
  );
}
