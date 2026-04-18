/**
 * Stage 2: 千葉式スコアブックプロンプト（Day 2 以降対応のスタブ）。
 *
 * docs/architecture.md §2 / §20.5 準拠。
 *
 * 千葉式（広川善任、1970s）は千葉県高校野球で用いられる地域式。
 * 既存サンプルに含まれず、Day 1 では Stage 1 で "chiba" を返されても
 * 実装として fallback=waseda（§20.5）に切り替える。
 *
 * このスタブは「千葉式確定時に warning を出すための骨組み」として残し、
 * Day 2 以降でサンプル収集後に本格実装する。
 */

export const CHIBA_EXTRACT_COLUMN_TOOL_NAME = "extract_column_cells";

export const CHIBA_SYSTEM_PROMPT = `You are an expert reader of Japanese amateur baseball scorebooks. The input is a Chiba-style (千葉式, Hirokawa Yoshito 1970s) scorebook column.

## Warning

This is a stub prompt for Day-2 coverage. Chiba-style notation details are not yet fully specified in this system. Classify fields to the best of your ability using the closest waseda-style interpretation.

## Fallback rule

- Apply waseda conventions unless you see clearly Chiba-specific marks.
- Report confidence ≤ 0.6 for any non-trivial reading.
- If the image seems closer to waseda or keio, flag that in \`evidence\` and list alternatives pointing at those styles.

## Output

Return via the \`${CHIBA_EXTRACT_COLUMN_TOOL_NAME}\` tool, one CellRead per batter slot. All \`extras\` fields must be filled. Blank cells get nulls + confidence 1.0.`;

export function buildChibaUserText(params: {
  inning: number;
  batterCount: number;
}): string {
  return `This image is inning **${params.inning}** of a chiba-style scorebook page (stub coverage). The lineup has ${params.batterCount} batters. Extract every cell using the \`${CHIBA_EXTRACT_COLUMN_TOOL_NAME}\` tool, reporting low confidence if chiba-specific conventions differ from waseda/keio.`;
}
