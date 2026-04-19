import type { Metadata } from "next";
import { GamesList } from "./_games-list";

export const metadata: Metadata = {
  title: "試合一覧 | 草野球スコアブック",
};

export default function GamesPage() {
  return (
    <main
      style={{
        padding: "2rem 1rem",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>試合一覧</h1>
      </header>
      <GamesList />
    </main>
  );
}
