import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * `openModal("settings", { tab: … })` が渡すタブ名が実在することを見る。
 *
 * **綴りを間違えても何も落ちない。** `URLParams["tab"]` は素の `string` なので tsc は
 * 通し、`SettingsPanel` の `isTabKey` が知らない名前を黙って捨てて既定のタブへ落とす。
 * 画面は「設定は開いた」ので、押した人が気づく手掛かりは**開いた先が違う**ことだけ。
 *
 * 実際に `tab: "general"` という**存在しない名前**が2箇所に入っていた。解析の断りは
 * 復帰操作としてエンジン管理タブを案内するのに、その断りを出す画面の歯車が
 * ワークスペースを開いていた。
 *
 * **型で閉じるのが本筋**（`URLParams["tab"]` を `TabKey` にする）だが、`TabKey` は
 * `features/settings` に在り、`shared` の型がそれを読むと依存の向きが逆になる。
 * 型を下げるかどうかを決めるまでの間、綴りで止める。
 */
const TAB_CALL = /openModal\(\s*"settings"\s*,\s*\{[^}]*\btab:\s*"([^"]*)"/g;

const tabKeys = (): string[] => {
  const body = readFileSync(join(SRC, "features/settings/model/tabs.ts"), "utf8");
  return [...body.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
};

describe("設定モーダルのタブ名", () => {
  // 0件を見て緑になる形を止める
  test("タブの一覧を読めている", () => {
    expect(tabKeys()).toContain("engine");
  });

  test("渡しているタブ名は実在する", () => {
    const keys = tabKeys();
    const offenders = tsFiles(SRC, { includeTests: false })
      .map((path) => relative(REPO_ROOT, path))
      .flatMap((rel) => {
        const code = codeOf(readFileSync(join(REPO_ROOT, rel), "utf8"));
        return [...code.matchAll(TAB_CALL)]
          .filter((m) => !keys.includes(m[1]))
          .map((m) => `${rel}: ${m[1]}`);
      })
      .sort();

    expect(offenders, `実在するのは ${keys.join(" / ")}`).toEqual([]);
  });
});
