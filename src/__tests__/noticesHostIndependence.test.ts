import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT } from "./walk";

/**
 * `THIRD-PARTY-NOTICES.md` に、入るかが機械で変わるパッケージが載っていないこと。
 *
 * あのファイルは `scripts/generate-third-party-notices.mjs` の生成物で、
 * `npm run ratchet:notices` が生成し直した結果と突き合わせて落とす。**生成元に
 * ホスト依存が混ざると、そのラチェットは書いた人の機械でだけ通る。** ネイティブの
 * prebuilt は OS と CPU ごとに別のパッケージに分かれていて `npm ci` が1つだけを
 * 入れるので、macOS で生成した表は ubuntu のランナーで必ず落ちる。
 *
 * **その形は CI でしか見えない。** 生成も検査も同じ機械で走る限り一致するため、
 * 手元では `verify` も `verify:rust` も緑のまま通る。ここで見ておくと、
 * push する前に、ラチェットではなく通常のテストとして落ちる。
 *
 * 見るのは**生成物に何が載っているか**だけで、生成器の実装は読まない。
 * どの機械に入るかの出典は `package-lock.json` —— 入れなかった分も含めて
 * 全ターゲットのパッケージを持ち、`os` / `cpu` / `libc` で条件を書いている。
 */
const NOTICES = join(REPO_ROOT, "THIRD-PARTY-NOTICES.md");
const LOCKFILE = join(REPO_ROOT, "package-lock.json");

/**
 * 表の1行（`| 名前 | 版 | ライセンス | 著作権表示 |`）。
 *
 * 版が数字で始まることを要求して、見出しと区切りの行を外す。
 */
const ROW = /^\| (\S+) \| (\d\S*) \| /gm;

/** 生成物の表に載っているパッケージ。npm と Rust の両方の表を読む。 */
function listedPackages(): string[] {
  return [...readFileSync(NOTICES, "utf8").matchAll(ROW)].map((m) => `${m[1]}@${m[2]}`);
}

/** `os` / `cpu` / `libc` を宣言する、入るかが機械で変わるパッケージ。 */
function hostDependentPackages(): Set<string> {
  const lock = JSON.parse(readFileSync(LOCKFILE, "utf8")) as {
    packages?: Record<string, { version?: string; os?: string[]; cpu?: string[]; libc?: string[] }>;
  };

  const keys = new Set<string>();
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.os && !entry.cpu && !entry.libc) continue;
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    keys.add(`${name}@${entry.version}`);
  }
  return keys;
}

describe("THIRD-PARTY-NOTICES.md はどの機械でも同じに生成できる", () => {
  // 0件を見て緑になる形を止める
  test("表からパッケージを読めている", () => {
    expect(listedPackages().length).toBeGreaterThan(50);
  });

  // 条件付きのパッケージが依存から消えると、この検査は何も証明しなくなる。
  // 消えたこと自体は問題ではないので、そのときは緑のまま残さず、この検査を畳むか
  // 別の形で機械に載せるかを決めること。
  test("条件付きのパッケージが lockfile に在る", () => {
    expect(hostDependentPackages().size).toBeGreaterThan(0);
  });

  test("機械で入るかが変わるパッケージが載っていない", () => {
    const hostDependent = hostDependentPackages();
    const listed = listedPackages().filter((pkg) => hostDependent.has(pkg));

    expect(
      listed,
      "生成した機械にしか入らないパッケージが載っている。生成器が落とすはずの行",
    ).toEqual([]);
  });
});
