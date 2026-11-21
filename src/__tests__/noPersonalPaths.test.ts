import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./walk";

/**
 * 追跡しているファイルに、書いた人の手元のホームディレクトリが入っていないこと。
 *
 * このリポジトリは公開されている。実機の出力やテストの入力を手元から写すと、
 * `/Users/<実名>/...` がそのまま載る。テストで要るのは「ホームの下のパス」という形だけなので、
 * 名前は例示用の `EXAMPLE_NAMES` に置き換える。
 *
 * **画像は見ない。** スクリーンショットに写ったパスはこの検査を素通りするので、
 * 画像を足すときは撮る前に例示用のフォルダへ切り替える。
 */
const HOME_PATH = /(?<![\w./\\])(?:\/Users\/|\/home\/|[A-Z]:\\{1,2}Users\\{1,2})([^/\\\s`'")\]]*)/g;

/** 例示用の名前。`…` は「どこかのホーム」を省略して書いたもの、空はホームの一覧そのもの */
const EXAMPLE_NAMES = new Set(["me", "someone", "x", "…", ""]);

/** 中身を文字として読まないファイル */
const BINARY = /\.(png|jpe?g|gif|ico|icns|webp|woff2?|ttf|otf|db|bin|zip|gz)$/i;

const homeNamesIn = (text: string): string[] =>
  [...text.matchAll(HOME_PATH)].map((match) => match[1]);

describe("追跡しているファイルに手元のホームディレクトリが無い", () => {
  it("例示用でない名前のホームを指していない", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\0")
      .filter((file) => file !== "" && !BINARY.test(file))
      // 判定のテストに例示でない名前を書くので、自分自身は走査しない
      .filter((file) => !file.endsWith("noPersonalPaths.test.ts"))
      // シンボリックリンク（skill の置き場がディレクトリを指す）は、指す先を別に走査している
      .filter((file) => lstatSync(join(REPO_ROOT, file)).isFile());
    // 走査が空振りして「0件」を「違反が無い」と読ませない
    expect(files.length, "走査が空振りしている").toBeGreaterThan(1000);

    const offenders = files.flatMap((file) =>
      homeNamesIn(readFileSync(join(REPO_ROOT, file), "utf8"))
        .filter((name) => !EXAMPLE_NAMES.has(name))
        .map((name) => `${file}  ${name}`),
    );

    expect(
      offenders,
      "手元のホームの名前が入っている。例示用の名前（me など）に置き換えること",
    ).toEqual([]);
  });

  it("綴りの判定そのもの", () => {
    expect(homeNamesIn("read book file : /Users/alice/book/a.db")).toEqual(["alice"]);
    expect(homeNamesIn("`/home/bob/engines`")).toEqual(["bob"]);
    expect(homeNamesIn(String.raw`C:\Users\carol\engines`)).toEqual(["carol"]);
    expect(homeNamesIn("/Users/me/ai と /Users/…")).toEqual(["me", "…"]);
    // URL の途中に出る `/home/` はホームディレクトリではない
    expect(homeNamesIn("https://sites.google.com/site/x/home/shogigui/faq")).toEqual([]);
  });
});
