import type { Metadata } from "next";
import { GameScoreEntry } from "./_score-entry";

export const metadata: Metadata = {
  title: "スコア入力 | 草野球スコアブック",
};

type Params = Promise<{ gameId: string }>;

export default async function GameDetailPage({ params }: { params: Params }) {
  const { gameId } = await params;
  return <GameScoreEntry gameId={gameId} />;
}
