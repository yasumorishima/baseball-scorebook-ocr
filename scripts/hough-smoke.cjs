// CJS node 直接実行で hough-calibrate.ts の挙動を確認するのは tsx を経由するので
// 意味がない。代わりに本モジュールと同等の手順を純粋 CJS require で再現し、
// 初期化 → Canny → HoughLinesP まで実際に通す。
const sharp = require("sharp");

const t0 = Date.now();
console.log("[smoke-cjs] start");

const cv = require("@techstark/opencv-js");
console.log(`[smoke-cjs] require done ${Date.now() - t0} ms`);

(async () => {
  if (typeof cv.Mat !== "function") {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = () => resolve();
    });
  }
  console.log(`[smoke-cjs] init done ${Date.now() - t0} ms`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="100" y="0" width="3" height="200" fill="black"/>
    <rect x="200" y="0" width="3" height="200" fill="black"/>
    <rect x="300" y="0" width="3" height="200" fill="black"/>
    <rect x="0" y="100" width="400" height="3" fill="black"/>
  </svg>`;
  const img = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data: rgba } = await sharp(img)
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const src = cv.matFromArray(200, 400, cv.CV_8UC4, new Uint8Array(rgba));
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 50, 150);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 40, 40, 20);
    console.log(`[smoke-cjs] lines.rows=${lines.rows} total=${Date.now() - t0} ms`);
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    lines.delete();
  }
  console.log("[smoke-cjs] done", Date.now() - t0, "ms");
})();
