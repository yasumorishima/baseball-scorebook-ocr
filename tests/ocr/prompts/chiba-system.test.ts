/**
 * chiba-system.ts / chiba-fewshot.ts の単体テスト。
 *
 * Day 1 の stub は "waseda fallback + 低 confidence 運用" が骨子。
 * few-shot と prompt がその方針を正しく反映しているかを検証する。
 */

import { describe, expect, it } from "vitest";

import {
  buildChibaSystemPrompt,
  buildChibaUserText,
  CHIBA_SYSTEM_PROMPT,
  CHIBA_EXTRACT_COLUMN_TOOL_NAME,
} from "../../../src/ocr/prompts/chiba-system.js";
import {
  CHIBA_FEWSHOT,
  renderChibaFewshotBlock,
} from "../../../src/ocr/prompts/chiba-fewshot.js";

describe("buildChibaSystemPrompt", () => {
  it("declares Day-1 stub status and waseda fallback explicitly", () => {
    const prompt = buildChibaSystemPrompt();
    expect(prompt).toMatch(/Day-1 coverage caveat/i);
    expect(prompt).toMatch(/waseda fallback/i);
  });

  it("lists waseda-compatible shared conventions", () => {
    const prompt = buildChibaSystemPrompt();
    expect(prompt).toMatch(/Roman numerals/i);
    expect(prompt).toMatch(/F\{n\} \/ L\{n\} \/ P\{n\}/);
    expect(prompt).toMatch(/1B \/ 2B \/ 3B \/ HR/);
  });

  it("instructs low confidence on chiba-ambiguous marks", () => {
    const prompt = buildChibaSystemPrompt();
    expect(prompt).toMatch(/confidence.*0\.[5-7]/);
    expect(prompt).toMatch(/outcome="unknown"/);
    expect(prompt).toMatch(/alternatives/i);
  });

  it("includes the chiba tool name", () => {
    const prompt = buildChibaSystemPrompt();
    expect(prompt).toContain(CHIBA_EXTRACT_COLUMN_TOOL_NAME);
  });

  it("is equal to const CHIBA_SYSTEM_PROMPT with default fewshot", () => {
    expect(buildChibaSystemPrompt()).toBe(CHIBA_SYSTEM_PROMPT);
  });

  it("carries the single-representation rule forward (shared with waseda/keio)", () => {
    const prompt = buildChibaSystemPrompt();
    expect(prompt).toMatch(/Single-representation/i);
    expect(prompt).toMatch(/strikeout_reached/);
  });

  it("accepts a custom fewshot array", () => {
    const prompt = buildChibaSystemPrompt([CHIBA_FEWSHOT[0]]);
    expect(prompt).toContain(CHIBA_FEWSHOT[0].rawNotation);
  });
});

describe("CHIBA_FEWSHOT", () => {
  it("keeps at least one waseda-safe example and one unknown/fallback example", () => {
    const safeExample = CHIBA_FEWSHOT.find(
      (ex) => ex.expected.confidence >= 0.8,
    );
    const uncertainExample = CHIBA_FEWSHOT.find(
      (ex) => ex.expected.confidence < 0.5,
    );
    expect(safeExample).toBeDefined();
    expect(uncertainExample).toBeDefined();
  });

  it("marks the chiba-specific unknown example as outcome=unknown", () => {
    const unknown = CHIBA_FEWSHOT.find((ex) => ex.expected.outcome === "unknown");
    expect(unknown).toBeDefined();
    expect(unknown?.expected.reached_base).toBeNull();
    expect(unknown?.expected.out_count_after).toBeNull();
  });

  it("ensures every low-confidence example (conf<0.7) carries alternatives >= 2", () => {
    // CellReadSchema 要件と Single-representation rule の保護。
    // Day 2 で新規 example を足したときに alternatives 欠落を静的検出する。
    for (const ex of CHIBA_FEWSHOT) {
      if (ex.expected.confidence < 0.7) {
        const alts = ex.expected.alternatives ?? [];
        expect(alts.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps expected JSON strictly parseable for every example", () => {
    for (const ex of CHIBA_FEWSHOT) {
      const json = JSON.stringify(ex.expected, null, 2);
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });
});

describe("renderChibaFewshotBlock", () => {
  it("wraps each example in an <example> block", () => {
    const block = renderChibaFewshotBlock();
    expect(block).toContain('<example index="1"');
    expect(block).toContain("<raw_notation>");
    expect(block).toContain("<expected_output>");
  });

  it("produces one example block per fewshot entry", () => {
    const block = renderChibaFewshotBlock();
    const matches = block.match(/<example index="/g) ?? [];
    expect(matches.length).toBe(CHIBA_FEWSHOT.length);
  });
});

describe("buildChibaUserText", () => {
  it("includes the inning number, batter count, and stub warning", () => {
    const text = buildChibaUserText({ inning: 2, batterCount: 10 });
    expect(text).toMatch(/inning \*\*2\*\*/);
    expect(text).toMatch(/10 batters/);
    expect(text).toMatch(/stub/i);
    expect(text).toMatch(/waseda fallback/i);
  });
});
