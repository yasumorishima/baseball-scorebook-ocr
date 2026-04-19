/**
 * スコアブック版面の罫線を `@techstark/opencv-js` の Hough 直線検出で拾い、
 * Day 2 の画像ベース Few-shot 用セル bbox 自動校正につなげるモジュール。
 *
 * docs/architecture.md §20 / §22 の Day 2 方針:
 *   - Day 1: 固定比率分割（src/preprocess/crop-innings.ts, SEIBIDO_9104_WASEDA 実測）
 *   - Day 2 (this module): Hough + 線分クラスタリングで動的校正、撮影写真の
 *     微小回転・透視歪みに追従する。cropInnings にまだ統合せず、独立ユーティリティ。
 *
 * 戦略:
 *   1. sharp で元画像をグレースケール + Canny 前処理サイズへダウンサイズ
 *   2. OpenCV.js の HoughLinesP で線分を取得
 *   3. 水平/垂直クラスタリング（角度ベース）で行境界・列境界候補を抽出
 *   4. クラスター平均位置をそのまま bbox offset として返す
 *
 * **重要な前提**:
 *   - `@techstark/opencv-js` は WASM で Emscripten module。初回 import で WASM 初期化、
 *     Node.js でも動作するが cold-start が数百 ms かかる。そのため
 *     `getOpenCV()` で singleton 化し、テストの並列実行でも 1 回しかロードしない。
 *   - Node.js に `ImageData` は無いため、sharp で raw RGBA → `cv.matFromImageData` に渡す
 *     ポリフィル経路 or `cv.matFromArray(h, w, CV_8UC4, buffer)` 経路を使う。
 *
 * 出力型は cropInnings の Rect と整合し、将来的に統合する際に差し替えやすいように設計。
 */

import sharp from "sharp";

/**
 * Hough 線分検出で得られる線分 1 本。ピクセル座標（元画像解像度基準、downscaled なら
 * スケール倍率を掛けて戻した値を返す）。
 */
export type HoughLine = {
  /** 始点 x */
  x1: number;
  /** 始点 y */
  y1: number;
  /** 終点 x */
  x2: number;
  /** 終点 y */
  y2: number;
  /** 線分の長さ（px） */
  length: number;
  /** x 軸からの角度（度、0 = 水平、90 = 垂直） */
  angleDeg: number;
};

export type DetectedLines = {
  /** 水平線（angle ≤ maxHorizontalAngleDeg or ≥ 180-threshold） */
  horizontal: HoughLine[];
  /** 垂直線（|angle - 90| ≤ threshold） */
  vertical: HoughLine[];
  /** 処理した内部解像度（px）。x,y 座標は元画像座標系に戻した後の値。 */
  processedSize: { width: number; height: number };
  /** 元画像サイズ */
  originalSize: { width: number; height: number };
};

export type DetectLinesOptions = {
  /** Hough 前処理の長辺ピクセル上限。大きすぎると WASM が遅い（既定 1600） */
  maxLongEdge?: number;
  /** Canny の低閾値（既定 50） */
  cannyLow?: number;
  /** Canny の高閾値（既定 150） */
  cannyHigh?: number;
  /** Hough の投票閾値（既定 120、線分が太いほど高く） */
  houghThreshold?: number;
  /** Hough 線分最小長（既定 100px） */
  minLineLength?: number;
  /** Hough 線分間隔最大（既定 20px） */
  maxLineGap?: number;
  /** 水平/垂直と判定する角度許容範囲（既定 5°） */
  angleToleranceDeg?: number;
};

