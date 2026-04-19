/**
 * hough-calibrate.ts の単体テスト。
 *
 * 合成グリッド画像で:
 *   - 水平・垂直線が期待本数検出できる
 *   - 垂直境界クラスタリングが期待 x 座標を返す
 *   - pure color (罫線なし) 画像では 0 本検出
 *
 * ## test-runner 内実行不可の既知問題
 *
 * `@techstark/opencv-js` は UMD Emscripten module で、Node ESM 動的 import 経路で
 * thenable が解決されず deadlock する。`.cjs` ファイルに require を隔離しても
 * vite-node が全 import を傍受して Emscripten init が発火しない。
 *
 * 純粋 Node CJS 経路では 500-600ms で init 完走することを `scripts/hough-smoke.cjs`
 * で確認済み。本モジュールの実動作はこのスモークスクリプトで担保し、
 * test-runner 側のテストは `RUN_WASM_TESTS=1` 環境変数で明示 opt-in したときだけ走る。
 * 環境変数が未設定なら describe.skipIf でスキップする。
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  clusterVerticalBoundaries,
  detectGridLines,
  getOpenCV,
  type HoughLine,
} from "../../src/preprocess/hough-calibrate.js";

const SKIP_WASM = !process.env.RUN_WASM_TESTS;

/** 指定サイズ＋水平/垂直罫線付きの合成スコアブック風 PNG を生成。 */
async function makeGridImage(params: {
  width: number;
  height: number;
  horizontalYs: number[];
  verticalXs: number[];
  lineWidth?: number;
}): Promise<Buffer> {
  const lw = params.lineWidth ?? 3;
  const rects: string[] = [];
  for (const y of params.horizontalYs) {
    rects.push(
      `<rect x="0" y="${y - lw / 2}" width="${params.width}" height="${lw}" fill="black"/>`,
    );
  }
  for (const x of params.verticalXs) {
    rects.push(
      `<rect x="${x - lw / 2}" y="0" width="${lw}" height="${params.height}" fill="black"/>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}">
    <rect width="100%" height="100%" fill="white"/>
    ${rects.join("\n")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 白紙画像（罫線なし） */
async function makeBlank(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

describe.skipIf(SKIP_WASM)("getOpenCV", () => {
  it("loads the WASM runtime and exposes Mat/Canny/HoughLinesP", async () => {
    const cv = await getOpenCV();
    expect(typeof cv.Mat).toBe("function");
    expect(typeof cv.Canny).toBe("function");
    expect(typeof cv.HoughLinesP).toBe("function");
    expect(typeof cv.cvtColor).toBe("function");
    expect(typeof cv.matFromArray).toBe("function");
  }, 30_000);

  it("returns the same singleton on repeated calls", async () => {
    const a = await getOpenCV();
    const b = await getOpenCV();
    expect(a).toBe(b);
  }, 30_000);
});

describe.skipIf(SKIP_WASM)("detectGridLines", () => {
  it("detects approximately the expected number of horizontal and vertical lines on a clean grid", async () => {
    // 13 垂直線 + 4 水平線のクリーンな合成画像
    const W = 1300;
    const H = 800;
    const verticalXs = Array.from({ length: 13 }, (_, i) => 100 + i * 80);
    const horizontalYs = [100, 300, 500, 700];
    const img = await makeGridImage({
      width: W,
      height: H,
      verticalXs,
      horizontalYs,
    });
    const result = await detectGridLines(img, {
      minLineLength: 60,
      houghThreshold: 80,
    });
    // 罫線は 1 本あたり複数の Hough 線分に分解されうるので下限だけ assert
    expect(result.horizontal.length).toBeGreaterThanOrEqual(
      horizontalYs.length,
    );
    expect(result.vertical.length).toBeGreaterThanOrEqual(verticalXs.length);
    // 出力座標系は元画像基準
    expect(result.originalSize).toEqual({ width: W, height: H });
  }, 30_000);

  it("returns 0 lines on a blank image", async () => {
    const img = await makeBlank(800, 600);
    const result = await detectGridLines(img, {
      minLineLength: 80,
      houghThreshold: 100,
    });
    expect(result.horizontal.length).toBe(0);
    expect(result.vertical.length).toBe(0);
  }, 30_000);

  it("respects the maxLongEdge downscale", async () => {
    const img = await makeGridImage({
      width: 3000,
      height: 2000,
      horizontalYs: [500, 1000],
      verticalXs: [600, 1200, 1800, 2400],
    });
    const result = await detectGridLines(img, {
      maxLongEdge: 800,
      minLineLength: 50,
      houghThreshold: 60,
    });
    expect(result.processedSize.width).toBeLessThanOrEqual(800);
    expect(result.processedSize.height).toBeLessThanOrEqual(800);
    expect(result.originalSize).toEqual({ width: 3000, height: 2000 });
    // 座標は元画像基準に戻っている
    for (const line of result.vertical) {
      expect(line.x1).toBeGreaterThanOrEqual(0);
      expect(line.x1).toBeLessThanOrEqual(3000);
    }
  }, 30_000);

  it("throws on unreadable input", async () => {
    await expect(() =>
      detectGridLines(Buffer.from("not an image")),
    ).rejects.toThrow();
  }, 30_000);
});

describe("clusterVerticalBoundaries", () => {
  it.skipIf(SKIP_WASM)("returns peaks close to the expected vertical xs on a clean grid", async () => {
    const W = 1040;
    const verticalXs = [80, 200, 320, 440, 560, 680, 800, 920];
    const img = await makeGridImage({
      width: W,
      height: 400,
      verticalXs,
      horizontalYs: [50, 350],
    });
    const result = await detectGridLines(img, {
      minLineLength: 60,
      houghThreshold: 60,
    });
    const peaks = clusterVerticalBoundaries(
      result.vertical,
      W,
      verticalXs.length,
      16,
    );
    expect(peaks.length).toBe(verticalXs.length);
    // Each expected x should have a peak within ±24px (1.5 × binSize)
    for (const expected of verticalXs) {
      const closest = peaks.reduce(
        (best, p) => (Math.abs(p - expected) < Math.abs(best - expected) ? p : best),
        peaks[0],
      );
      expect(Math.abs(closest - expected)).toBeLessThanOrEqual(24);
    }
  }, 30_000);

  it("throws when targetCount < 1", () => {
    expect(() => clusterVerticalBoundaries([], 100, 0)).toThrow(/targetCount/);
  });

  it("throws when imageWidth <= 0", () => {
    expect(() => clusterVerticalBoundaries([], 0, 3)).toThrow(/imageWidth/);
  });

  it("returns empty array when line list is empty", () => {
    const peaks = clusterVerticalBoundaries([], 500, 5);
    expect(peaks).toEqual([]);
  });

  it("weights longer lines more heavily (suppresses noise)", () => {
    // Long strong line at x=200, noise short lines at x=220
    const strong: HoughLine = {
      x1: 200,
      y1: 0,
      x2: 200,
      y2: 400,
      length: 400,
      angleDeg: 90,
    };
    const noise: HoughLine[] = Array.from({ length: 5 }, () => ({
      x1: 220,
      y1: 0,
      x2: 220,
      y2: 20,
      length: 20,
      angleDeg: 90,
    }));
    const peaks = clusterVerticalBoundaries(
      [strong, ...noise],
      500,
      1,
      8,
    );
    expect(peaks.length).toBe(1);
    expect(Math.abs(peaks[0] - 200)).toBeLessThanOrEqual(12);
  });
});
