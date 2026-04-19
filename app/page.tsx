import { PwaStatus } from "./_components/pwa-status";

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
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>同期ステータス</h2>
        <PwaStatus />
      </section>
    </main>
  );
}