/** opencv-js の Emscripten module 型（必要最小限） */
type OpenCVRuntime = {
  onRuntimeInitialized?: () => void;
  imread?: unknown;
  matFromArray: (rows: number, cols: number, type: number, data: Uint8Array | number[]) => OpenCVMat;
  Mat: new (rows?: number, cols?: number, type?: number) => OpenCVMat;
  cvtColor: (src: OpenCVMat, dst: OpenCVMat, code: number) => void;
  Canny: (src: OpenCVMat, dst: OpenCVMat, t1: number, t2: number) => void;
  HoughLinesP: (
    src: OpenCVMat,
    lines: OpenCVMat,
    rho: number,
    theta: number,
    threshold: number,
    minLineLength: number,
    maxLineGap: number,
  ) => void;
  COLOR_RGBA2GRAY: number;
  COLOR_GRAY2RGBA: number;
  CV_8UC1: number;
  CV_8UC4: number;
  CV_32SC4: number;
};

/** opencv-js の Mat 型（必要最小限） */
type OpenCVMat = {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32S: Int32Array;
  delete: () => void;
};

let cachedRuntime: Promise<OpenCVRuntime> | null = null;

/**
 * OpenCV.js ランタイムを lazy singleton で取得する。初回呼び出しで Emscripten 初期化待ち。
 *
 * 実装ノート:
 *   - `@techstark/opencv-js` は UMD (`module.exports = factory()`) で配布される Emscripten
 *     module。ESM の `await import(...)` 経路では `default.then` が thenable と認識され、
 *     `await` が内部 `.then` を呼んでも Emscripten の init コールバックが発火せず
 *     deadlock する現象を確認（scripts/hough-probe*.ts 参照）。
 *   - tsx / Vite / vitest は createRequire まで傍受して ESM 経路に再ルーティングするため
 *     TS ファイル内の createRequire も安定動作しない。
 *   - 解決策: `src/preprocess/opencv-loader.cjs` で require を隔離し、純 Node CJS 経路で
 *     Module を取得して onRuntimeInitialized で init 完了を待つ。`.cjs` 拡張子は
 *     Vite/tsx のトランスパイル対象外なので安定して動く。
 */
export async function getOpenCV(): Promise<OpenCVRuntime> {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = (async (): Promise<OpenCVRuntime> => {
    const mod = (await import("./opencv-loader.cjs")) as unknown as {
      loadOpenCV: () => Promise<OpenCVRuntime>;
    };
    return mod.loadOpenCV();
  })();
  return cachedRuntime;
}

/**
 * スコアブック画像から罫線（水平/垂直線分）を Hough で検出する。
 *
 * @param imageBuffer sharp が扱える任意の画像バッファ（JPEG/PNG）
 * @returns 元画像座標系に戻した HoughLine 配列と水平/垂直分類
 */
export async function detectGridLines(
  imageBuffer: Buffer,
  options: DetectLinesOptions = {},
): Promise<DetectedLines> {
  const maxLongEdge = options.maxLongEdge ?? 1600;
  const cannyLow = options.cannyLow ?? 50;
  const cannyHigh = options.cannyHigh ?? 150;
  const houghThreshold = options.houghThreshold ?? 120;
  const minLineLength = options.minLineLength ?? 100;
  const maxLineGap = options.maxLineGap ?? 20;
  const angleToleranceDeg = options.angleToleranceDeg ?? 5;

  const meta = await sharp(imageBuffer).metadata();
  if (meta.width == null || meta.height == null) {
    throw new Error("detectGridLines: could not read image dimensions");
  }
  const origW = meta.width;
  const origH = meta.height;
  const longEdge = Math.max(origW, origH);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const procW = Math.round(origW * scale);
  const procH = Math.round(origH * scale);

  // sharp で raw RGBA を取り出す（opencv-js は CV_8UC4 Mat を matFromArray で受ける）
  const { data: rgba } = await sharp(imageBuffer)
    .resize(procW, procH, { fit: "fill" })
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cv = await getOpenCV();
  const src = cv.matFromArray(procH, procW, cv.CV_8UC4, new Uint8Array(rgba));
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, cannyLow, cannyHigh);
    cv.HoughLinesP(
      edges,
      lines,
      1,
      Math.PI / 180,
      houghThreshold,
      minLineLength,
      maxLineGap,
    );

    // lines.data32S は [x1, y1, x2, y2, x1, y1, x2, y2, ...] のフラット配列
    const horizontal: HoughLine[] = [];
    const vertical: HoughLine[] = [];
    const count = lines.rows;
    const invScale = 1 / scale;

    for (let i = 0; i < count; i++) {
      const base = i * 4;
      const x1p = lines.data32S[base];
      const y1p = lines.data32S[base + 1];
      const x2p = lines.data32S[base + 2];
      const y2p = lines.data32S[base + 3];
      const dx = x2p - x1p;
      const dy = y2p - y1p;
      const length = Math.hypot(dx, dy);
      // 角度 [0, 180) に正規化（向きを無視）
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 180;

      const line: HoughLine = {
        x1: x1p * invScale,
        y1: y1p * invScale,
        x2: x2p * invScale,
        y2: y2p * invScale,
        length: length * invScale,
        angleDeg,
      };

      if (
        angleDeg <= angleToleranceDeg ||
        angleDeg >= 180 - angleToleranceDeg
      ) {
        horizontal.push(line);
      } else if (Math.abs(angleDeg - 90) <= angleToleranceDeg) {
        vertical.push(line);
      }
    }

    return {
      horizontal,
      vertical,
      processedSize: { width: procW, height: procH },
      originalSize: { width: origW, height: origH },
    };
  } finally {
    // WASM memory leak 防止に Mat は必ず delete
    src.delete();
    gray.delete();
    edges.delete();
    lines.delete();
  }
}

