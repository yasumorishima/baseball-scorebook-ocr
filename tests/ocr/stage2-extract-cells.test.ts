/**
 * stage2-extract-cells.ts の単体テスト（mock SDK）。
 */

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  extractStage2Columns,
  MIN_COLUMN_LONG_EDGE,
  runWithConcurrency,
  upscaleColumn,
} from "../../src/ocr/stage2-extract-cells.js";

async function makeColumn(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function cellsFor(inning: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    batting_order: i + 1,
    inning,
    raw_notation: null,
    outcome: null,
    fielders_involved: null,
    reached_base: null,
    out_count_after: null,
    pitch_count: null,
    extras: {
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
    },
    evidence: "blank cell",
    confidence: 1.0,
    alternatives: [],
  }));
}

function fakeStage2Message(inning: number, batterCount: number) {
  return {
    id: `msg_${inning}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: `tu_${inning}`,
        name: "extract_column_cells",
        input: {
          inning,
          cells: cellsFor(inning, batterCount),
          column_quality: { legibility: 0.9, issues: [] },
        },
      },
    ],
    usage: {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
    },
  };
}

describe("upscaleColumn", () => {
  it("upscales columns below the min long edge", async () => {
    const small = await makeColumn(161, 100);
    const up = await upscaleColumn(small, MIN_COLUMN_LONG_EDGE);
    const meta = await sharp(up).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThanOrEqual(
      MIN_COLUMN_LONG_EDGE,
    );
  });

  it("preserves aspect ratio when upscaling", async () => {
    const small = await makeColumn(100, 400);
    const up = await upscaleColumn(small, MIN_COLUMN_LONG_EDGE);
    const meta = await sharp(up).metadata();
    expect(meta.height).toBeGreaterThan(meta.width ?? 0);
  });

  it("does not upscale when already at or above min", async () => {
    const big = await makeColumn(400, 500);
    const out = await upscaleColumn(big, MIN_COLUMN_LONG_EDGE);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(500);
  });
});

describe("runWithConcurrency", () => {
  it("preserves input order in results array", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("actually limits in-flight workers", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runWithConcurrency(items, 3, async (x) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return x;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input", async () => {
    const results = await runWithConcurrency([] as number[], 3, async (x) => x);
    expect(results).toEqual([]);
  });
});

describe("extractStage2Columns", () => {
  it("returns one parsed response per input column (waseda style)", async () => {
    const cols = [
      { inning: 1, columnImage: await makeColumn(400, 1200) },
      { inning: 2, columnImage: await makeColumn(400, 1200) },
      { inning: 3, columnImage: await makeColumn(400, 1200) },
    ];
    const create = vi.fn(async (body: { messages: { content: unknown[] }[] }) => {
      // inning は user text から読み取らず、この mock では順番依存で割り当て
      const inningMatch = /inning \*\*(\d+)\*\*/.exec(
        (body.messages[0].content as { type: string; text?: string }[]).find(
          (c) => c.type === "text",
        )?.text ?? "",
      );
      const inning = inningMatch ? parseInt(inningMatch[1], 10) : 0;
      return fakeStage2Message(inning, 10);
    });
    const results = await extractStage2Columns(cols, "waseda", 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
      concurrency: 2,
    });
    expect(results.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const r = results[i];
      if ("dryRun" in r) throw new Error("unexpected dryRun");
      expect(r.inning).toBe(i + 1);
      expect(r.response.cells.length).toBe(10);
    }
  });

  it("selects keio prompt when style=keio (different system text sent)", async () => {
    const cols = [{ inning: 1, columnImage: await makeColumn(400, 1200) }];
    const create = vi.fn(async () => fakeStage2Message(1, 10));
    await extractStage2Columns(cols, "keio", 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    const calls = create.mock.calls as unknown as Array<[unknown]>;
    const body = calls[0][0] as {
      system: { text: string }[];
    };
    expect(body.system[0].text).toMatch(/keio/i);
  });

  it("treats style=unknown as waseda (Day 1 fallback)", async () => {
    const cols = [{ inning: 1, columnImage: await makeColumn(400, 1200) }];
    const create = vi.fn(async () => fakeStage2Message(1, 10));
    await extractStage2Columns(cols, "unknown", 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    const calls = create.mock.calls as unknown as Array<[unknown]>;
    const body = calls[0][0] as {
      system: { text: string }[];
    };
    expect(body.system[0].text).toMatch(/waseda/i);
  });

  it("propagates dryRun=true without calling SDK", async () => {
    const cols = [
      { inning: 1, columnImage: await makeColumn(400, 1200) },
      { inning: 2, columnImage: await makeColumn(400, 1200) },
    ];
    const create = vi.fn();
    const results = await extractStage2Columns(cols, "waseda", 10, {
      dryRun: true,
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    expect(create).not.toHaveBeenCalled();
    expect(results.length).toBe(2);
    for (const r of results) {
      expect("dryRun" in r).toBe(true);
    }
  });

  it("respects batterCount in the user text", async () => {
    const cols = [{ inning: 1, columnImage: await makeColumn(400, 1200) }];
    const create = vi.fn(async () => fakeStage2Message(1, 11));
    await extractStage2Columns(cols, "waseda", 11, {
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    const calls = create.mock.calls as unknown as Array<[unknown]>;
    const body = calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const userText = body.messages[0].content.find(
      (c) => c.type === "text",
    )?.text;
    expect(userText).toContain("11 batters");
  });
});
