/**
 * retry-low-conf.ts の単体テスト（mock SDK + 合成画像）。
 */

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  computeCellRect,
  LOW_CONFIDENCE_THRESHOLD,
  POST_RETRY_REVIEW_THRESHOLD,
  retryLowConfCells,
} from "../../src/ocr/retry-low-conf.js";
import type { CellRead } from "../../src/types/cell.js";
import type { Grid } from "../../src/types/grid.js";
import type { Rect } from "../../src/types/layout.js";

const EXTRAS: CellRead["extras"] = {
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

function makeCell(bo: number, inn: number, conf: number): CellRead {
  return {
    batting_order: bo,
    inning: inn,
    raw_notation: "?",
    outcome: "unknown",
    fielders_involved: null,
    reached_base: null,
    out_count_after: null,
    pitch_count: null,
    extras: EXTRAS,
    evidence: "smudged",
    confidence: conf,
    alternatives: ["F7", "F8"],
  };
}

function makeGrid(cells: CellRead[]): Grid<CellRead> {
  const g: Grid<CellRead> = Array.from({ length: 10 }, () =>
    Array.from({ length: 13 }, () => null),
  );
  for (const c of cells) {
    g[c.batting_order - 1][c.inning - 1] = c;
  }
  return g;
}

async function makeSource(): Promise<Buffer> {
  return sharp({
    create: { width: 3300, height: 2550, channels: 3, background: { r: 220, g: 220, b: 220 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function makeInningRects(): Rect[] {
  // 13 イニング等分 (0.135 ~ 0.770 = width 2095 ~ inningW 161)
  const playerX = Math.round(3300 * 0.135);
  const statsX = Math.round(3300 * 0.77);
  const playGridW = statsX - playerX;
  const inningW = Math.floor(playGridW / 13);
  const headerY = Math.round(2550 * 0.16);
  const playGridH = Math.round(2550 * 0.52) - headerY;
  return Array.from({ length: 13 }, (_, i) => ({
    x: playerX + i * inningW,
    y: headerY,
    width: i === 12 ? playGridW - 12 * inningW : inningW,
    height: playGridH,
  }));
}

function fakeRetryMessage(
  batting_order: number,
  inning: number,
  confidence: number,
  raw_notation = "F8",
) {
  return {
    id: "msg_r",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: "tu_r",
        name: "read_single_cell",
        input: {
          batting_order,
          inning,
          raw_notation,
          outcome: "fly_out",
          fielders_involved: [8],
          reached_base: 0,
          out_count_after: 1,
          pitch_count: null,
          extras: EXTRAS,
          evidence: "clear F8 after zoom",
          confidence,
          alternatives: [],
        },
      },
    ],
    usage: {
      input_tokens: 300,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

describe("computeCellRect", () => {
  it("splits an inning column into batterCount equal cells", () => {
    const rects = makeInningRects();
    const cell0 = computeCellRect(rects, 0, 0, 10);
    const cell1 = computeCellRect(rects, 0, 1, 10);
    expect(cell0.x).toBe(rects[0].x);
    expect(cell0.y).toBe(rects[0].y);
    expect(cell1.y).toBeGreaterThan(cell0.y);
    expect(cell0.width).toBe(rects[0].width);
  });

  it("last batter absorbs the height remainder", () => {
    const rects = makeInningRects();
    const totalH = rects[0].height;
    const cells = Array.from({ length: 10 }, (_, i) =>
      computeCellRect(rects, 0, i, 10),
    );
    const summedH = cells.reduce((s, c) => s + c.height, 0);
    expect(summedH).toBe(totalH);
  });

  it("throws on out-of-range indices", () => {
    const rects = makeInningRects();
    expect(() => computeCellRect(rects, -1, 0, 10)).toThrow();
    expect(() => computeCellRect(rects, 0, 10, 10)).toThrow();
  });
});

describe("retryLowConfCells", () => {
  it("returns unchanged when no cells are below threshold", async () => {
    const grid = makeGrid([makeCell(1, 1, 0.9), makeCell(2, 1, 0.95)]);
    const res = (await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      client: { messages: { create: vi.fn() } } as never,
      onLog: () => {},
    })) as Exclude<Awaited<ReturnType<typeof retryLowConfCells>>, Array<unknown>>;
    expect(res.retried).toEqual([]);
    expect(res.reviewFlags).toEqual([]);
    expect(res.grid[0][0]?.confidence).toBe(0.9);
  });

  it("re-reads low-confidence cells and upgrades when retry confidence is higher", async () => {
    const grid = makeGrid([
      makeCell(1, 1, 0.3),
      makeCell(2, 1, 0.95),
      makeCell(3, 1, 0.4),
    ]);
    const create = vi.fn(async (body: { messages: { content: { type: string; text?: string }[] }[] }) => {
      const text =
        body.messages[0].content.find((c) => c.type === "text")?.text ?? "";
      const m = /batting_order=(\d+), inning=(\d+)/.exec(text);
      const bo = m ? parseInt(m[1], 10) : 0;
      const inn = m ? parseInt(m[2], 10) : 0;
      return fakeRetryMessage(bo, inn, 0.88, "F8");
    });
    const res = (await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
      concurrency: 2,
    })) as Exclude<Awaited<ReturnType<typeof retryLowConfCells>>, Array<unknown>>;

    expect(create).toHaveBeenCalledTimes(2);
    expect(res.retried.length).toBe(2);
    expect(res.retried.every((r) => r.upgraded)).toBe(true);
    expect(res.grid[0][0]?.confidence).toBe(0.88);
    expect(res.grid[2][0]?.confidence).toBe(0.88);
    expect(res.grid[1][0]?.confidence).toBe(0.95); // untouched
  });

  it("keeps original when retry confidence is not higher", async () => {
    const grid = makeGrid([makeCell(1, 1, 0.4)]);
    const create = vi.fn(async () => fakeRetryMessage(1, 1, 0.3));
    const res = (await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
    })) as Exclude<Awaited<ReturnType<typeof retryLowConfCells>>, Array<unknown>>;
    expect(res.retried[0].upgraded).toBe(false);
    expect(res.grid[0][0]?.confidence).toBe(0.4);
  });

  it("flags cells that remain below POST_RETRY_REVIEW_THRESHOLD", async () => {
    const grid = makeGrid([makeCell(1, 1, 0.3)]);
    const create = vi.fn(async () =>
      fakeRetryMessage(1, 1, POST_RETRY_REVIEW_THRESHOLD - 0.05),
    );
    const res = (await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
    })) as Exclude<Awaited<ReturnType<typeof retryLowConfCells>>, Array<unknown>>;
    expect(res.reviewFlags.length).toBe(1);
    expect(res.reviewFlags[0]).toMatchObject({ batting_order: 1, inning: 1 });
  });

  it("respects the low-confidence threshold (boundary)", async () => {
    const grid = makeGrid([
      makeCell(1, 1, LOW_CONFIDENCE_THRESHOLD - 0.01),
      makeCell(2, 1, LOW_CONFIDENCE_THRESHOLD),
    ]);
    const create = vi.fn(async () => fakeRetryMessage(1, 1, 0.9));
    const res = (await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      client: { messages: { create } } as never,
      onLog: () => {},
    })) as Exclude<Awaited<ReturnType<typeof retryLowConfCells>>, Array<unknown>>;
    // 閾値ちょうどは retry 対象外
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.retried.length).toBe(1);
  });

  it("dryRun returns an array of dry-run payloads without hitting SDK", async () => {
    const grid = makeGrid([makeCell(1, 1, 0.3), makeCell(2, 1, 0.4)]);
    const create = vi.fn();
    const res = await retryLowConfCells(grid, await makeSource(), makeInningRects(), 10, {
      dryRun: true,
      client: { messages: { create } } as never,
      onLog: () => {},
    });
    expect(Array.isArray(res)).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("all-dryRun path returns homogeneous array (invariant validation)", async () => {
    // 全 call が dryRun である前提を実装側 assertion が守ること
    const grid = makeGrid([
      makeCell(1, 1, 0.2),
      makeCell(2, 1, 0.3),
      makeCell(3, 1, 0.4),
    ]);
    const create = vi.fn();
    const res = await retryLowConfCells(
      grid,
      await makeSource(),
      makeInningRects(),
      10,
      {
        dryRun: true,
        client: { messages: { create } } as never,
        onLog: () => {},
      },
    );
    expect(Array.isArray(res)).toBe(true);
    if (Array.isArray(res)) {
      // 3 セル分の dryRun payload を受け取る
      expect(res.length).toBe(3);
      // 全て dryRun フラグ付きで homogeneous
      expect(res.every((r) => r.dryRun === true)).toBe(true);
    }
  });
});
