/**
 * 早稲田式スコアブック記法の Few-shot 例（テキストベース）。
 *
 * 日本の草野球で最も普及している早稲田式（成美堂 9104 等）の記法を
 * テキストと期待 JSON のペアで Opus 4.7 に提示する。
 *
 * 将来的に Day 2 で画像ベース Few-shot（セル crop + JSON）に拡張する。
 */

export type WasedaFewshotExample = {
  /** セル内の生記法（手書き文字列をそのまま写したもの） */
  rawNotation: string;
  /** 期待される構造化出力 */
  expected: {
    raw_notation: string;
    outcome: string;
    fielders_involved: number[] | null;
    reached_base: 0 | 1 | 2 | 3 | 4 | null;
    out_count_after: 1 | 2 | 3 | null;
    extras: Record<string, unknown>;
    evidence: string;
    confidence: number;
  };
  /** 記法の解説（プロンプト説明用） */
  explanation: string;
};

export const WASEDA_FEWSHOT: WasedaFewshotExample[] = [
  {
    rawNotation: "I3",
    expected: {
      raw_notation: "I3",
      outcome: "ground_out",
      fielders_involved: [3],
      reached_base: 0,
      out_count_after: 1,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "Roman 'I' indicates 1st out of inning, '3' is fielder position (1B), no diamond fill = no base reached.",
      confidence: 0.95,
    },
    explanation: "Roman numerals I/II/III before a number indicate which out this is (1st/2nd/3rd). A single fielder number after = groundout directly fielded at that position.",
  },
  {
    rawNotation: "II6-3",
    expected: {
      raw_notation: "II6-3",
      outcome: "ground_out",
      fielders_involved: [6, 3],
      reached_base: 0,
      out_count_after: 2,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "II = 2nd out of inning, '6-3' = SS to 1B throwing chain (standard groundout).",
      confidence: 0.93,
    },
    explanation: "Hyphenated numbers represent a fielding chain (ball thrown between positions). '6-3' = SS fielded, threw to 1B.",
  },
  {
    rawNotation: "IIIK",
    expected: {
      raw_notation: "IIIK",
      outcome: "strikeout_swinging",
      fielders_involved: null,
      reached_base: 0,
      out_count_after: 3,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "III = 3rd (final) out of inning. 'K' = strikeout swinging in waseda convention (逆K/Kc = looking).",
      confidence: 0.95,
    },
    explanation: "K = strikeout swinging. Kc or 逆K = strikeout looking. Watch for differing conventions by region (keio/兵庫高野連 swap meanings).",
  },
  {
    rawNotation: "B",
    expected: {
      raw_notation: "B",
      outcome: "walk",
      fielders_involved: null,
      reached_base: 1,
      out_count_after: null,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "Standalone 'B' in waseda = base on balls (walk). Batter reaches 1B, typically shown with diamond's upper-right shading.",
      confidence: 0.9,
    },
    explanation: "Waseda walk: 'B' (single letter). Keio style uses 'BB'. Batter always reaches 1B.",
  },
  {
    rawNotation: "F8",
    expected: {
      raw_notation: "F8",
      outcome: "fly_out",
      fielders_involved: [8],
      reached_base: 0,
      out_count_after: null,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "'F' prefix = fly out. '8' = center fielder.",
      confidence: 0.95,
    },
    explanation: "F{n} = flyout caught by position n. L{n} = line drive out. P{n} = popup (usually to infield).",
  },
  {
    rawNotation: "犠",
    expected: {
      raw_notation: "犠",
      outcome: "sac_bunt",
      fielders_involved: null,
      reached_base: 0,
      out_count_after: null,
      extras: { SH: true, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "'犠' kanji boxed in a diamond = sacrifice bunt in waseda convention. WARNING: keio style uses diamond-boxed to mean infield hit instead.",
      confidence: 0.85,
    },
    explanation: "Sacrifice bunt (犠打/SAC). Not counted in AB but SH increments. CRITICAL: waseda vs keio diamond-box has opposite meanings (犠打 vs 内野安打) — style detection (Stage 1) must be correct before interpreting.",
  },
  {
    rawNotation: "1B",
    expected: {
      raw_notation: "1B",
      outcome: "single",
      fielders_involved: null,
      reached_base: 1,
      out_count_after: null,
      extras: { SH: false, SF: false, HBP: false, FC: false, error_fielder: null, stolen_bases: [], passed_ball: false, wild_pitch: false, interference: null, strikeout_reached: false },
      evidence: "'1B' = single (一塁打). Batter reaches 1B.",
      confidence: 0.95,
    },
    explanation: "Hit: 1B=single, 2B=double, 3B=triple, HR=home run. Shorthand matches result base.",
  },
];

/**
 * Stage 2 システムプロンプトに埋め込む用の Few-shot テキストブロックを生成。
 * <example> XML タグで囲み、Cookbook 実証の CoT パターンに従う。
 */
export function renderFewshotBlock(examples: WasedaFewshotExample[] = WASEDA_FEWSHOT): string {
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
