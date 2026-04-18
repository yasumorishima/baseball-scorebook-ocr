import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LAYOUT = {
  playerColRatio: 0.089,
  rightStatsRatio: 0.683,
  headerBottom: 0.080,
  playGridBottom: 0.226,
  inningCount: 13,
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
  const inningW = Math.round((gridX1 - gridX0) / LAYOUT.inningCount);
  const gridH = gridY1 - gridY0;

  console.log(`grid bounds: x=${gridX0}-${gridX1} (${gridX1 - gridX0}px wide), y=${gridY0}-${gridY1} (${gridH}px tall), inning width=${inningW}px`);

  for (let i = 0; i < LAYOUT.inningCount; i++) {
    const x = gridX0 + i * inningW;
    const crop = await sharp(rotated)
      .extract({ left: x, top: gridY0, width: inningW, height: gridH })
      .jpeg({ quality: 90 })
      .toBuffer();
    const outPath = resolve("scripts/inspect-output", `inning-${String(i + 1).padStart(2, "0")}.jpg`);
    writeFileSync(outPath, crop);
  }
  console.log(`wrote ${LAYOUT.inningCount} inning crops to scripts/inspect-output/inning-01..13.jpg`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
