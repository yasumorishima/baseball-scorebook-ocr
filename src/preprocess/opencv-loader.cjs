// Vite/vitest/tsx の ESM loader が傍受しないよう、純 CJS ファイルとして隔離した
// opencv-js ローダ。ESM 経由での動的 import + thenable await は Emscripten module と
// 相性が悪く deadlock する（scripts/hough-probe*.ts で確認）ので、
// 純 Node require 経路で Module を取得し onRuntimeInitialized で init 完了を待つ。

"use strict";

let cached = null;

function loadOpenCV() {
  if (cached) return cached;
  cached = new Promise(function (resolve) {
    const cv = require("@techstark/opencv-js");
    if (typeof cv.Mat === "function") {
      resolve(cv);
      return;
    }
    cv.onRuntimeInitialized = function () {
      resolve(cv);
    };
  });
  return cached;
}

module.exports = { loadOpenCV };
