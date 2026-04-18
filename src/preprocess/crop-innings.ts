/**
 * スコアブック版面を論理領域（ヘッダー / 選手列 / イニング列 × N / スタッツ / 合計行 /
 * 投手欄 / 捕手欄）に比率ベースで分割するモジュール。
 *
 * 比率定数は docs/architecture.md §20.2（Seibido 9104 waseda、rotated 3300×2550 基準、
 * overlay 6 回反復で確定）と同期。
 *
 * **Day 1**: 固定比率分割のみ。
 * **Day 2 以降**: `@techstark/opencv-js` の Hough 直線検出で自動校正モード追加予定。
 *
 * 前提: 入力画像は **landscape 向き**（長辺が width）に正規化済み。
 * 成美堂 9104 は保存時に portrait 2550×3300 / EXIF なしだが、実内容は landscape。
 * normalize() 呼び出し時に `forceRotate: 90` もしくは呼び出し側で回転すること。
 */

import sharp from "sharp";

import type { InningCropResult, Rect, ScorebookLayout } from "../types/layout.js";
import { SEIBIDO_9104_WASEDA } from "../types/layout.js";

export type CropInningsOptions = {
  /** 版面レイアウト（既定 Seibido 9104 waseda） */
  layout?: ScorebookLayout;
};

export async function cropInnings(
  image: Buffer,
  options: CropInningsOptions = {},
): Promise<InningCropResult> {
  const layout = options.layout ?? SEIBIDO_9104_WASEDA;
  const meta = await sharp(image).metadata();
  if (meta.width == null || meta.height == null) {
    throw new Error("cropInnings: could not read image dimensions");
  }
  const W = meta.width;
  const H = meta.height;

  validateLayout(layout);

  const playerX = Math.round(W * layout.playerColRatio);
  const rightStatsX = Math.round(W * layout.rightStatsRatio);
  const headerY = Math.round(H * layout.headerBottom);
  const playGridY = Math.round(H * layout.playGridBottom);
  const totalsY = Math.round(H * layout.totalsRowBottom);
  const pitcherY = Math.round(H * layout.pitcherAreaBottom);

  // ── 論理領域の pixel bounds ─────────────────────────────────
  const headerRect: Rect = {
    x: 0,
    y: 0,
    width: rightStatsX,
    height: headerY,
  };
  const playerRect: Rect = {
    x: 0,
    y: headerY,
    width: playerX,
    height: playGridY - headerY,
  };
  const playGridWidth = rightStatsX - playerX;
  const inningWidth = Math.floor(playGridWidth / layout.inningCount);
  const inningsRects: Rect[] = Array.from(
    { length: layout.inningCount },
    (_, i): Rect => ({
      x: playerX + i * inningWidth,
      y: headerY,
      // 最終列のみ playGridWidth % inningCount の余剰を吸収
      width:
        i === layout.inningCount - 1
          ? playGridWidth - i * inningWidth
          : inningWidth,
      height: playGridY - headerY,
    }),
  );
  const statsRect: Rect = {
    x: rightStatsX,
    y: 0,
    width: W - rightStatsX,
    height: totalsY,
  };
  const totalsRect: Rect = {
    x: playerX,
    y: playGridY,
    width: rightStatsX - playerX,
    height: totalsY - playGridY,
  };
  const pitcherRect: Rect = {
    x: 0,
    y: totalsY,
    width: rightStatsX,
    height: pitcherY - totalsY,
  };
  const catcherRect: Rect = {
    x: rightStatsX,
    y: totalsY,
    width: W - rightStatsX,
    height: H - totalsY,
  };

  const [header, player, stats, totals, pitcher, catcher, ...innings] =
    await Promise.all([
      extract(image, headerRect),
      extract(image, playerRect),
      extract(image, statsRect),
      extract(image, totalsRect),
      extract(image, pitcherRect),
      extract(image, catcherRect),
      ...inningsRects.map((r) => extract(image, r)),
    ]);

  return {
    header,
    player,
    innings,
    stats,
    totals,
    pitcher,
    catcher,
    meta: {
      imageSize: { width: W, height: H },
      rects: {
        header: headerRect,
        player: playerRect,
        innings: inningsRects,
        stats: statsRect,
        totals: totalsRect,
        pitcher: pitcherRect,
        catcher: catcherRect,
      },
    },
  };
}

function extract(image: Buffer, rect: Rect): Promise<Buffer> {
  return sharp(image)
    .extract({
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    })
    .toBuffer();
}

function validateLayout(layout: ScorebookLayout): void {
  const rs: Array<[string, number]> = [
    ["playerColRatio", layout.playerColRatio],
    ["rightStatsRatio", layout.rightStatsRatio],
    ["headerBottom", layout.headerBottom],
    ["playGridBottom", layout.playGridBottom],
    ["totalsRowBottom", layout.totalsRowBottom],
    ["pitcherAreaBottom", layout.pitcherAreaBottom],
  ];
  for (const [name, v] of rs) {
    if (!(v > 0 && v < 1)) {
      throw new Error(`cropInnings: ratio ${name}=${v} out of (0, 1)`);
    }
  }
  if (layout.playerColRatio >= layout.rightStatsRatio) {
    throw new Error(
      `cropInnings: playerColRatio (${layout.playerColRatio}) must be < rightStatsRatio (${layout.rightStatsRatio})`,
    );
  }
  if (
    !(
      layout.headerBottom < layout.playGridBottom &&
      layout.playGridBottom < layout.totalsRowBottom &&
      layout.totalsRowBottom < layout.pitcherAreaBottom
    )
  ) {
    throw new Error(
      "cropInnings: y-ratios must satisfy headerBottom < playGridBottom < totalsRowBottom < pitcherAreaBottom",
    );
  }
  if (layout.inningCount < 1 || !Number.isInteger(layout.inningCount)) {
    throw new Error(
      `cropInnings: inningCount must be a positive integer, got ${layout.inningCount}`,
    );
  }
  if (
    layout.batterCount < 1 ||
    layout.batterCount > 15 ||
    !Number.isInteger(layout.batterCount)
  ) {
    throw new Error(
      `cropInnings: batterCount must be an integer in [1, 15], got ${layout.batterCount}`,
    );
  }
}
