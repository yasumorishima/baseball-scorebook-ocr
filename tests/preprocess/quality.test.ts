/**
 * quality.ts の単体テスト。
 *
 * 合成画像（フラット / チェッカーボード / 暗所 / ブレ模擬）で判定の期待値を確認。
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  arrayMean,
  assessQuality,
  laplacianVariance,
} from "../../src/preprocess/quality.js";

/** RGB 単色のフラット画像。 */
async function flatImage(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: rgb },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/**
 * 1px 単位のチェッカーボード PNG。
 * 最大の高周波 → Laplacian 分散が非常に大きくなる。
 */
async function checkerImage(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBlack = (x + y) % 2 === 0;
      const i = (y * width + x) * 3;
      const v = isBlack ? 0 : 255;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** 滑らかなグラデーション = 低周波。blur 相当。 */
async function gradientImage(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round((x / width) * 255);
      const i = (y * width + x) * 3;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe("laplacianVariance", () => {
  it("returns 0 for a uniform grayscale array", () => {
    const buf = new Uint8Array(100 * 100).fill(128);
    expect(laplacianVariance(buf, 100, 100)).toBe(0);
  });

  it("is much larger for high-frequency patterns than smooth ones", () => {
    const checker = new Uint8Array(50 * 50);
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        checker[y * 50 + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }
    const gradient = new Uint8Array(50 * 50);
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        gradient[y * 50 + x] = Math.round((x / 50) * 255);
      }
    }
    const varChecker = laplacianVariance(checker, 50, 50);
    const varGradient = laplacianVariance(gradient, 50, 50);
    expect(varChecker).toBeGreaterThan(varGradient * 100);
  });
});

describe("arrayMean", () => {
  it("returns the arithmetic mean of bytes", () => {
    expect(arrayMean(new Uint8Array([0, 100, 200]))).toBeCloseTo(100, 5);
    expect(arrayMean(new Uint8Array([255, 255, 255]))).toBe(255);
    expect(arrayMean(new Uint8Array([]))).toBe(0);
  });
});

describe("assessQuality", () => {
  it("flags a very dark image as failing the luma threshold", async () => {
    const dark = await flatImage(200, 200, { r: 10, g: 10, b: 10 });
    const report = await assessQuality(dark);
    expect(report.meanLuma).toBeLessThan(80);
    expect(report.ok).toBe(false);
    expect(report.issues.some((s) => s.startsWith("dark"))).toBe(true);
  });

  it("flags a smooth gradient as failing the blur threshold", async () => {
    const img = await gradientImage(300, 200);
    const report = await assessQuality(img);
    expect(report.blurVariance).toBeLessThan(100);
    expect(report.ok).toBe(false);
    expect(report.issues.some((s) => s.startsWith("blur"))).toBe(true);
  });

  it("passes a sharp, well-lit checkerboard image", async () => {
    const img = await checkerImage(200, 200);
    const report = await assessQuality(img);
    expect(report.blurVariance).toBeGreaterThan(100);
    expect(report.meanLuma).toBeGreaterThan(80);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("respects custom thresholds", async () => {
    const gradient = await gradientImage(200, 200);
    // 分散閾値を十分低くすれば pass する
    const lenient = await assessQuality(gradient, {
      minBlurVariance: 0,
      minMeanLuma: 0,
    });
    expect(lenient.ok).toBe(true);
  });

  it("throws for images smaller than 3x3", async () => {
    const tiny = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(() => assessQuality(tiny)).rejects.toThrow(/too small/);
  });
});
