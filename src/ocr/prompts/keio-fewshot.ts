/**
 * 慶応式（NPB 式）スコアブック記法の Few-shot 例（テキストベース）。
 *
 * Deep Research 第1弾で確定した慶応式固有差分に基づく:
 * - walk: `BB`（waseda は `B`）
 * - strikeout swinging: `SO`（waseda は `K`）
 * - dropped-third-strike reached: `K`（waseda は `逆K` / `Kc`）
 * - stolen base: `O{base}`（waseda は `S{base}`）
 * - error: fielder に `'` 右肩（waseda は `E{n}` 前置）
 * - **diamond-boxed character: 内野安打 = INFIELD HIT**（waseda は 犠打 = SAC BUNT、正反対）
 *
 * 打順表記は小文字 a〜i（waseda は ①②③）だが、本モジュールの few-shot は
 * セル内記号に絞る（打順列は別列で Stage 2 が扱わない）。
 *
 * 将来 Day 2 で画像ベース Few-shot（セル crop + JSON）に拡張する際も
 * 同じ型（WasedaFewshotExample 互換）を使う。
 */

import type { WasedaFewshotExample } from "./waseda-fewshot.js";

/** keio 版 few-shot 型。構造は waseda と同一で差し替えやすさを優先。 */
export type KeioFewshotExample = WasedaFewshotExample;

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

export const KEIO_FEWSHOT: KeioFewshotExample[] = [
  {
    rawNotation: "I3",
    expected: {
      raw_notation: "I3",
      outcome: "ground_out",
      fielders_involved: [3],
      reached_base: 0,
      out_count_after: 1,
      extras: { ...EMPTY_EXTRAS },
      evidence: "Roman 'I' = 1st out of inning, '3' = fielder position (1B).",
      confidence: 0.95,
    },
    explanation:
      "Roman numerals I/II/III indicate out-count; same convention as waseda. Single fielder number = groundout fielded at that position.",
  },
  {
    rawNotation: "II6-3",
    expected: {
      raw_notation: "II6-3",
      outcome: "ground_out",
      fielders_involved: [6, 3],
      reached_base: 0,
      out_count_after: 2,
      extras: { ...EMPTY_EXTRAS },
      evidence: "II = 2nd out, '6-3' = SS to 1B throwing chain (keio uses hyphens same as waseda).",
      confidence: 0.93,
    },
    explanation:
      "Hyphenated fielding chain is shared notation across styles. 6-3 = SS fielded, threw to 1B.",
  },
  {
    rawNotation: "IIISO",
    expected: {
      raw_notation: "IIISO",
      outcome: "strikeout_swinging",
      fielders_involved: null,
      reached_base: 0,
      out_count_after: 3,
      extras: { ...EMPTY_EXTRAS },
      evidence:
        "III = 3rd (final) out of inning. 'SO' = strikeout swinging in keio convention (waseda uses 'K' for swinging).",
      confidence: 0.92,
    },
    explanation:
      "CRITICAL keio/waseda diff: keio SO = swinging strikeout, keio K = dropped-third-strike REACHED. Do not treat SO as 'struck out looking'.",
  },
  {
    rawNotation: "K",
    expected: {
      raw_notation: "K",
      outcome: "strikeout_swinging",
      fielders_involved: null,
      reached_base: 1,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS, strikeout_reached: true },
      evidence:
        "'K' in keio notation = strikeout + batter reached 1B on dropped third strike. This differs from waseda where K = ordinary strikeout swinging.",
      confidence: 0.85,
    },
    explanation:
      "Keio-specific: K without SO means the catcher dropped the 3rd strike and batter safely reached 1B. AB still counts, SO still increments, and strikeout_reached=true (so diamond_reached_base shows 1B filled upper-right).",
  },
  {
    rawNotation: "BB",
    expected: {
      raw_notation: "BB",
      outcome: "walk",
      fielders_involved: null,
      reached_base: 1,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS },
      evidence: "'BB' (double B) = base on balls in keio (waseda uses single 'B').",
      confidence: 0.93,
    },
    explanation:
      "Keio walk: two-letter BB. Single B in keio would be unusual and should lower confidence.",
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
      evidence: "'F' prefix = fly out (shared across styles). '8' = CF.",
      confidence: 0.95,
    },
    explanation:
      "Flyouts, lineouts (L), popups (P) use the same F{n}/L{n}/P{n} pattern as waseda.",
  },
  {
    rawNotation: "◇5",
    expected: {
      raw_notation: "◇5",
      outcome: "single",
      fielders_involved: [5],
      reached_base: 1,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS },
      evidence:
        "Diamond-boxed digit '5' (3B) in keio style = INFIELD HIT fielded at 3B (batter safe at 1B). NOTE: same mark in waseda = sacrifice bunt (opposite meaning).",
      confidence: 0.8,
    },
    explanation:
      "CRITICAL keio/waseda inversion: ◇{fielder} in keio = infield hit (single). In waseda, ◇ around 犠 = sacrifice bunt. Style detection (Stage 1) MUST be correct first; otherwise the outcome flips.",
  },
  {
    rawNotation: "1B",
    expected: {
      raw_notation: "1B",
      outcome: "single",
      fielders_involved: null,
      reached_base: 1,
      out_count_after: null,
      extras: { ...EMPTY_EXTRAS },
      evidence: "'1B' = clean single (shared shorthand across styles).",
      confidence: 0.95,
    },
    explanation: "Hit shorthand (1B/2B/3B/HR) is shared across styles.",
  },
];

/**
 * keio 版 few-shot block 生成。waseda の renderFewshotBlock と同じ XML 構造。
 */
export function renderKeioFewshotBlock(
  examples: KeioFewshotExample[] = KEIO_FEWSHOT,
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
