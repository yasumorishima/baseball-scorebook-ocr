import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // sharp / opencv-js の初期化に時間がかかるため既定より長めに設定
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
