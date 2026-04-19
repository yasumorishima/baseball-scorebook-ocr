/**
 * pipeline.ts の統合テスト（mock SDK end-to-end）。
 *
 * 合成 3300×2550 キャンバスを入力に、Stage 1 + Stage 2 × 13 + retry を
 * 1 つの mock で route してパイプライン全体を走らせる。
 */

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { estimateCost, runPipeline } from "../src/pipeline.js";
import type { PipelineDryRun, PipelineResult } from "../src/pipeline.js";

async function landscapeCanvas(): Promise<Buffer> {
  return sharp({
    create: { width: 3300, height: 2550, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

const BLANK_EXTRAS = {
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

type MockCell = {
  batting_order: number;
  inning: number;
  raw_notation: string | null;
  outcome: string | null;
  fielders_involved: number[] | null;
  reached_base: number | null;
  out_count_after: number | null;
  pitch_count: null;
  extras: typeof BLANK_EXTRAS;
  evidence: string;
  confidence: number;
  alternatives: string[];
};

function blankCells(inning: number, batterCount: number): MockCell[] {
  return Array.from({ length: batterCount }, (_, i) => ({
    batting_order: i + 1,
    inning,
    raw_notation: null,
    outcome: null,
    fielders_involved: null,
    reached_base: null,
    out_count_after: null,
    pitch_count: null,
    extras: BLANK_EXTRAS,
    evidence: "blank cell",
    confidence: 1.0,
    alternatives: [],
  }));
}

/**
 * Stage 1 で waseda/0.9, Stage 2 で 10 blank cells を返す multiplexed mock。
 */
function makeRouter(options: {
  batterCount?: number;
  styleConfidence?: number;
  lowConfIsAt?: Array<{ batting_order: number; inning: number; conf: number }>;
}) {
  const batterCount = options.batterCount ?? 10;
  return vi.fn(async (body: { tool_choice?: { name?: string } }) => {
    const toolName = body.tool_choice?.name;
    if (toolName === "detect_style") {
      return {
        id: "msg_s1",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        stop_sequence: null,
        content: [
          {
            type: "tool_use",
            id: "tu_s1",
            name: "detect_style",
            input: {
              style: "waseda",
              evidence: {
                diamond_guide_lines: "present",
                ball_count_box: "left_vertical",
                first_base_position: "bottom_right",
                groundout_position: "bottom_right_small",
                error_symbol: "E_prefix",
                batting_order_style: "circled_digits",
              },
              confidence: options.styleConfidence ?? 0.95,
            },
          },
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    }
    if (toolName === "extract_column_cells") {
      const messages = body as unknown as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const text =
        messages.messages[0].content.find((c) => c.type === "text")?.text ?? "";
      const m = /inning \*\*(\d+)\*\*/.exec(text);
      const inning = m ? parseInt(m[1], 10) : 1;
      const cells = blankCells(inning, batterCount);
      // 指定された位置に low-confidence を注入（retry 発火テスト用）
      if (options.lowConfIsAt) {
        for (const p of options.lowConfIsAt) {
          if (p.inning === inning) {
            const idx = cells.findIndex((c) => c.batting_order === p.batting_order);
            if (idx >= 0) {
              cells[idx] = {
                ...cells[idx],
                raw_notation: "?",
                outcome: "unknown",
                evidence: "smudged",
                confidence: p.conf,
                alternatives: ["F7", "F8"],
              };
            }
          }
        }
      }
      return {
        id: `msg_s2_${inning}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        stop_sequence: null,
        content: [
          {
            type: "tool_use",
            id: `tu_s2_${inning}`,
            name: "extract_column_cells",
            input: {
              inning,
              cells,
              column_quality: { legibility: 0.95, issues: [] },
            },
          },
        ],
        usage: {
          input_tokens: 3000,
          output_tokens: 1500,
          cache_creation_input_tokens: inning === 1 ? 2000 : 0,
          cache_read_input_tokens: inning > 1 ? 2000 : 0,
        },
      };
    }
    if (toolName === "read_single_cell") {
      const messages = body as unknown as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const text =
        messages.messages[0].content.find((c) => c.type === "text")?.text ?? "";
      const m = /batting_order=(\d+), inning=(\d+)/.exec(text);
      const bo = m ? parseInt(m[1], 10) : 0;
      const inning = m ? parseInt(m[2], 10) : 0;
      return {
        id: "msg_retry",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        stop_sequence: null,
        content: [
          {
            type: "tool_use",
            id: "tu_retry",
            name: "read_single_cell",
            input: {
              batting_order: bo,
              inning,
              raw_notation: "F8",
              outcome: "fly_out",
              fielders_involved: [8],
              reached_base: 0,
              out_count_after: 1,
              pitch_count: null,
              extras: BLANK_EXTRAS,
              evidence: "clear F8 after zoom",
              confidence: 0.9,
              alternatives: [],
            },
          },
        ],
        usage: {
          input_tokens: 400,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 200,
        },
      };
    }
    throw new Error(`mock router: unknown tool ${toolName}`);
  });
}

describe("runPipeline (integration)", () => {
  it("runs end-to-end with a synthetic landscape canvas", async () => {
    const img = await landscapeCanvas();
    const router = makeRouter({ batterCount: 10 });
    const result = (await runPipeline(
      { image: img, batterCount: 10 },
      { client: { messages: { create: router } } as never, onLog: () => {} },
    )) as PipelineResult;

    expect("dryRun" in result).toBe(false);
    expect(result.style).toBe("waseda");
    expect(result.styleFallbackApplied).toBe(false);
    expect(result.grid.length).toBe(10);
    expect(result.grid[0].length).toBe(13);
    expect(result.players.length).toBe(10);
    expect(result.costEstimate.totalUsdCents).toBeGreaterThan(0);
    expect(result.apiAttempts).toBeGreaterThanOrEqual(14); // 1 stage1 + 13 stage2
    expect(result.phaseTimingsMs.stage2).toBeGreaterThan(0);
    // Stage 1 + 13 Stage 2 = 14 calls
    expect(router).toHaveBeenCalledTimes(14);
  });

  it("fires retries for low-confidence cells and logs reviewFlags", async () => {
    const img = await landscapeCanvas();
    const router = makeRouter({
      batterCount: 10,
      lowConfIsAt: [
        { batting_order: 3, inning: 1, conf: 0.3 },
        { batting_order: 5, inning: 2, conf: 0.4 },
      ],
    });
    const result = (await runPipeline(
      { image: img, batterCount: 10 },
      { client: { messages: { create: router } } as never, onLog: () => {} },
    )) as PipelineResult;
    // 1 stage1 + 13 stage2 + 2 retry = 16 calls
    expect(router).toHaveBeenCalledTimes(16);
    // retry が上書きして confidence 0.9 になるので reviewFlags は空
    expect(result.reviewFlags).toEqual([]);
    // retry で outcome が fly_out に上書きされている
    const b3i1 = result.grid[2][0];
    expect(b3i1?.outcome).toBe("fly_out");
    expect(b3i1?.confidence).toBe(0.9);
  });

  it("honors forcedStyle to skip Stage 1", async () => {
    const img = await landscapeCanvas();
    const router = makeRouter({ batterCount: 10 });
    const result = (await runPipeline(
      { image: img, batterCount: 10, forcedStyle: "keio" },
      { client: { messages: { create: router } } as never, onLog: () => {} },
    )) as PipelineResult;
    expect(result.style).toBe("keio");
    // Stage 1 skipped → 13 stage2 only
    expect(router).toHaveBeenCalledTimes(13);
  });

  it("emits warnings for style fallback and quality issues", async () => {
    // 暗いキャンバス (mean luma < 80) で quality warning 発火
    const dark = await sharp({
      create: { width: 3300, height: 2550, channels: 3, background: { r: 20, g: 20, b: 20 } },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    const router = makeRouter({ batterCount: 10, styleConfidence: 0.3 });
    const result = (await runPipeline(
      { image: dark, batterCount: 10 },
      { client: { messages: { create: router } } as never, onLog: () => {} },
    )) as PipelineResult;
    expect(result.warnings.some((w) => /quality issues/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /style fallback/.test(w))).toBe(true);
    expect(result.styleFallbackApplied).toBe(true);
  });

  it("dryRun mode skips merge/retry/validate/stats and returns payload dump", async () => {
    const img = await landscapeCanvas();
    const create = vi.fn();
    const result = (await runPipeline(
      { image: img, batterCount: 10, dryRun: true },
      { client: { messages: { create } } as never, onLog: () => {} },
    )) as PipelineDryRun;
    expect(result.dryRun).toBe(true);
    expect(create).not.toHaveBeenCalled();
    // Stage 1 + 13 Stage 2 = 14 payloads
    expect(result.payloads.length).toBe(14);
    expect(result.normalizedSize.width).toBe(2576);
  });
});

describe("estimateCost", () => {
  it("input 10k tokens at $15/Mtok = 15 cents", () => {
    const c = estimateCost({
      input_tokens: 10_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(c.breakdown.inputUsdCents).toBeCloseTo(15, 1);
  });

  it("combines all four token categories", () => {
    const c = estimateCost({
      input_tokens: 1_000,
      output_tokens: 1_000,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 1_000,
    });
    const sum =
      c.breakdown.inputUsdCents +
      c.breakdown.outputUsdCents +
      c.breakdown.cacheWriteUsdCents +
      c.breakdown.cacheReadUsdCents;
    expect(c.totalUsdCents).toBeCloseTo(sum, 2);
  });
});
