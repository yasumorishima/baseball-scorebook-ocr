/**
 * normalize.ts の単体テスト。
 *
 * 実画像ファイルに依存させず、sharp で合成した小さなテスト画像を入力に使う。
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { CLAUDE_VISION_LONG_EDGE, normalize } from "../../src/preprocess/normalize.js";

/** 指定サイズのフラット RGB 画像を JPEG で生成（テスト入力用）。 */
async function makeImage(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Buffer> {
  const img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 180, b: 120 },
    },
  });
  if (format === "jpeg") return img.jpeg({ quality: 85 }).toBuffer();
  return img.png().toBuffer();
}

describe("normalize", () => {
  it("resizes a large landscape image so the long edge becomes 2576", async () => {
    const input = await makeImage(4000, 3000);
    const out = await normalize(input);

    expect(out.mediaType).toBe("image/jpeg");
    expect(out.origSize).toEqual({ width: 4000, height: 3000 });

    // 長辺は CLAUDE_VISION_LONG_EDGE
    expect(Math.max(out.sentSize.width, out.sentSize.height)).toBe(
      CLAUDE_VISION_LONG_EDGE,
    );
    // アスペクト比維持（4000:3000 = 4:3）
    expect(out.sentSize.width / out.sentSize.height).toBeCloseTo(4 / 3, 2);

    expect(out.bytes).toBeGreaterThan(0);
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it("resizes a large portrait image so the long edge becomes 2576", async () => {
    const input = await makeImage(3000, 4000);
    const out = await normalize(input);
    expect(Math.max(out.sentSize.width, out.sentSize.height)).toBe(
      CLAUDE_VISION_LONG_EDGE,
    );
    expect(out.sentSize.width / out.sentSize.height).toBeCloseTo(3 / 4, 2);
  });

  it("does not enlarge an image smaller than the long edge", async () => {
    const input = await makeImage(1000, 800);
    const out = await normalize(input);
    expect(out.sentSize).toEqual({ width: 1000, height: 800 });
  });

  it("accepts PNG input and returns JPEG output", async () => {
    const input = await makeImage(3000, 2000, "png");
    const out = await normalize(input);
    expect(out.mediaType).toBe("image/jpeg");
    // 先頭バイトが JPEG SOI (0xFF 0xD8)
    const buf = Buffer.from(out.base64, "base64");
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("honors forceRotate=90 by swapping width and height", async () => {
    const input = await makeImage(2000, 1000);
    const rotated = await normalize(input, { forceRotate: 90 });
    expect(rotated.sentSize.width).toBe(1000);
    expect(rotated.sentSize.height).toBe(2000);
  });

  it("honors custom longEdge option", async () => {
    const input = await makeImage(4000, 2000);
    const out = await normalize(input, { longEdge: 1024 });
    expect(Math.max(out.sentSize.width, out.sentSize.height)).toBe(1024);
  });

  it("throws on unreadable input", async () => {
    await expect(() => normalize(Buffer.from("not an image"))).rejects.toThrow();
  });
});
