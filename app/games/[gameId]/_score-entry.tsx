"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getScorebookDb, type GameRow } from "@/src/client/db/dexie";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; game: GameRow | null }
  | { kind: "error"; message: string };

// architecture §20.3: 打順数は 9-11 可変。Phase 3 placeholder では 9 固定
// で描画し、Day 2 で gameEvents の substitution 累積から推定するか、または
// GameRow に batterCount を追加して動的に決める想定。
const DEFAULT_LINEUP = 9;
const INNINGS = 9;

export function GameScoreEntry({ gameId }: { gameId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getScorebookDb();
        const game = (await db.games.get(gameId)) ?? null;
        if (!cancelled) setState({ kind: "ready", game });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  return (
    <main
      style={{
        padding: "1.5rem 1rem",
        maxWidth: 960,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <nav style={{ marginBottom: "0.75rem" }}>
        <Link
          href="/games"
          style={{ color: "#0f172a", fontSize: "0.875rem" }}
        >
          ← 試合一覧へ
        </Link>
      </nav>

      <header>
        <h1 style={{ fontSize: "1.375rem", fontWeight: 700 }}>
          スコア入力
        </h1>
        {state.kind === "loading" ? (
          <p style={{ color: "#64748b" }}>読み込み中...</p>
        ) : null}
        {state.kind === "error" ? (
          <p role="alert" style={{ color: "#991b1b" }}>
            {state.message}
          </p>
        ) : null}
        {state.kind === "ready" && state.game ? (
          <p style={{ color: "#475569" }}>
            {state.game.date} vs {state.game.opponent}
          </p>
        ) : null}
        {state.kind === "ready" && !state.game ? (
          <p style={{ color: "#991b1b" }}>
            game_id <code>{gameId}</code>{" "}
            はローカルに存在しません。Day 2 で Supabase から同期する予定。
          </p>
        ) : null}
      </header>

      <section style={{ marginTop: "1.5rem", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#ffffff",
            minWidth: 640,
          }}
        >
          <thead>
            <tr>
              <th
                scope="col"
                style={{
                  ...headerCellStyle,
                  position: "sticky",
                  left: 0,
                  zIndex: 1,
                }}
              >
                打順
              </th>
              {Array.from({ length: INNINGS }, (_, i) => (
                <th key={i} scope="col" style={headerCellStyle}>
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: DEFAULT_LINEUP }, (_, i) => (
              <tr key={i}>
                <th
                  scope="row"
                  style={{
                    ...rowHeaderStyle,
                    position: "sticky",
                    left: 0,
                    background: "#f8fafc",
                    zIndex: 1,
                  }}
                >
                  {i + 1}
                </th>
                {Array.from({ length: INNINGS }, (_, j) => (
                  <td key={j} style={cellStyle} aria-label="空セル">
                    <span style={{ color: "#cbd5e1" }}>·</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          background: "#fffbeb",
          color: "#854d0e",
          borderRadius: 6,
          fontSize: "0.875rem",
          lineHeight: 1.6,
        }}
      >
        Day 2 で各セルを plate_appearance envelope 入力 UI に差し替え、
        Dexie → Supabase broadcast → 他端末 realtime 受信を繋ぎ込む予定です。
      </p>
    </main>
  );
}

const headerCellStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  padding: "0.5rem",
  background: "#f1f5f9",
  fontSize: "0.8125rem",
  fontWeight: 600,
};

const rowHeaderStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  padding: "0.5rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  minWidth: 48,
};

const cellStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  padding: "0.5rem",
  minWidth: 56,
  minHeight: 48,
  textAlign: "center",
  verticalAlign: "middle",
};
