import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";
import { LAYERS_TOP_DOWN } from "./eslint.config";

/**
 * lint の規則が生きていることを、実際に lint して確かめる。
 *
 * `no-restricted-imports` は後に並ぶ設定が**丸ごと**差し替える。スライス単位の設定を
 * 後ろに足すとき、上位レイヤの禁止を並べ直さないとレイヤ規則が黙って消える。
 * 違反が0件のうちは lint が通るので、消えたことに気づけない。
 */

const eslint = new ESLint({ cwd: import.meta.dirname });

/** `filePath` に置いたものとして `code` を lint し、出た規則の名前を返す */
async function rulesHit(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? m.message);
}

/** 各レイヤの代表ファイル。スライスを持つ層はスライス配下から選ぶ（設定が別なので） */
const SAMPLES: Record<string, string> = {
  pages: "src/pages/AppLayout.tsx",
  widgets: "src/widgets/kifu-stream/lib/buildStreamRows.ts",
  features: "src/features/position-navigation/ui/BranchCard.tsx",
  entities: "src/entities/kifu/lib/readableMove.ts",
  shared: "src/shared/lib/turn.ts",
};

describe("レイヤ規則", () => {
  // `@/` の形だけを見ていると `../app/**` 側を消しても気づけない。pages と app には
  // レイヤ直下のファイルが実在するので、1階層の `../` で隣のレイヤに届く。
  const cases = Object.entries(SAMPLES).flatMap(([layer, file]) => {
    const depth = LAYERS_TOP_DOWN.indexOf(layer as (typeof LAYERS_TOP_DOWN)[number]);
    return LAYERS_TOP_DOWN.slice(0, depth).flatMap((upper) => [
      [file, `@/${upper}/x`],
      [file, `../${upper}/x`],
    ]);
  });

  test.each(cases)("%s から %s を読むと落ちる", async (file, spec) => {
    expect(await rulesHit(`import "${spec}";\n`, file)).toContain("no-restricted-imports");
  });

  test("下のレイヤは読める", async () => {
    expect(await rulesHit(`import "@/shared/lib/turn";\n`, SAMPLES.entities)).toEqual([]);
  });

  // レイヤごとの設定が共通の設定を丸ごと差し替えるので、どのレイヤでも並べ直されていること
  test.each(Object.entries(SAMPLES))(
    "%s でも2階層以上遡る相対 import を禁じている",
    async (_layer, file) => {
      expect(await rulesHit(`import "../../x";\n`, file)).toContain("no-restricted-imports");
    },
  );

  test("スライス配下では自スライスの barrel も禁じている", async () => {
    expect(await rulesHit(`import "@/entities/kifu";\n`, SAMPLES.entities)).toContain(
      "no-restricted-imports",
    );
  });

  test("src/__tests__ はどのレイヤも読めない", async () => {
    expect(await rulesHit(`import "@/shared/lib/turn";\n`, "src/__tests__/x.test.ts")).toContain(
      "no-restricted-imports",
    );
  });
});

describe("循環", () => {
  // 循環の検査は既定で `.js` しか辿らず、TypeScript のファイルの輪を黙って通す。
  // 実在する辺（`useNotifications.ts` → `context.ts`）の逆向きを足して輪を作る
  test("`@/` 越しでも輪になる import は落ちる", async () => {
    const code = `export { useNotifications } from "@/shared/lib/notification/useNotifications";\n`;
    expect(await rulesHit(code, "src/shared/lib/notification/context.ts")).toContain(
      "import-x/no-cycle",
    );
  });
});

describe("以前の lint から移した規則", () => {
  // 移行で黙って消えないこと。プラグインごとに1つ以上
  test.each([
    ["no-eval", "src/shared/lib/x.ts", `eval("1");\n`],
    ["no-useless-rename", "src/shared/lib/x.ts", `const { a: a } = { a: 1 };\nexport { a };\n`],
    [
      "@typescript-eslint/no-useless-empty-export",
      "src/shared/lib/x.ts",
      `export const a = 1;\nexport {};\n`,
    ],
    ["unicorn/no-thenable", "src/shared/lib/x.ts", `export const o = { then() {} };\n`],
    ["unicorn/no-new-array", "src/shared/lib/x.ts", `export const xs = new Array(3);\n`],
    [
      "unicorn/no-invalid-remove-event-listener",
      "src/shared/lib/x.ts",
      `window.removeEventListener("click", () => {});\n`,
    ],
    [
      "@eslint-react/no-missing-key",
      "src/shared/ui/x.tsx",
      `export const L = ({ xs }: { xs: string[] }) => <ul>{xs.map((x) => <li>{x}</li>)}</ul>;\n`,
    ],
    [
      "@eslint-react/dom-no-void-elements-with-children",
      "src/shared/ui/x.tsx",
      `export const B = () => <br>x</br>;\n`,
    ],
  ])("%s が落とす", async (rule, file, code) => {
    expect(await rulesHit(code, file)).toContain(rule);
  });
});

describe("lint しない場所", () => {
  // `.claude/worktrees/` には別ブランチのチェックアウトが入る。そこで落ちると
  // 今のブランチの verify が赤くなる
  test.each([
    ".claude/worktrees/x/src/shared/lib/a.ts",
    ".claude/plans/x/a.ts",
    "design-system/dist/react/Button/Button.js",
    "src-tauri/gen/a.js",
  ])("%s は見ない", async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(true);
  });

  test("src は見る", async () => {
    expect(await eslint.isPathIgnored("src/shared/lib/turn.ts")).toBe(false);
  });
});

describe("全角の空白", () => {
  // 画面に出る文字列だけを落とす。棋譜の表記（`同　銀`）はコメントと題材に書ける
  test("JSX の文字列では落ちる", async () => {
    expect(
      await rulesHit(`export const A = () => <p>同　銀</p>;\n`, "src/shared/ui/x.tsx"),
    ).toContain("no-irregular-whitespace");
  });

  test("コメントと複数行の文字列では落ちない", async () => {
    const code = "// 同　銀\nexport const a = `同　銀`;\n";
    expect(await rulesHit(code, "src/shared/lib/x.ts")).toEqual([]);
  });
});
