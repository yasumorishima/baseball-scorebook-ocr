import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LAYOUT = {
  playerColRatio: 0.135,
  rightStatsRatio: 0.770,
  headerBottom: 0.108,
  playGridBottom: 0.520,
  inningCount: 13,
  batterCount: 10,
};

async function main() {
  const input = process.argv[2] ?? "data/samples/20260412131943_001.jpg";
  const buf = readFileSync(resolve(input));
  const rotated = await sharp(buf).rotate(90).toBuffer();
  const meta = await sharp(rotated).metadata();
  const W = meta.width!, H = meta.height!;

  const gridX0 = Math.round(W * LAYOUT.playerColRatio);
  const gridX1 = Math.round(W * LAYOUT.rightStatsRatio);
  const gridY0 = Math.round(H * LAYOUT.headerBottom);
  const gridY1 = Math.round(H * LAYOUT.playGridBottom);
  const inningW = (gridX1 - gridX0) / LAYOUT.inningCount;
  const batterH = (gridY1 - gridY0) / LAYOUT.batterCount;

  console.log(`cell size (native): ${Math.round(inningW)}x${Math.round(batterH)}`);

  // ターゲット: 最初の 3 イニング x 10 打順 + 4-6 イニングの選択セル
  const targets: Array<{ inning: number; batter: number }> = [];
  for (let b = 1; b <= LAYOUT.batterCount; b++) {
    for (let i = 1; i <= 6; i++) {
      targets.push({ inning: i, batter: b });
    }
  }

  for (const t of targets) {
    const x = Math.round(gridX0 + (t.inning - 1) * inningW);
    const y = Math.round(gridY0 + (t.batter - 1) * batterH);
    const w = Math.round(inningW);
    const h = Math.round(batterH);
    const crop = await sharp(rotated)
      .extract({ left: x, top: y, width: w, height: h })
      .resize({ width: 500, height: Math.round(500 * h / w), fit: "fill" })
      .jpeg({ quality: 90 })
      .toBuffer();
    const name = `cell-b${String(t.batter).padStart(2, "0")}-i${String(t.inning).padStart(2, "0")}.jpg`;
    writeFileSync(resolve("scripts/inspect-output/cells", name), crop);
  }
  console.log(`wrote ${targets.length} cells to scripts/inspect-output/cells/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
