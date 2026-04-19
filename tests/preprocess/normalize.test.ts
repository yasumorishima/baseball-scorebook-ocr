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

  it("auto-rotates per EXIF orientation=6 (90° CW) by default", async () => {
    // EXIF Orientation=6 = カメラが 90° 右回転で保存、復元時に 90° 左回転必要
    // sharp().rotate() は EXIF を読んで自動回転する
    const landscapeRaw = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 50, g: 100, b: 150 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 85 })
      .toBuffer();

    const out = await normalize(landscapeRaw);
    // EXIF=6 で 1200×800 の素材を保存 → 復元後は 800×1200 の portrait
    // origSize は元データ（1200×800）または sharp の EXIF 補正後値がプラットフォーム依存。
    // 重要なのは sentSize が EXIF を反映していること:
    // 長辺が Math.max(1200, 800) = 1200 < 2576 なので resize 無効、回転後サイズ 800×1200
    expect(out.sentSize.height).toBeGreaterThan(out.sentSize.width);
    expect(out.sentSize).toEqual({ width: 800, height: 1200 });
  });

  it("auto-rotates per EXIF orientation=8 (270° CW / 90° CCW)", async () => {
    // EXIF Orientation=8 = カメラが 90° 左回転（= 270° CW）で保存、
    // 復元時は 90° CW 回転が必要。sharp().rotate() が自動処理する。
    // Orientation=6 と対称のケースで、rotate() の分岐が両方向に働くか検証。
    const landscapeRaw = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 80, g: 40, b: 120 } },
    })
      .withMetadata({ orientation: 8 })
      .jpeg({ quality: 85 })
      .toBuffer();

    const out = await normalize(landscapeRaw);
    // 1200×800 landscape → orientation=8 適用後 800×1200 portrait
    expect(out.sentSize.height).toBeGreaterThan(out.sentSize.width);
    expect(out.sentSize).toEqual({ width: 800, height: 1200 });
  });

  it("auto-rotates per EXIF orientation=3 (180°)", async () => {
    // Orientation=3 = 180° 回転。幅高さは入れ替わらないが内容が上下反転する。
    // 見た目の px サイズ検証のみ可能（ピクセル内容の反転は別途確認必要）。
    const raw = await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 10, g: 200, b: 10 } },
    })
      .withMetadata({ orientation: 3 })
      .jpeg({ quality: 85 })
      .toBuffer();

    const out = await normalize(raw);
    // 180° なので width/height は元と同じ (1000×600 < 2576 長辺のため resize 無効)
    expect(out.sentSize).toEqual({ width: 1000, height: 600 });
  });
});
