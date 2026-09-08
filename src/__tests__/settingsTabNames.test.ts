import { readdirSync, readFileSync } from "node:fs";
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
 * 解析の断りは復帰操作として**エンジン管理タブ**での操作を案内するので、歯車が
 * 別のタブを開くと案内が空振りする。
 *
 * **本番の口は `useOpenSettings` 1本に寄せてあり、そこは `TabKey` で受ける**ので、
 * 通る限り tsc が止める。この検査が残っているのは2つのため——
 * (a) その口を迂回して `openModal("settings", { tab: "…" })` を直に書いた回、
 * (b) `docs/spec/**` が書くタブ名（doc は型を持たない）。
 *
 * **`URLParams["tab"]` を `TabKey` にする道は無い。** `tab` は設定専用の欄ではなく、
 * `create-file` が `"create" | "import"` として同じ欄を読んでいる。
 *
 * **doc も見る。** `docs/spec/` の画面仕様がタブ名を書いているので、コードだけを直すと
 * 仕様の側が現在形で嘘になる（`CLAUDE.md` が同じ PR で直すと決めている）。
 */

/**
 * 設定モーダルを開く呼びの**第1引数の塊**を取る。
 *
 * **キーの並び順に依存しないこと。** オブジェクトのキーの順序は書き手の自由なので、
 * `modal` が `tab` より前に在る形だけを見ると、逆に書いた瞬間に素通りする。
 * 塊を取ってから中で `modal` と `tab` を別々に探す。
 */
const OPEN_MODAL = /openModal\(\s*"settings"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
const UPDATE_PARAMS = /updateParams\(\s*(\{[\s\S]*?\})\s*[,)]/g;
const TAB_IN_ARG = /\btab:\s*"([^"]*)"/;

/** 呼び1つが渡すタブ名（設定モーダル宛でなければ `null`） */
function tabOf(arg: string, requireModal: boolean): string | null {
  if (requireModal && !/\bmodal:\s*"settings"/.test(arg)) return null;
  return arg.match(TAB_IN_ARG)?.[1] ?? null;
}

/**
 * doc の中の `tab=<名前>`。**設定モーダルを名指している行だけ**を見る
 * ——`tab` の欄は `create-file` も使うので、行を絞らないとそちらの
 * `tab=import` を「実在しない」と誤って赤くする。
 */
const TAB_IN_DOC = /\btab=([\w-]+)/g;
const namesSettings = (line: string) => line.includes("settings");

/**
 * 画面仕様。**`docsSourcePaths` の `scannedDocs` は使えない** ——あちらの範囲は
 * `spec/screens/` までで、タブ名を書いている `navigation-map.md` が入らない。
 */
const specDocs = (): string[] => {
  const walk = (rel: string): string[] =>
    readdirSync(join(REPO_ROOT, rel), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${rel}/${e.name}`) : e.name.endsWith(".md") ? [`${rel}/${e.name}`] : [],
    );
  return walk("docs/spec");
};

const tabKeys = (): string[] => {
  const body = readFileSync(join(SRC, "features/settings/model/tabs.ts"), "utf8");
  return [...body.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
};

describe("設定モーダルのタブ名", () => {
  // 0件を見て緑になる形を止める
  test("タブの一覧を読めている", () => {
    expect(tabKeys()).toContain("engine");
  });

  // **迂回が0件でも緑になる形を止める。** 本番の呼びが1本も無いと、この検査は
  // 候補0件で無条件に通る——「綴りで止めている」という doc の保証が消える。
  test("設定を開く口が1つに寄っている", () => {
    const body = readFileSync(join(SRC, "features/settings/model/useOpenSettings.ts"), "utf8");

    expect(body).toContain('openModal("settings"');
  });

  test("渡しているタブ名は実在する", () => {
    const keys = tabKeys();
    const offenders = tsFiles(SRC, { includeTests: false })
      .map((path) => relative(REPO_ROOT, path))
      .flatMap((rel) => {
        const code = codeOf(readFileSync(join(REPO_ROOT, rel), "utf8"));
        return [
          ...[...code.matchAll(OPEN_MODAL)].map((m) => tabOf(m[1], false)),
          ...[...code.matchAll(UPDATE_PARAMS)].map((m) => tabOf(m[1], true)),
        ]
          .filter((name): name is string => name !== null && !keys.includes(name))
          .map((name) => `${rel}: ${name}`);
      })
      .sort();

    expect(offenders, `実在するのは ${keys.join(" / ")}`).toEqual([]);
  });

  test("画面仕様が書くタブ名も実在する", () => {
    const keys = tabKeys();

    // 0件を見て緑になる形を止める
    expect(specDocs().length, "docs/spec/ を歩けていない").toBeGreaterThan(3);

    const offenders = specDocs()
      .flatMap((rel) =>
        readFileSync(join(REPO_ROOT, rel), "utf8")
          .split("\n")
          .filter(namesSettings)
          .flatMap((line) => [...line.matchAll(TAB_IN_DOC)].map((m) => m[1]))
          .filter((name) => !keys.includes(name))
          .map((name) => `${rel}: ${name}`),
      )
      .sort();

    expect(offenders, `実在するのは ${keys.join(" / ")}`).toEqual([]);
  });
});
