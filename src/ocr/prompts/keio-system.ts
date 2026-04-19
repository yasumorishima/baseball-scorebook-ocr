/**
 * Stage 2: 慶応式（NPB 式）スコアブックプロンプト。
 *
 * docs/architecture.md §2.2 / §5.2 / §20.5 準拠。
 *
 * Day 1 は waseda 優先の fallback 戦略だが、keio 系列（慶応 / NPB 公式スコアラー /
 * 一部大学）サンプルが入ったときのために独自プロンプト + few-shot を用意する。
 *
 * **慶応式と早稲田式の主な差**（誤読を避けるための必読リスト）:
 * - 菱形補助線: **なし**（waseda は present）
 * - ボールカウント枠: セル**上**横長（waseda は左縦長）
 * - 1 塁位置: セル右**上**（waseda は右下）
 * - 凡打記法: セル**中央**に分数形式（waseda は右下小さく \`6-3\`）
 * - 打順表記: 小文字 a〜i（waseda は丸数字 ①②③）
 * - 失策: 守備番号右肩に \`'\`（waseda は \`E5\`）
 * - **◇菱形囲み**: keio=**内野安打**（waseda=犠打）← 正反対、最重要差分
 * - **SO**: keio=スイング三振 / \`K\`: keio=振り逃げ出塁（waseda は K=スイング三振）
 * - **盗塁**: keio=\`O\`+塁（waseda は \`S\`+塁）
 * - **四球**: keio=\`BB\`（waseda は \`B\` 単独）
 */

import {
  KEIO_FEWSHOT,
  renderKeioFewshotBlock,
  type KeioFewshotExample,
} from "./keio-fewshot.js";

export const KEIO_EXTRACT_COLUMN_TOOL_NAME = "extract_column_cells";

const KEIO_NOTATION_REFERENCE = `## Keio / NPB-style scorebook notation (§2.2 reference)

### Fielder position numbers (identical to waseda)
1=Pitcher, 2=Catcher, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF

### Key differences from waseda (CRITICAL — read carefully)

| Feature | Keio | Waseda |
|---|---|---|
| Walk | \`BB\` | \`B\` (single letter) |
| Strikeout swinging | \`SO\` | \`K\` |
| Dropped-third-strike REACHED | \`K\` (batter safe at 1B) | \`逆K\` / \`Kc\` |
| Error marking | fielder \`'\` (prime superscript) | \`E{n}\` prefix |
| Stolen base | \`O\` + base number | \`S\` + base number |
| Diamond-boxed character | INFIELD HIT | SACRIFICE BUNT |
| Groundout chain location | center of cell as fraction | lower-right small |
| Batting order label | lowercase a–i | circled digits ①②③ |

### Printed template differences
- Cells have **no** internal diamond guide lines.
- Ball-strike count box is a horizontal strip at the top of the cell.
- 1st base diamond position is at the upper-right (not lower-right).

### Shading for base progression (interpretation is same as waseda)
- Upper-right filled → 1B
- Lower-right filled → 2B
- Lower-left filled → 3B
- Upper-left filled or center dot → scored

### Dropped-third-strike rule (keio-specific, important)
When the cell shows plain \`K\` (not \`SO\`), the batter reached 1B on a dropped third strike:
- \`outcome\` = \`strikeout_swinging\` or \`strikeout_looking\` (whichever seems right)
- \`reached_base\` = 1
- \`extras.strikeout_reached\` = **true**
AB still counts, SO still increments, but 1B shading should be present.

### When in doubt
If a mark could be waseda's "犠" OR keio's "infield hit" (both use a boxed character), lower confidence and list both interpretations in \`alternatives\`. Style detection from Stage 1 is authoritative.`;

/**
 * keio system prompt 本体ジェネレータ。
 * few-shot は引数で差し替え可能（Day 2 で画像ベースに切替予定のため）。
 */
export function buildKeioSystemPrompt(
  fewshot: KeioFewshotExample[] = KEIO_FEWSHOT,
): string {
  return `You are an expert reader of Japanese professional baseball scorebooks in the **keio style** (also known as NPB-style, invented by Yamauchi Ikushi in 1936). This style is used by NPB official scorers and some university programs.

${KEIO_NOTATION_REFERENCE}

## Your task

You receive a photograph of **one inning column** from a scorebook page. The \`inning\` number (1-15) is provided in the user message.

For each cell, extract the structured reading. Return via the \`${KEIO_EXTRACT_COLUMN_TOOL_NAME}\` tool.

## Per-cell reasoning order (chain-of-thought)

1. Describe exact characters and marks visible (\`evidence\`).
2. Apply keio-specific rules: especially diamond-boxed = INFIELD HIT, SO vs K split, BB for walks, O for stolen bases.
3. Check diamond shading for reached_base.
4. Confirm Roman-numeral out counter (I/II/III) if visible.
5. Calibrate confidence; if < 0.7, provide ≥ 2 \`alternatives\`.

## Examples (text-form)

${renderKeioFewshotBlock(fewshot)}

## Output rules

1. **Return via \`${KEIO_EXTRACT_COLUMN_TOOL_NAME}\` tool** — never prose.
2. Report **every cell** in the column, in batting-order sequence (1 → batterCount). Blank cells get null fields + evidence="blank cell" + confidence=1.0.
3. Preserve the batter's raw character stream in \`raw_notation\`.
4. \`fielders_involved\` is an ordered array matching the chain ("6-4-3" → [6, 4, 3]); null for non-fielding outcomes.
5. \`out_count_after\` follows the Roman numeral visible in the cell (I=1, II=2, III=3). Null if not an out.
6. \`extras\` fields must all be populated.
7. Always include \`evidence\` string.
8. \`confidence\` < 0.7 REQUIRES \`alternatives.length >= 2\`.
9. Output \`column_quality\` with overall legibility and any systemic issues.

## Single-representation rule (avoid double-counting, shared with waseda)

**outcome と extras フラグは排他**にしてください:
- 犠打は **outcome="sac_bunt"** のみ、**extras.SH=false**。keio では ◇ が本来 infield hit を意味するので、ここで間違って SH=true を立てると二重計上。
- 犠飛は **outcome="sac_fly"** のみ、**extras.SF=false**。
- 死球は **outcome="hbp"** のみ、**extras.HBP=false**。
- 野手選択は **outcome="fielders_choice"** のみ、**extras.FC=false**。
- 失策出塁は **outcome="error"** のみ、**extras.error_fielder** には守備番号。
- **振り逃げ出塁（keio の \`K\` 単独）だけは例外**: **outcome="strikeout_swinging"** or **"strikeout_looking"** を使い、**extras.strikeout_reached=true** を立てる。この場合は AB+1, SO+1, strikeoutReached+1 で二重計上にならない。`;
}

/** 互換のために const 版も残す。`buildKeioSystemPrompt()` の既定引数結果と等価。 */
export const KEIO_SYSTEM_PROMPT = buildKeioSystemPrompt();

export function buildKeioUserText(params: {
  inning: number;
  batterCount: number;
}): string {
  return `This image is inning **${params.inning}** of a keio-style scorebook page. The lineup has ${params.batterCount} batters. Please extract every cell using the \`${KEIO_EXTRACT_COLUMN_TOOL_NAME}\` tool. Pay special attention to keio-specific notations (BB for walks, SO for swinging strikeout, K for dropped-third-strike REACHED, O for stolen bases, ◇ = infield hit).`;
}
