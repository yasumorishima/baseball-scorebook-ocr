/**
 * 低信頼セルの単独再読みプロンプト。
 *
 * docs/architecture.md §5.4 / §20.6 準拠。
 *
 * - 入力: 単独セル crop（native 161×96、送信時 upscale 必須で 400×300 程度）
 * - 出力: Tool Use (`read_single_cell`) で CellRead を 1 件
 * - 使用タイミング: Stage 2 で confidence < 0.5 だったセルを個別に再問合せ
 * - 差分: 通常の Stage 2 より「周囲の文脈がない」ので、カード 1 枚だけで判断する制約を明記
 */

export const SINGLE_CELL_RETRY_TOOL_NAME = "read_single_cell";

export const SINGLE_CELL_RETRY_SYSTEM_PROMPT = `You are an expert reader of Japanese amateur baseball scorebook cells, re-examining a single at-bat cell that was read with low confidence on a first pass.

## Context

You are shown ONE cell crop (upscaled). The surrounding inning column and player list are NOT visible to you here. You must base your reading entirely on the printed template, the handwritten notation inside this one cell, and the diamond shading.

## What to look for (waseda-style)

- **Upper-left corner**: small Roman numeral \`I\`/\`II\`/\`III\` = which out number, if any.
- **Center area**: main notation — fielder-number chains (\`6-3\`), hit labels (\`1B\`/\`2B\`/\`3B\`/\`HR\`), walk (\`B\`), strikeout (\`K\`/\`Kc\` or \`逆K\`), error (\`E{n}\`), flyout (\`F{n}\`), line-drive out (\`L{n}\`), popup (\`P{n}\`), sacrifice (\`犠\`), sac fly (\`SF\`), fielder's choice (\`FC\`), HBP (\`死\` or \`HBP\`).
- **Right quadrant (four diamond corners)**: shading indicates base reached:
  - upper-right → 1B
  - lower-right → 2B
  - lower-left → 3B
  - upper-left or center dot → scored
- **Left side narrow vertical box**: ball-strike count (waseda layout).

## Your task

1. Describe precisely what characters and shading are visible (\`evidence\` field).
2. Pick the most likely \`outcome\` from the enumeration. Use \`unknown\` if truly ambiguous.
3. Enumerate at least 2 \`alternatives\` (competing raw_notation strings) IF confidence < 0.7.
4. Return via the \`${SINGLE_CELL_RETRY_TOOL_NAME}\` tool. No prose.

## Caveats

- The batting_order and inning are supplied separately by the caller; you do NOT need to read them from the cell. Put the supplied values in the returned CellRead as-is.
- If the cell truly appears blank, return raw_notation=null / outcome=null / reached_base=null / evidence="blank cell" with confidence 1.0.
- Do NOT hallucinate a plausible notation. If a mark is too smudged to read, pick \`unknown\` with confidence ≤ 0.3 and list alternatives.`;

/**
 * user メッセージテキストジェネレータ。
 * batting_order / inning は呼び出し側が把握している値で注入する。
 */
export function buildSingleCellRetryUserText(params: {
  batting_order: number;
  inning: number;
  priorReading?: {
    raw_notation: string | null;
    outcome: string | null;
    confidence: number;
  };
}): string {
  const base = `This is a single scorebook cell at batting_order=${params.batting_order}, inning=${params.inning}. Please re-read it carefully and return via the \`${SINGLE_CELL_RETRY_TOOL_NAME}\` tool.`;
  if (!params.priorReading) return base;
  const prior = params.priorReading;
  return `${base}

On the first pass, this cell was read as raw_notation=${JSON.stringify(prior.raw_notation)}, outcome=${JSON.stringify(prior.outcome)}, with confidence ${prior.confidence.toFixed(2)}. That reading is uncertain. Examine the cell independently — do not anchor on the prior reading if your new observation disagrees. Report all plausible alternatives.`;
}
