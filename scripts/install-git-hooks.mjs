// コミット時の hook（simple-git-hooks）を入れる。`npm install` の `prepare` から走る。
//
// **vite-plus が張った `core.hooksPath` を先に外す。** vite-plus は hook の置き場を
// `.vite-hooks/_` へ向けていた。向けたままだと git は `.git/hooks` を見ないので、
// simple-git-hooks が入れた hook は走らない。しかも `.vite-hooks/_` の入口は
// 呼ぶ先（`.vite-hooks/pre-commit`）が無いと黙って抜けるので、**整形も lint も
// 走らないままコミットが通る**。外すのはその値のときだけで、利用者が自分で
// 張った値には触らない。
import { execFileSync } from "node:child_process";

const VITE_PLUS_HOOKS_PATH = ".vite-hooks/_";

function gitConfig(...args) {
  try {
    return execFileSync("git", ["config", ...args], { encoding: "utf8" }).trim();
  } catch {
    // 値が無いと git config は 1 で終わる。git の外（tarball の展開など）でも落とさない
    return undefined;
  }
}

if (gitConfig("--get", "core.hooksPath") === VITE_PLUS_HOOKS_PATH) {
  gitConfig("--unset", "core.hooksPath");
  console.log(`core.hooksPath（${VITE_PLUS_HOOKS_PATH}）を外した`);
}

execFileSync("npx", ["simple-git-hooks"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
