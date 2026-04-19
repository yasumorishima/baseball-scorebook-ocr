import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // sharp の初期化に時間がかかるため既定より長めに設定
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
