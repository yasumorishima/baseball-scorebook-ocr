import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2] ?? "data/samples/20260412131943_001.jpg";
const outDir = "scripts/inspect-output";

async function main() {
  const buf = readFileSync(resolve(input));
  const meta = await sharp(buf).metadata();
  console.log(`original: ${meta.width}x${meta.height}, EXIF orientation=${meta.orientation ?? "(none)"}`);

  // rotated variants to see which orientation is upright
  for (const angle of [0, 90, 180, 270] as const) {
    const out = await sharp(buf).rotate(angle).resize({ width: 1600 }).jpeg({ quality: 80 }).toBuffer();
    const path = resolve(outDir, `rotated-${angle}.jpg`);
    writeFileSync(path, out);
    const rMeta = await sharp(out).metadata();
    console.log(`rotated ${angle}deg -> ${rMeta.width}x${rMeta.height} -> ${path}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
