import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Seibido 9104 waseda 推定比率 (2026-04-19 visual 計測)
// 座標はすべて 90deg 回転後の landscape 画像基準 (3300x2550)
type Region = { name: string; x: [number, number]; y: [number, number]; color: string };

// Seibido 9104 waseda 比率 (2026-04-19 overlay 第6回実測 — play_grid Y を実測ベースで大幅補正)
const REGIONS: Region[] = [
  { name: "page_header",    x: [0.000, 0.770], y: [0.000, 0.080], color: "#ff0000" },
  { name: "inning_labels",  x: [0.135, 0.770], y: [0.080, 0.108], color: "#cc0044" },
  { name: "player_col",     x: [0.000, 0.135], y: [0.108, 0.520], color: "#0000ff" },
  { name: "play_grid",      x: [0.135, 0.770], y: [0.108, 0.520], color: "#00aa00" },
  { name: "totals_row",     x: [0.135, 0.770], y: [0.520, 0.570], color: "#ff8800" },
  { name: "pitcher_area",   x: [0.000, 0.770], y: [0.570, 0.830], color: "#8800ff" },
  { name: "catcher_area",   x: [0.770, 1.000], y: [0.570, 1.000], color: "#ff00cc" },
  { name: "right_stats",    x: [0.770, 1.000], y: [0.000, 0.570], color: "#888888" },
];

const INNING_COUNT = 13;
const BATTER_COUNT = 10;

async function main() {
  const input = process.argv[2] ?? "data/samples/20260412131943_001.jpg";
  const buf = readFileSync(resolve(input));
  // rotate AND resize to a fixed target, keeping aspect ratio. SVG overlay will be rasterized to the same size.
  const rawRotated = await sharp(buf).rotate(90).toBuffer();
  const rawMeta = await sharp(rawRotated).metadata();
  const rawW = rawMeta.width!, rawH = rawMeta.height!;
  const TARGET_W = 1800;
  const TARGET_H = Math.round((TARGET_W * rawH) / rawW);
  const base = await sharp(rawRotated).resize(TARGET_W, TARGET_H, { fit: "fill" }).jpeg({ quality: 90 }).toBuffer();
  const W = TARGET_W, H = TARGET_H;

  const rects: string[] = [];
  for (const r of REGIONS) {
    const x = Math.round(r.x[0] * W);
    const y = Math.round(r.y[0] * H);
    const w = Math.round((r.x[1] - r.x[0]) * W);
    const h = Math.round((r.y[1] - r.y[0]) * H);
    rects.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${r.color}" stroke-width="8" opacity="0.85" />`,
    );
    rects.push(
      `<text x="${x + 10}" y="${y + 40}" fill="${r.color}" font-size="36" font-family="sans-serif" font-weight="bold">${r.name}</text>`,
    );
  }

  // 内部グリッド: play_grid を 13 イニング × 10 打順に分割
  const pg = REGIONS.find((r) => r.name === "play_grid")!;
  const gx0 = pg.x[0] * W, gx1 = pg.x[1] * W;
  const gy0 = pg.y[0] * H, gy1 = pg.y[1] * H;
  const iw = (gx1 - gx0) / INNING_COUNT;
  const bh = (gy1 - gy0) / BATTER_COUNT;
  for (let i = 1; i < INNING_COUNT; i++) {
    const x = gx0 + i * iw;
    rects.push(`<line x1="${x}" y1="${gy0}" x2="${x}" y2="${gy1}" stroke="#00aa00" stroke-width="3" opacity="0.6" />`);
  }
  for (let b = 1; b < BATTER_COUNT; b++) {
    const y = gy0 + b * bh;
    rects.push(`<line x1="${gx0}" y1="${y}" x2="${gx1}" y2="${y}" stroke="#00aa00" stroke-width="3" opacity="0.6" />`);
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${rects.join("")}</svg>`;

  const overlayPng = await sharp(Buffer.from(svg))
    .resize(W, H, { fit: "fill" })
    .png()
    .toBuffer();

  const out = await sharp(base)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const outPath = resolve("scripts/inspect-output", "overlay-layout.jpg");
  writeFileSync(outPath, out);
  console.log(`overlay written: ${outPath} (base ${W}x${H})`);
  console.log(`regions: ${REGIONS.map((r) => r.name).join(", ")}`);
  console.log(`play_grid: ${INNING_COUNT} innings x ${BATTER_COUNT} batters`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