/**
 * 検出した垂直線群から、y 方向の投影クラスタリングで
 * N+1 個の「列境界 x 座標」を推定する（inning 列境界用）。
 *
 * 使用方針（Day 2 で crop-innings と統合する際の入口）:
 *   - cropInnings の innings 列は static ratio で N 等分しているが、
 *     撮影写真では等分にならないため、このクラスタの実測値で上書きする
 *
 * @param lines 垂直線群（`detectGridLines().vertical`）
 * @param imageWidth 元画像幅 px
 * @param targetCount 推定したい境界本数（inning 列なら inningCount + 1）
 * @param binSize クラスタの x 方向 bin サイズ（既定 8px）
 */
export function clusterVerticalBoundaries(
  lines: HoughLine[],
  imageWidth: number,
  targetCount: number,
  binSize = 8,
): number[] {
  if (targetCount < 1) {
    throw new Error(
      `clusterVerticalBoundaries: targetCount must be >= 1, got ${targetCount}`,
    );
  }
  if (imageWidth <= 0) {
    throw new Error(
      `clusterVerticalBoundaries: imageWidth must be > 0, got ${imageWidth}`,
    );
  }

  // 各線分の「代表 x」は (x1 + x2) / 2
  const binCount = Math.ceil(imageWidth / binSize);
  const histogram = new Float64Array(binCount);
  for (const l of lines) {
    const x = (l.x1 + l.x2) / 2;
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(x / binSize)));
    // 線分長で重み付け（短い noise 線の影響を下げる）
    histogram[bin] += l.length;
  }

  // 上位 targetCount 個のピーク bin を抽出（非極大抑制付き）
  const peaks: Array<{ bin: number; weight: number }> = [];
  const suppressionRadius = Math.max(1, Math.floor(binSize / 2));
  const marked = new Uint8Array(binCount);
  const indices = [...histogram.keys()].sort((a, b) => histogram[b] - histogram[a]);
  for (const idx of indices) {
    if (peaks.length >= targetCount) break;
    if (marked[idx]) continue;
    if (histogram[idx] <= 0) break;
    peaks.push({ bin: idx, weight: histogram[idx] });
    const lo = Math.max(0, idx - suppressionRadius);
    const hi = Math.min(binCount - 1, idx + suppressionRadius);
    for (let j = lo; j <= hi; j++) marked[j] = 1;
  }

  // x 座標（bin 中心）で昇順
  return peaks
    .map((p) => p.bin * binSize + binSize / 2)
    .sort((a, b) => a - b);
}
