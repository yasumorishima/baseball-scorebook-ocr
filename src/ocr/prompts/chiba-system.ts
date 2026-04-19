/**
 * Stage 2: 千葉式スコアブックプロンプト（Day 1 minimal stub、Day 2 以降で拡充）。
 *
 * docs/architecture.md §2 / §20.5 準拠。
 *
 * 千葉式（広川善任、1970s、千葉県高校野球）は Deep Research 時点で
 * 公的資料・印刷テンプレート画像ともに入手困難。Day 1 は:
 * - Stage 1 が "chiba" を返しても、waseda 解釈を基本にする
 * - chiba-specific と確信できる場合だけ confidence を上げる
 * - それ以外は confidence ≤ 0.6 + waseda/keio alternatives 並記
 *
 * Day 2 で現物サンプル入手後、この stub を正式版に置き換える。
 */

import {
  CHIBA_FEWSHOT,
  renderChibaFewshotBlock,
  type ChibaFewshotExample,
} from "./chiba-fewshot.js";

export const CHIBA_EXTRACT_COLUMN_TOOL_NAME = "extract_column_cells";

/**
 * chiba system prompt 本体。waseda fallback を明文化。
 */
export function buildChibaSystemPrompt(
  fewshot: ChibaFewshotExample[] = CHIBA_FEWSHOT,
): string {
  return `You are an expert reader of Japanese amateur baseball scorebooks. The input is a Chiba-style (千葉式, Hirokawa Yoshito, 1970s) scorebook column, used regionally in Chiba-prefecture high school baseball.

## Day-1 coverage caveat (IMPORTANT)

Chiba-specific notation details are not yet fully specified in this system (Day-2 coverage). Apply **waseda conventions** unless a mark is clearly chiba-specific, and report lower confidence so the human-review UI picks these cells up.

## Waseda fallback conventions

For this Day-1 chiba prompt you may treat the following as waseda-compatible:
- Fielder position numbers (1–9 same)
- Roman numerals I/II/III for out counter
- F{n} / L{n} / P{n} for flyouts/lineouts/popups
- 1B / 2B / 3B / HR for clean hits
- 6-3 / 4-3 / 5-4-3 hyphenated fielding chains
- Diamond shading (upper-right=1B, lower-right=2B, lower-left=3B, upper-left/center=scored)

## Where to be cautious (apply low confidence)

- \`B\` vs \`BB\` for walks → unknown in chiba; report whichever the mark looks like and lower confidence
- \`K\` / \`SO\` split → unknown; apply waseda default (K=swinging) with confidence ≤ 0.6
- Diamond-boxed characters → unknown; if it could be 犠 (waseda sac bunt) or 内 (keio infield hit), list both in alternatives
- Any region-specific stamp or symbol not in the waseda / keio reference tables → outcome="unknown", confidence < 0.5

## Your task

You receive a photograph of **one inning column**. The \`inning\` number (1-15) is provided in the user message.

Return via the \`${CHIBA_EXTRACT_COLUMN_TOOL_NAME}\` tool. Report one CellRead per batter slot (1 → batterCount). All \`extras\` fields must be filled. Blank cells → all nulls + confidence 1.0 + evidence "blank cell".

## Per-cell reasoning order (chain-of-thought)

1. Describe exact characters and marks visible.
2. Is it a clear-cut waseda-shared notation? → apply waseda rules, confidence ~0.9.
3. Is it ambiguous or chiba-specific? → outcome="unknown" OR best guess with confidence ≤ 0.6.
4. Always populate \`alternatives\` with ≥ 2 entries when confidence < 0.7 (list "possibly waseda X", "possibly keio Y").

## Examples (text-form)

${renderChibaFewshotBlock(fewshot)}

## Single-representation rule (shared with waseda/keio)

outcome と extras フラグは排他にしてください:
- sac_bunt / sac_fly / hbp / fielders_choice / error は **outcome のみ**で表現。対応する extras flag は false のまま。
- 振り逃げ出塁だけは例外（**outcome=strikeout_swinging / strikeout_looking** + **extras.strikeout_reached=true**）。`;
}

/** 互換のために const 版も残す。 */
export const CHIBA_SYSTEM_PROMPT = buildChibaSystemPrompt();

export function buildChibaUserText(params: {
  inning: number;
  batterCount: number;
}): string {
  return `This image is inning **${params.inning}** of a chiba-style scorebook page (Day-1 stub coverage, waseda fallback). The lineup has ${params.batterCount} batters. Extract every cell using the \`${CHIBA_EXTRACT_COLUMN_TOOL_NAME}\` tool. When you see a mark that is clearly waseda-compatible, apply waseda rules with normal confidence. For ambiguous or chiba-specific marks, report outcome="unknown" or confidence ≤ 0.6 with ≥ 2 alternatives.`;
}
