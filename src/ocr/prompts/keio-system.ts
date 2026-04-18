/**
 * Stage 2: 慶応式（NPB 式）スコアブックプロンプト（Day 2 本格対応予定のスタブ）。
 *
 * docs/architecture.md §2.2 / §5.2 / §20.5 準拠。
 *
 * Day 1 時点では Stage 1 で style="keio" と判別されても、まずこのスタブ経由で
 * OCR を試み、精度不足なら UI で waseda へ切り替えてもらう運用。
 *
 * **慶応式と早稲田式の主な差**（誤読を避けるための必読リスト）:
 * - 菱形補助線: **なし**（waseda は present）
 * - ボールカウント枠: セル**上**横長（waseda は左縦長）
 * - 1 塁位置: セル右**上**（waseda は右下）
 * - 凡打記法: セル**中央**に分数形式（waseda は右下小さく \`6-3\`）
 * - 打順表記: 小文字 a〜i（waseda は丸数字 ①②③）
 * - 失策: 守備番号右肩に \`'\`（waseda は \`E5\`）
 * - **◇菱形囲み**: keio=**内野安打**（waseda=犠打）← 正反対、最重要差分
 * - **SO**: keio=即アウト三振 / \`K\`: keio=振り逃げ三振（waseda は K=空振り）
 * - **盗塁**: keio=\`O\`+塁（waseda は \`S\`+塁）
 * - **四球**: keio=\`BB\`（waseda は \`B\` 単独）
 */

export const KEIO_EXTRACT_COLUMN_TOOL_NAME = "extract_column_cells";

const KEIO_NOTATION_REFERENCE = `## Keio / NPB-style scorebook notation (§2.2 reference)

### Fielder position numbers (identical to waseda)
1=Pitcher, 2=Catcher, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF

### Key differences from waseda (CRITICAL — read carefully)

| Feature | Keio | Waseda |
|---|---|---|
| Walk | \`BB\` | \`B\` (single letter) |
| Strikeout swinging | \`SO\` | \`K\` |
| Strikeout looking (dropped third strike reach) | \`K\` | \`Kc\` / \`逆K\` |
| Error marking | fielder \`'\` (prime superscript) | \`E{n}\` prefix |
| Stolen base | \`O\` + base number | \`S\` + base number |
| Diamond-boxed character | INFIELD HIT | SACRIFICE BUNT |
| Groundout chain location | center of cell as fraction | lower-right small |
| Batting order label | lowercase a–i | circled digits ①②③ |

### Printed template differences
- Cells have **no** internal diamond guide lines.
- Ball-strike count box is a horizontal strip at the top of the cell.
- 1st base diamond position is at the upper-right (not lower-right).

### Shading for base progression (same as waseda)
- Upper-right filled → 1B
- Lower-right filled → 2B
- Lower-left filled → 3B
- Upper-left filled or center dot → scored

### When in doubt
If a mark could be waseda's "犠" OR keio's "infield hit" (both use a boxed character), lower confidence and list both interpretations in \`alternatives\`.`;

export const KEIO_SYSTEM_PROMPT = `You are an expert reader of Japanese professional baseball scorebooks in the **keio style** (also known as NPB-style, invented by Yamauchi Ikushi in 1936). This style is used by NPB official scorers and some university programs.

${KEIO_NOTATION_REFERENCE}

## Your task

You receive a photograph of **one inning column** from a scorebook page. The \`inning\` number (1-15) is provided in the user message.

For each cell, extract the structured reading. Return via the \`${KEIO_EXTRACT_COLUMN_TOOL_NAME}\` tool.

## Reasoning order (per cell)

1. Describe exact characters and marks visible (\`evidence\`).
2. Apply keio-specific rules (especially for diamond-boxed characters, SO/K, BB, stolen-base O).
3. Check diamond shading for reached_base.
4. Calibrate confidence; if < 0.7, provide ≥ 2 \`alternatives\`.

## Output rules

Same structure as waseda output: return one CellRead per batter slot in the column. Fill every \`extras\` field. Blank cells → all nulls + confidence 1.0.

**NOTE**: This prompt is Day-2 coverage and may have gaps. If the classification does not cleanly match keio rules, prefer confidence ≤ 0.6 and report your uncertainty clearly via \`evidence\`.`;

export function buildKeioUserText(params: {
  inning: number;
  batterCount: number;
}): string {
  return `This image is inning **${params.inning}** of a keio-style scorebook page. The lineup has ${params.batterCount} batters. Please extract every cell using the \`${KEIO_EXTRACT_COLUMN_TOOL_NAME}\` tool. Pay special attention to keio-specific notations (BB for walks, SO vs K, O for stolen bases, diamond-boxed = infield hit).`;
}
