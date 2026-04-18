/**
 * crop-innings.ts の単体テスト。
 *
 * 3300×2550 の合成 landscape キャンバスを入力に、各論理領域の pixel bounds が
 * 期待値と ≤ 5% 誤差で一致することを検証する。
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { cropInnings } from "../../src/preprocess/crop-innings.js";
import { SEIBIDO_9104_WASEDA } from "../../src/types/layout.js";
import type { Rect, ScorebookLayout } from "../../src/types/layout.js";

const LANDSCAPE_W = 3300;
const LANDSCAPE_H = 2550;

/** 指定サイズのフラット画像を生成（内容は問わない、サイズだけ重要）。 */
async function canvas(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

async function dimsOf(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width!, height: meta.height! };
}

/** rect.width × rect.height と実バッファの実サイズが一致するか。 */
async function expectRectMatchesBuffer(rect: Rect, buf: Buffer): Promise<void> {
  const d = await dimsOf(buf);
  expect(d).toEqual({ width: rect.width, height: rect.height });
}

describe("cropInnings (SEIBIDO_9104_WASEDA defaults)", () => {
  it("splits a 3300x2550 canvas into regions matching v2 ratios", async () => {
    const img = await canvas(LANDSCAPE_W, LANDSCAPE_H);
    const result = await cropInnings(img);
    const { rects } = result.meta;

    // 既定比率: player 0-0.135, stats 0.770-1.0, header 0-0.160,
    // playGrid 0.160-0.520, totals 0.520-0.570, pitcher 0.570-0.830
    const playerX = Math.round(LANDSCAPE_W * 0.135); // 446
    const statsX = Math.round(LANDSCAPE_W * 0.77); // 2541
    const headerY = Math.round(LANDSCAPE_H * 0.16); // 408
    const playY = Math.round(LANDSCAPE_H * 0.52); // 1326
    const totalsY = Math.round(LANDSCAPE_H * 0.57); // 1454 (1453.5 round)
    const pitcherY = Math.round(LANDSCAPE_H * 0.83); // 2117

    expect(rects.header).toEqual({
      x: 0,
      y: 0,
      width: statsX,
      height: headerY,
    });
    expect(rects.player).toEqual({
      x: 0,
      y: headerY,
      width: playerX,
      height: playY - headerY,
    });
    expect(rects.stats).toEqual({
      x: statsX,
      y: 0,
      width: LANDSCAPE_W - statsX,
      height: totalsY,
    });
    expect(rects.totals).toEqual({
      x: playerX,
      y: playY,
      width: statsX - playerX,
      height: totalsY - playY,
    });
    expect(rects.pitcher).toEqual({
      x: 0,
      y: totalsY,
      width: statsX,
      height: pitcherY - totalsY,
    });
    expect(rects.catcher).toEqual({
      x: statsX,
      y: totalsY,
      width: LANDSCAPE_W - statsX,
      height: LANDSCAPE_H - totalsY,
    });
  });

  it("produces exactly inningCount (default 13) equal-width inning columns in play_grid", async () => {
    const img = await canvas(LANDSCAPE_W, LANDSCAPE_H);
    const result = await cropInnings(img);
    const { innings: rectsInnings } = result.meta.rects;

    expect(rectsInnings.length).toBe(13);

    // 最終列以外はすべて同じ幅（最終列は余剰吸収）
    const firstWidth = rectsInnings[0].width;
    for (let i = 0; i < 12; i++) {
      expect(rectsInnings[i].width).toBe(firstWidth);
    }
    // 全列の幅合計が play_grid 幅 (stats_x - player_x) と一致
    const totalW = rectsInnings.reduce((s, r) => s + r.width, 0);
    const expectedTotal = Math.round(LANDSCAPE_W * 0.77) - Math.round(LANDSCAPE_W * 0.135);
    expect(totalW).toBe(expectedTotal);

    // play_grid の y 範囲
    for (const r of rectsInnings) {
      expect(r.y).toBe(Math.round(LANDSCAPE_H * 0.16));
      expect(r.height).toBe(
        Math.round(LANDSCAPE_H * 0.52) - Math.round(LANDSCAPE_H * 0.16),
      );
    }

    // 隣接列は x で接している（隙間なし・重なりなし）
    for (let i = 1; i < rectsInnings.length; i++) {
      expect(rectsInnings[i].x).toBe(
        rectsInnings[i - 1].x + rectsInnings[i - 1].width,
      );
    }
  });

  it("returns buffers whose actual pixel dimensions match the reported rects", async () => {
    const img = await canvas(LANDSCAPE_W, LANDSCAPE_H);
    const result = await cropInnings(img);

    await expectRectMatchesBuffer(result.meta.rects.header, result.header);
    await expectRectMatchesBuffer(result.meta.rects.player, result.player);
    await expectRectMatchesBuffer(result.meta.rects.stats, result.stats);
    await expectRectMatchesBuffer(result.meta.rects.totals, result.totals);
    await expectRectMatchesBuffer(result.meta.rects.pitcher, result.pitcher);
    await expectRectMatchesBuffer(result.meta.rects.catcher, result.catcher);
    for (let i = 0; i < result.innings.length; i++) {
      await expectRectMatchesBuffer(
        result.meta.rects.innings[i],
        result.innings[i],
      );
    }
  });

  it("covers the full image area disjointly (header + player + play_grid + stats + totals + pitcher + catcher)", async () => {
    const img = await canvas(LANDSCAPE_W, LANDSCAPE_H);
    const { meta } = await cropInnings(img);
    const { rects } = meta;

    // 合計ピクセル数 = W × H と一致
    const areaOf = (r: Rect) => r.width * r.height;
    const playGridArea = rects.innings.reduce((s, r) => s + areaOf(r), 0);
    const total =
      areaOf(rects.header) +
      areaOf(rects.player) +
      playGridArea +
      areaOf(rects.stats) +
      areaOf(rects.totals) +
      areaOf(rects.pitcher) +
      areaOf(rects.catcher);

    // ピクセル丸めの影響でわずかに差があり得る（許容 <1%）
    const fullArea = LANDSCAPE_W * LANDSCAPE_H;
    expect(total / fullArea).toBeGreaterThan(0.99);
    expect(total / fullArea).toBeLessThan(1.01);
  });

  it("respects custom inningCount", async () => {
    const img = await canvas(LANDSCAPE_W, LANDSCAPE_H);
    const layout: ScorebookLayout = { ...SEIBIDO_9104_WASEDA, inningCount: 9 };
    const result = await cropInnings(img, { layout });
    expect(result.innings.length).toBe(9);
    expect(result.meta.rects.innings.length).toBe(9);
  });

  it("rejects invalid ratios", async () => {
    const img = await canvas(200, 200);
    await expect(() =>
      cropInnings(img, {
        layout: { ...SEIBIDO_9104_WASEDA, playerColRatio: 0.9 },
      }),
    ).rejects.toThrow(/playerColRatio/);
    await expect(() =>
      cropInnings(img, {
        layout: { ...SEIBIDO_9104_WASEDA, headerBottom: 0.6 },
      }),
    ).rejects.toThrow(/y-ratios/);
    await expect(() =>
      cropInnings(img, {
        layout: { ...SEIBIDO_9104_WASEDA, inningCount: 0 },
      }),
    ).rejects.toThrow(/inningCount/);
    await expect(() =>
      cropInnings(img, {
        layout: { ...SEIBIDO_9104_WASEDA, batterCount: 20 },
      }),
    ).rejects.toThrow(/batterCount/);
  });
});
