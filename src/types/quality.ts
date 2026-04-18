/**
 * 画質評価の型定義。
 *
 * 閾値は Dynamsoft Document Scanner JS Edition 実装定数を採用
 * （blur variance ≥ 100 / mean luma ≥ 80）。
 */

export type QualityIssue = string;

export type QualityReport = {
  ok: boolean;
  /** Laplacian variance（高いほどシャープ） */
  blurVariance: number;
  /** mean luma 0-255（低いほど暗い） */
  meanLuma: number;
  issues: QualityIssue[];
};

export type QualityThresholds = {
  /** これ未満はブレ判定（Dynamsoft 既定: 100） */
  minBlurVariance: number;
  /** これ未満はダーク判定（Dynamsoft 既定: 80） */
  minMeanLuma: number;
};

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  minBlurVariance: 100,
  minMeanLuma: 80,
};
