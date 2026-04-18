/**
 * 画像正規化モジュール。
 *
 * Claude Vision API 送信前の必須前処理:
 *   1. EXIF orientation の自動補正（sharp v0.33 系は `.rotate()` を無引数で呼ぶと EXIF に従う）
 *   2. 長辺 2576px へリサイズ（Opus 4.7 のネイティブ解像度、超えても内部で縮小される）
 *   3. mozjpeg quality 90 でエンコード
 *
 * VLM では二値化・グレースケール化・過度なコントラスト処理は**精度を下げる**と
 * 実験で確認されているので行わない。docs/architecture.md §4.1 を参照。
 */

import sharp from "sharp";

import type { NormalizedImage } from "../types/image.js";

/** Opus 4.7 が内部で扱うネイティブ長辺 px */
export const CLAUDE_VISION_LONG_EDGE = 2576;

export type NormalizeOptions = {
  /** 長辺 px（既定 2576） */
  longEdge?: number;
  /** JPEG 品質 1-100（既定 90） */
  jpegQuality?: number;
  /**
   * Seibido 9104 のように保存向きと実内容向きが異なる場合に明示的に 90/180/270 度回転。
   * 既定は EXIF のみ参照（`.rotate()` 無引数）で物理的な向き変更は行わない。
   */
  forceRotate?: 0 | 90 | 180 | 270;
};

export async function normalize(
  input: Buffer,
  options: NormalizeOptions = {},
): Promise<NormalizedImage> {
  const longEdge = options.longEdge ?? CLAUDE_VISION_LONG_EDGE;
  const jpegQuality = options.jpegQuality ?? 90;

  const meta0 = await sharp(input).metadata();
  if (meta0.width == null || meta0.height == null) {
    throw new Error("normalize: could not read image dimensions");
  }

  // sharp 0.33 系では `.rotate()` 無引数 = EXIF auto-orient、`.rotate(90)` = 強制回転。
  // 将来版（1.0+）で `.rotate(undefined)` の挙動が変わる可能性があるため明示的に分岐。
  let pipeline = sharp(input);
  pipeline =
    options.forceRotate != null
      ? pipeline.rotate(options.forceRotate)
      : pipeline.rotate();
  pipeline = pipeline.resize({
    width: longEdge,
    height: longEdge,
    fit: "inside",
    withoutEnlargement: true,
  });
  const buf = await pipeline
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();

  const meta1 = await sharp(buf).metadata();
  if (meta1.width == null || meta1.height == null) {
    throw new Error("normalize: failed to re-read normalized image metadata");
  }

  return {
    base64: buf.toString("base64"),
    mediaType: "image/jpeg",
    origSize: { width: meta0.width, height: meta0.height },
    sentSize: { width: meta1.width, height: meta1.height },
    bytes: buf.byteLength,
  };
}
