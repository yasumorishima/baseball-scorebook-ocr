"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getScorebookDb, type GameRow } from "@/src/client/db/dexie";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; games: GameRow[] }
  | { kind: "error"; message: string };

const STATUS_LABEL: Record<GameRow["status"], string> = {
  in_progress: "進行中",
  finished: "終了",
  suspended: "中断",
};

export function GamesList() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getScorebookDb();
        const rows = await db.games.orderBy("date").reverse().toArray();
        if (!cancelled) setState({ kind: "ready", games: rows });
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
  }, []);

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <nav
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <Link
          href="/capture"
          style={{
            padding: "0.5rem 1rem",
            background: "#0f172a",
            color: "#ffffff",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.9375rem",
          }}
        >
          スコアブック撮影
        </Link>
        <Link
          href="/join"
          style={{
            padding: "0.5rem 1rem",
            background: "#ffffff",
            color: "#0f172a",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.9375rem",
          }}
        >
          招待コードで参加
        </Link>
      </nav>

      {state.kind === "loading" ? (
        <p style={{ color: "#64748b" }}>読み込み中...</p>
      ) : null}

      {state.kind === "error" ? (
        <p
          role="alert"
          style={{
            padding: "0.75rem",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: "0.875rem",
          }}
        >
          読み込みに失敗しました: {state.message}
        </p>
      ) : null}

      {state.kind === "ready" && state.games.length === 0 ? (
        <div
          style={{
            padding: "2rem 1rem",
            background: "#f1f5f9",
            borderRadius: 8,
            textAlign: "center",
            color: "#475569",
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            まだ試合がありません。スコアブック写真を撮影するか、
            Day 2 で実装する新規作成ボタンから追加してください。
          </p>
        </div>
      ) : null}

      {state.kind === "ready" && state.games.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "0.5rem",
          }}
        >
          {state.games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/games/${game.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  padding: "0.875rem 1rem",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "#0f172a",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {game.date} vs {game.opponent}
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                    {STATUS_LABEL[game.status]}
                  </div>
                </div>
                <span style={{ color: "#64748b", fontSize: "0.875rem" }}>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
