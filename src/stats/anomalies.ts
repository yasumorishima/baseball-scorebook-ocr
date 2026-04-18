/**
 * OBP 逆説（出塁したのに OBP が下がるケース）の検出と説明。
 *
 * docs/architecture.md §7.4 / NPB 公認野球規則 9.05(b) / 9.02(a)(1) 準拠。
 *
 * 直感に反して OBP が下がる（または変動しない）ケースを UI でユーザーに説明するため、
 * 該当セルを分類する。
 *
 * | ケース                      | AB | H  | AVG  | OBP           |
 * |-----------------------------|:--:|:--:|:----:|:-------------:|
 * | 振り逃げ出塁                | +1 | 無 | ↓    | ↓（直感と逆）|
 * | フィルダースチョイス (FC)   | +1 | 無 | ↓    | ↓            |
 * | エラー出塁 (ROE)            | +1 | 無 | ↓    | ↓            |
 * | 犠打 + 野手選択で全員生存   |  0 | 無 | 変なし | 変なし      |
 * | 打撃妨害で一塁 (Int)        |  0 | 無 | 変なし | 変なし      |
 * | 走塁妨害 (Ob)               | +1 | 無 | ↓    | ↓            |
 */

import type { CellRead } from "../types/cell.js";
import type { BattingStats } from "../types/stats.js";
import { computeBattingRates } from "./compute.js";

export type ObpAnomalyKind =
  | "strikeout_reached"
  | "fielders_choice"
  | "reach_on_error"
  | "sacrifice_no_stats_change"
  | "batter_interference_no_change"
  | "runner_interference";

export type ObpAnomaly = {
  kind: ObpAnomalyKind;
  title: string;
  /** UI ツールチップ用 1〜2 文の説明 */
  tooltip: string;
  /** 直感的期待値と実際の差分（例: "OBP ↓"） */
  direction: "obp_down" | "no_change" | "complex";
};

const ANOMALY_CATALOG: Record<ObpAnomalyKind, Omit<ObpAnomaly, "kind">> = {
  strikeout_reached: {
    title: "振り逃げ出塁",
    tooltip:
      "打者は塁に到達しましたが、AB + 1 で H / BB / HBP のどれにも該当しないため、OBP の分母だけが増えて OBP は低下します（NPB 規則 9.05(b)）。",
    direction: "obp_down",
  },
  fielders_choice: {
    title: "フィルダースチョイス (FC)",
    tooltip:
      "野手選択で塁に残っても、AB + 1 のみが計上されて H / BB / HBP にならないため OBP は低下します。",
    direction: "obp_down",
  },
  reach_on_error: {
    title: "エラー出塁 (ROE)",
    tooltip:
      "失策で塁に到達した場合、AB + 1 のみで H 扱いにはならないので打率と同じく OBP も低下します。",
    direction: "obp_down",
  },
  sacrifice_no_stats_change: {
    title: "犠打 + 野手選択で全員生存",
    tooltip:
      "犠打が成立した記録（SH）で、かつ全走者が生還した場合は AB / H / BB / HBP のいずれも変動せず、OBP は変化しません。",
    direction: "no_change",
  },
  batter_interference_no_change: {
    title: "打撃妨害で一塁 (Int)",
    tooltip:
      "打撃妨害で一塁出塁は AB・H・BB・HBP にカウントされず OBP の分母・分子とも変動しません（NPB 規則 9.02(a)(1)）。",
    direction: "no_change",
  },
  runner_interference: {
    title: "走塁妨害 (Ob)",
    tooltip:
      "走塁妨害は記録上打者は out 扱いとなり AB + 1 で H にならないため OBP は低下します。",
    direction: "obp_down",
  },
};

/**
 * 1 セルが OBP 逆説ケースに該当するか分類する。
 * 非該当なら null。
 */
export function classifyCellAnomaly(cell: CellRead): ObpAnomaly | null {
  if (cell.outcome == null) return null;

  // 振り逃げ出塁
  if (
    (cell.outcome === "strikeout_swinging" ||
      cell.outcome === "strikeout_looking") &&
    cell.extras.strikeout_reached
  ) {
    return build("strikeout_reached");
  }

  // フィルダースチョイス
  if (cell.outcome === "fielders_choice") return build("fielders_choice");

  // エラー出塁
  if (cell.outcome === "error") return build("reach_on_error");

  // 犠打 + 全走者生存
  // NOTE: 厳密には走者進塁情報が必要。cell 単体では「犠打が記録された」までしか分からない。
  // UI レイヤで走者状態を見て最終判定する想定。
  if (cell.outcome === "sac_bunt") return build("sacrifice_no_stats_change");

  // 打撃妨害 / 走塁妨害
  if (cell.outcome === "interference") {
    if (cell.extras.interference === "runner") return build("runner_interference");
    return build("batter_interference_no_change");
  }

  return null;
}

function build(kind: ObpAnomalyKind): ObpAnomaly {
  const entry = ANOMALY_CATALOG[kind];
  return { kind, ...entry };
}

/**
 * 打席前後の BattingStats を比較し、AVG と OBP の動きが逆説的か判定する。
 * - 返却: `{ avgDelta, obpDelta, reachedBase, paradox }`
 * - paradox=true: reached_base > 0 だが obpDelta <= 0（直感と逆）
 */
export function diagnoseObpDelta(
  before: BattingStats,
  after: BattingStats,
  reached_base: 0 | 1 | 2 | 3 | 4 | null,
): {
  avgDelta: number;
  obpDelta: number;
  reachedBase: boolean;
  paradox: boolean;
} {
  const rBefore = computeBattingRates(before);
  const rAfter = computeBattingRates(after);
  const avgDelta = rAfter.AVG - rBefore.AVG;
  const obpDelta = rAfter.OBP - rBefore.OBP;
  const reachedBase = reached_base != null && reached_base > 0;
  const paradox = reachedBase && obpDelta <= 1e-9;
  return { avgDelta, obpDelta, reachedBase, paradox };
}

/** 全 6 ケースのカタログを UI 向けにエクスポート（help モーダル用）。 */
export function listAnomalyKinds(): ObpAnomaly[] {
  return (Object.keys(ANOMALY_CATALOG) as ObpAnomalyKind[]).map(build);
}
