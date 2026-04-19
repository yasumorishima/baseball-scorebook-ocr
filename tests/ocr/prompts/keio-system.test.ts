/**
 * keio-system.ts / keio-fewshot.ts の単体テスト。
 *
 * 本格実装の system prompt に keio-specific な差分が埋め込まれているか、
 * few-shot の排他 rule（BB vs B、K=dropped-third-strike、◇=infield hit 等）が
 * 正しく example に反映されているかを検証する。
 */

import { describe, expect, it } from "vitest";

import {
  buildKeioSystemPrompt,
  buildKeioUserText,
  KEIO_SYSTEM_PROMPT,
  KEIO_EXTRACT_COLUMN_TOOL_NAME,
} from "../../../src/ocr/prompts/keio-system.js";
import {
  KEIO_FEWSHOT,
  renderKeioFewshotBlock,
} from "../../../src/ocr/prompts/keio-fewshot.js";

describe("buildKeioSystemPrompt", () => {
  it("embeds the keio-specific notation differences table", () => {
    const prompt = buildKeioSystemPrompt();
    expect(prompt).toMatch(/Keio/);
    expect(prompt).toMatch(/BB/);
    expect(prompt).toMatch(/\bSO\b/);
    expect(prompt).toMatch(/INFIELD HIT/);
    expect(prompt).toMatch(/O.*stolen base/i);
  });

  it("includes the dropped-third-strike rule (strikeout_reached=true)", () => {
    const prompt = buildKeioSystemPrompt();
    expect(prompt).toMatch(/dropped.*third.*strike/i);
    expect(prompt).toMatch(/strikeout_reached/);
  });

  it("includes the single-representation rule (avoid double-counting)", () => {
    const prompt = buildKeioSystemPrompt();
    expect(prompt).toMatch(/Single-representation/i);
    expect(prompt).toMatch(/sac_bunt/);
    expect(prompt).toMatch(/fielders_choice/);
  });

  it("contains the keio tool name in output-rule section", () => {
    const prompt = buildKeioSystemPrompt();
    expect(prompt).toContain(KEIO_EXTRACT_COLUMN_TOOL_NAME);
  });

  it("is equal to the const KEIO_SYSTEM_PROMPT with default fewshot", () => {
    expect(buildKeioSystemPrompt()).toBe(KEIO_SYSTEM_PROMPT);
  });

  it("accepts a custom fewshot array", () => {
    const custom = [KEIO_FEWSHOT[0]];
    const prompt = buildKeioSystemPrompt(custom);
    expect(prompt).toContain(KEIO_FEWSHOT[0].rawNotation);
    // 2 番目以降の例は混入しない
    expect(prompt).not.toContain("IIISO");
  });

  it("renders waseda-incompatible walk example (BB not B)", () => {
    const bbExample = KEIO_FEWSHOT.find((ex) => ex.rawNotation === "BB");
    expect(bbExample).toBeDefined();
    expect(bbExample?.expected.outcome).toBe("walk");
    expect(bbExample?.expected.reached_base).toBe(1);
  });

  it("renders K = dropped-third-strike REACHED (keio-specific)", () => {
    const kExample = KEIO_FEWSHOT.find((ex) => ex.rawNotation === "K");
    expect(kExample).toBeDefined();
    expect(kExample?.expected.extras.strikeout_reached).toBe(true);
    expect(kExample?.expected.reached_base).toBe(1);
    expect(kExample?.expected.outcome).toBe("strikeout_swinging");
  });

  it("renders ◇-boxed = infield hit (opposite of waseda's sac bunt)", () => {
    const diamondExample = KEIO_FEWSHOT.find((ex) =>
      ex.rawNotation.includes("◇"),
    );
    expect(diamondExample).toBeDefined();
    expect(diamondExample?.expected.outcome).toBe("single");
    expect(diamondExample?.expected.reached_base).toBe(1);
    // 重要: SH=false である（waseda の犠打と逆）
    expect(diamondExample?.expected.extras.SH).toBe(false);
  });
});

describe("renderKeioFewshotBlock", () => {
  it("wraps each example in an <example> block with raw_notation + expected_output", () => {
    const block = renderKeioFewshotBlock();
    expect(block).toContain('<example index="1"');
    expect(block).toContain("<raw_notation>");
    expect(block).toContain("<expected_output>");
    expect(block).toContain("</example>");
  });

  it("produces one example block per fewshot entry", () => {
    const block = renderKeioFewshotBlock();
    const matches = block.match(/<example index="/g) ?? [];
    expect(matches.length).toBe(KEIO_FEWSHOT.length);
  });

  it("keeps JSON strictly parseable for every example", () => {
    for (const ex of KEIO_FEWSHOT) {
      const json = JSON.stringify(ex.expected, null, 2);
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });
});

describe("buildKeioUserText", () => {
  it("includes the inning number and batter count", () => {
    const text = buildKeioUserText({ inning: 4, batterCount: 11 });
    expect(text).toMatch(/inning \*\*4\*\*/);
    expect(text).toMatch(/11 batters/);
  });

  it("mentions keio-specific caveats (BB / SO / K / O / ◇)", () => {
    const text = buildKeioUserText({ inning: 1, batterCount: 9 });
    expect(text).toMatch(/BB/);
    expect(text).toMatch(/SO/);
    expect(text).toMatch(/O for stolen bases/);
    expect(text).toMatch(/◇/);
  });
});
