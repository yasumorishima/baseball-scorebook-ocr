/**
 * 画質評価モジュール。
 *
 * - **ブレ判定**: 3×3 Laplacian カーネルでの分散。値が高いほどエッジが立っている = シャープ。
 *   Pech & Martin 2000 "Diatom autofocusing in brightfield microscopy: a comparative study" で
 *   提案され、以後 OpenCV 界隈の標準指標。
 * - **ダーク判定**: グレースケール平均輝度 0-255。
 *
 * 閾値は Dynamsoft Document Scanner JS Edition 実装定数採用:
 *   - variance ≥ 100 (BLUR_VAR_MIN)
 *   - mean luma ≥ 80 (DARK_LUMA_MAX=80 より暗ければダーク)
 *
 * docs/architecture.md §4.2 を参照。
 */

import sharp from "sharp";

import type { QualityReport, QualityThresholds } from "../types/quality.js";
import { DEFAULT_QUALITY_THRESHOLDS } from "../types/quality.js";

export async function assessQuality(
  input: Buffer,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): Promise<QualityReport> {
  const { data, info } = await sharp(input)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  if (width < 3 || height < 3) {
    throw new Error(
      `assessQuality: image too small (${width}x${height}); need ≥ 3px each side`,
    );
  }

  const blurVariance = laplacianVariance(data, width, height);
  const meanLuma = arrayMean(data);

  const issues: string[] = [];
  if (blurVariance < thresholds.minBlurVariance) {
    issues.push(
      `blur (variance=${blurVariance.toFixed(1)}, need ≥${thresholds.minBlurVariance})`,
    );
  }
  if (meanLuma < thresholds.minMeanLuma) {
    issues.push(
      `dark (luma=${meanLuma.toFixed(1)}, need ≥${thresholds.minMeanLuma})`,
    );
  }

  return {
    ok: issues.length === 0,
    blurVariance,
    meanLuma,
    issues,
  };
}

/**
 * 3×3 Laplacian カーネル `[[0,1,0],[1,-4,1],[0,1,0]]` を適用した応答の分散を返す。
 * 内部ピクセルのみ評価（境界 1px は無視）。
 */
export function laplacianVariance(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
): number {
  const n = (width - 2) * (height - 2);
  if (n <= 0) return 0;

  // 2-pass: 平均を先に算出 → 分散
  let sum = 0;
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = rowOff + x;
      const v =
        -4 * data[i] +
        data[i - 1] +
        data[i + 1] +
        data[i - width] +
        data[i + width];
      sum += v;
    }
  }
  const mean = sum / n;

  let sqSum = 0;
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = rowOff + x;
      const v =
        -4 * data[i] +
        data[i - 1] +
        data[i + 1] +
        data[i - width] +
        data[i + width];
      const d = v - mean;
      sqSum += d * d;
    }
  }
  return sqSum / n;
}

export function arrayMean(data: Uint8Array | Buffer): number {
  const len = data.length;
  if (len === 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += data[i];
  return sum / len;
}
