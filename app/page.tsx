import Link from "next/link";
import { PwaStatus } from "./_components/pwa-status";

const navLinks: Array<{ href: string; label: string; note: string }> = [
  { href: "/login", label: "サインイン", note: "メールリンク認証" },
  { href: "/games", label: "試合一覧", note: "ローカル DB から読み込み" },
  { href: "/capture", label: "スコアブック撮影", note: "カメラキャプチャ" },
  { href: "/join", label: "招待コードで参加", note: "チーム加入" },
];

export default function HomePage() {
  return (
    <main
      style={{
        padding: "2rem 1rem",
        maxWidth: 640,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>草野球スコアブック</h1>
      <p style={{ marginTop: "0.75rem", lineHeight: 1.6 }}>
        Day 2 PWA 土台。現時点ではスキャフォールドのみで、スコアブック写真 OCR 本体は
        既存パイプライン（<code>src/pipeline.ts</code>）で動作します。
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>画面</h2>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0.75rem 0 0",
            display: "grid",
            gap: "0.5rem",
          }}
        >
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  padding: "0.75rem 1rem",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "#0f172a",
                }}
              >
                <span>
                  <span style={{ fontWeight: 600 }}>{link.label}</span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.8125rem",
                      color: "#64748b",
                    }}
                  >
                    {link.note}
                  </span>
                </span>
                <span style={{ color: "#64748b" }}>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>同期ステータス</h2>
        <PwaStatus />
      </section>
    </main>
  );
}
