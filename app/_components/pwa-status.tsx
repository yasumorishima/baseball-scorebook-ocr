"use client";

import { useEffect, useState } from "react";
import { getScorebookDb } from "@/client/db/dexie";

type Counts = {
  games: number;
  gameEvents: number;
  pendingEvents: number;
};

export function PwaStatus() {
  const [counts, setCounts] = useState<Counts | null>(null);
  // SSR/ハイドレーション時の初期値は null。client hydration 後の
  // useEffect で初めて実際の navigator.onLine を反映する。こうしないと
  // サーバは常に true でレンダーし、クライアント初回描画で offline 表示に
  // flip してハイドレーション不一致警告が出る。
  const [online, setOnline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getScorebookDb();
        const [games, gameEvents, pendingEvents] = await Promise.all([
          db.games.count(),
          db.gameEvents.count(),
          db.pendingEvents.count(),
        ]);
        if (!cancelled) {
          setCounts({ games, gameEvents, pendingEvents });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        rowGap: "0.25rem",
        columnGap: "1rem",
        marginTop: "0.5rem",
      }}
    >
      <dt>ネットワーク</dt>
      <dd style={{ margin: 0 }}>
        {online === null ? "判定中" : online ? "オンライン" : "オフライン"}
      </dd>

      <dt>ローカル試合数</dt>
      <dd style={{ margin: 0 }}>{counts ? counts.games : "読み込み中"}</dd>

      <dt>ローカルイベント</dt>
      <dd style={{ margin: 0 }}>{counts ? counts.gameEvents : "読み込み中"}</dd>

      <dt>未同期イベント</dt>
      <dd style={{ margin: 0 }}>
        {counts ? counts.pendingEvents : "読み込み中"}
      </dd>

      {error ? (
        <>
          <dt>エラー</dt>
          <dd style={{ margin: 0, color: "#b91c1c" }}>{error}</dd>
        </>
      ) : null}
    </dl>
  );
}
