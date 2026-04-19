import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = path.resolve(__dirname);

export default defineConfig({
  // tsconfig.json の paths と対応。vitest は tsconfig paths を自動解決しないので
  // ここで明示しないと `@/src/...` import がテスト実行時に解決失敗する。
  resolve: {
    alias: {
      "@/app": path.join(rootDir, "app"),
      "@/client": path.join(rootDir, "src/client"),
      "@/pwa": path.join(rootDir, "src/pwa"),
      "@/src": path.join(rootDir, "src"),
      "@/": `${rootDir}/`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // sharp の初期化に時間がかかるため既定より長めに設定
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
