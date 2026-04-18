import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const input = process.argv[2] ?? "data/samples/20260412131943_001.jpg";
  const buf = readFileSync(resolve(input));
  const rotated = await sharp(buf).rotate(90).toBuffer();
  const meta = await sharp(rotated).metadata();
  const W = meta.width!, H = meta.height!;

  // Try TWO variants: current ratios and much-larger playGridBottom
  const variants = [
    { name: "v-current",  x0: 0.135, x1: 0.770, y0: 0.080, y1: 0.226 },
    { name: "v-taller",   x0: 0.135, x1: 0.770, y0: 0.080, y1: 0.500 },
    { name: "v-widest",   x0: 0.135, x1: 0.770, y0: 0.080, y1: 0.700 },
    { name: "v-player",   x0: 0.000, x1: 0.135, y0: 0.080, y1: 0.500 },
  ];

  for (const v of variants) {
    const x = Math.round(v.x0 * W);
    const y = Math.round(v.y0 * H);
    const w = Math.round((v.x1 - v.x0) * W);
    const h = Math.round((v.y1 - v.y0) * H);
    const crop = await sharp(rotated)
      .extract({ left: x, top: y, width: w, height: h })
      .resize({ width: 1400 })
      .jpeg({ quality: 85 })
      .toBuffer();
    const outPath = resolve("scripts/inspect-output", `play-grid-${v.name}.jpg`);
    writeFileSync(outPath, crop);
    console.log(`${v.name}: x=${x},y=${y},w=${w},h=${h} -> ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
