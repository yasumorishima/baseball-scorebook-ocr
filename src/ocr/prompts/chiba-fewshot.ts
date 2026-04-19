/**
 * 千葉式スコアブック Few-shot 例（Day 1 minimal stub）。
 *
 * docs/architecture.md §2 / §20.5 準拠。
 *
 * 千葉式（広川善任、1970s、千葉県高校野球）は Deep Research 時点で
 * 公的資料がほとんど存在せず、印刷テンプレートの現物画像も未入手。
 * 確信を持って書ける記号差が少ないため、Day 1 の few-shot は
 * **waseda に fallback する旨を示す 3 例**に留め、Day 2 で現物入手後に拡充する。
 *
 * 基本戦略:
 * - Stage 1 で style="chiba" と判定されても、まずは waseda 解釈を試す
 * - 明確に chiba-specific と識別できる記号のみ confidence を高める
 * - それ以外は confidence ≤ 0.6 + alternatives に waseda/keio 候補を並記
 */

import type { WasedaFewshotExample } from "./waseda-fewshot.js";

export type ChibaFewshotExample = WasedaFewshotExample;

const EMPTY_EXTRAS = {
  SH: false,
  SF: false,
  HBP: false,
  FC: false,
  error_fielder: null,
  stolen_bases: [],
  passed_ball: false,
  wild_pitch: false,
  interference: null,
  strikeout_reached: false,
};

export const CHIBA_FEWSHOT: ChibaFewshotExample[] = [
  {
    rawNotation: "I3",
    expected: {
      raw_notation: "I3",
      outcome: "ground_out",
      fielders_involved: [3],
      reached_base: 0,
      out_count_after: 1,
      extras: { ...EMPTY_EXTRAS },
      evidence:
        "Roman 'I' + fielder '3'. Pattern identical to waseda; chiba retains this convention. Safe to apply waseda interpretation.",
      confidence: 0.88,
    },
    explanation:
      "Out-count Roman + fielder number is shared across all three styles (waseda/keio/chiba). Report confidence ~0.9, slightly below pure waseda since chiba coverage is unverified.",
  },
  {
    rawNotation: "F8",
    expected: {
      raw_notation: "F8",
      outcome: "fly_out",
      fielders_involved: [8],
      reached_base: 0,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS },
      evidence:
        "'F' prefix + '8' (CF). F{n} / L{n} / P{n} patterns are widely shared; chiba is assumed to follow waseda here.",
      confidence: 0.85,
    },
    explanation:
      "Flyout shorthand is safe to inherit from waseda. Lower confidence slightly because chiba references are sparse.",
  },
  {
    // 「?」は実在記法ではなく、chiba-specific で waseda/keio いずれにも
    // 当てはまらない未確定マークを表す didactic placeholder。
    // Day 2 で chiba 現物画像が入ったら該当する現物記号（スタンプや地域記法）に差し替える。
    rawNotation: "?",
    expected: {
      raw_notation: "?",
      outcome: "unknown",
      fielders_involved: null,
      reached_base: null,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS },
      evidence:
        "Mark is chiba-specific and not recognized by this stub prompt. Reporting outcome=unknown with low confidence and listing waseda/keio alternatives.",
      confidence: 0.4,
      // confidence < 0.7 の例は alternatives を必ず 2 件以上埋める必要がある
      // （CellReadSchema 要件、Single-representation rule の補助）。
      // 最低 2 件 + 実運用的に考えられる waseda/keio 候補を並記する。
      alternatives: [
        "possibly waseda ground_out (e.g., I3) — apply waseda rules with confidence ~0.6",
        "possibly keio infield hit (◇{fielder}) — single, reached_base=1",
      ],
    },
    explanation:
      "Placeholder for any chiba-specific mark not covered by waseda/keio. When a mark doesn't match cleanly, stay humble: outcome=unknown, confidence < 0.5, and ALWAYS populate alternatives with ≥ 2 plausible waseda/keio interpretations. Day 2 will replace this placeholder with real chiba-specific marks once samples are collected.",
  },
];

export function renderChibaFewshotBlock(
  examples: ChibaFewshotExample[] = CHIBA_FEWSHOT,
): string {
  return examples
    .map((ex, i) => {
      const json = JSON.stringify(ex.expected, null, 2);
      return `<example index="${i + 1}">
  <raw_notation>${ex.rawNotation}</raw_notation>
  <explanation>${ex.explanation}</explanation>
  <expected_output>
${json}
  </expected_output>
</example>`;
    })
    .join("\n\n");
}
