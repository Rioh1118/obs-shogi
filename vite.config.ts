import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  // 走査するのは `src/` と、lint の設定そのものを検査する `eslint.config.test.ts` の2つだけ
  // （あちらは `eslint.config` を import するので `src/` へ置けない）。
  // 除外を並べる形だと、`.claude/worktrees/` の別ブランチのチェックアウトや、
  // 確認用に作ったディレクトリが混ざり、`npm run test` の末尾の件数が
  // 今のコードを指さなくなる。`CLAUDE.md` はその数を現在値として読めと
  // 書いているので、混ざると数え間違いがそのまま文書へ伝播する
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "eslint.config.test.ts"],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
