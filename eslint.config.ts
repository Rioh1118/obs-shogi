import js from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import globals from "globals";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// レイヤは Feature-Sliced Design。import は下向きだけ許す。
export const LAYERS_TOP_DOWN = [
  "app",
  "pages",
  "widgets",
  "features",
  "entities",
  "shared",
] as const;
type Layer = (typeof LAYERS_TOP_DOWN)[number];

// 2階層以上遡る相対 import を禁じる。下のレイヤ規則は `@/` から始まるパスしか見ないため、
// これが無いと相対パスで書かれた層違反が素通りし「違反ゼロ」が信用できなくなる。
const DEEP_RELATIVE_IMPORT = {
  group: ["../../**"],
  message:
    "2階層以上遡る相対 import は禁止。`@/` エイリアスで書くこと。相対パスはレイヤ規則を素通りする。",
};

// 自分より上のレイヤへの import を禁じるパターン。
// `../${upper}/**` も並べるのは、レイヤ直下のファイルからは `../` 1段で隣のレイヤに届き、
// `@/` と `../../**` の2本だけでは素通りするため。
function upperLayers(layer: Layer) {
  const depth = LAYERS_TOP_DOWN.indexOf(layer);
  return {
    group: LAYERS_TOP_DOWN.slice(0, depth).flatMap((upper) => [`@/${upper}/**`, `../${upper}/**`]),
    message: `${layer} から上位レイヤへの import は禁止。共有したい型やロジックは共有できる位置まで下げること。`,
  };
}

// 各レイヤから、自分より上のレイヤへの import を禁じる。
// app は最上位なので禁止する相手がいない（`.slice(1)`）。
// 戻り値の型を書くのは、書かないと `["error", {...}]` がタプルではなく配列に広がるため。
// `no-restricted-imports` は後に並ぶ設定が**丸ごと**差し替えるので、
// 共通側の DEEP_RELATIVE_IMPORT をここでも並べる。
const layerBoundaries = LAYERS_TOP_DOWN.slice(1).map((layer): Linter.Config => ({
  files: [`src/${layer}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": ["error", { patterns: [DEEP_RELATIVE_IMPORT, upperLayers(layer)] }],
  },
}));

// 自スライスの barrel（`@/entities/kifu` のような index）を、そのスライスの中から読み返さない。
// 読み返すと index の export がひとつ増えただけで循環になる。中からは実体を直に読むこと。
//
// layerBoundaries より後に並べる。差し替わるので、上位レイヤの規則もここで並べ直す。
const sliceSelfBarrels = (["entities", "features", "widgets"] as const).flatMap((layer) => {
  const dir = path.resolve(__dirname, "src", layer);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e): Linter.Config => ({
      files: [`src/${layer}/${e.name}/**/*.{ts,tsx}`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [DEEP_RELATIVE_IMPORT, upperLayers(layer)],
            paths: [
              {
                name: `@/${layer}/${e.name}`,
                message:
                  "自スライスの barrel を中から読まない。実体のモジュールを直接 import すること（循環の種になる）。",
              },
            ],
          },
        ],
      },
    }));
});

// `src/__tests__/` はレイヤに属さない。リポジトリ横断の検査だけを置く場所であり、
// `src/**` はデータとして読む。レイヤの外にあるので、ここを素通り口にしないため全レイヤを禁じる。
const layerFreeTests: Linter.Config = {
  files: ["src/__tests__/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          DEEP_RELATIVE_IMPORT,
          {
            group: LAYERS_TOP_DOWN.flatMap((layer) => [`@/${layer}/**`, `../${layer}/**`]),
            message:
              "src/__tests__ はレイヤに依存しない検査だけを置く場所。アプリのコードを import しない。",
          },
        ],
      },
    ],
  },
};

export default defineConfig(
  {
    ignores: ["**/dist/**", "src-tauri/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "import-x": importX,
      // 規則だけを渡す。プラグインの `configs` の型が ESLint 10 の `Plugin` と合わず、
      // こちらは `configs` を使わない（有効にする規則は下で選ぶ）
      "react-hooks": { rules: reactHooks.rules },
      "react-refresh": reactRefresh,
    },
    settings: {
      // 既定では `.js` しか辿らないので、循環の検査が TypeScript のファイルを素通りする
      "import-x/extensions": [".ts", ".tsx", ".js", ".mjs", ".cjs"],
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      // `@/` を解決できないと、循環の検査がエイリアス越しの import を辿れない
      "import-x/resolver-next": [
        createTypeScriptImportResolver({ project: path.resolve(__dirname, "tsconfig.app.json") }),
      ],
    },
    rules: {
      "no-restricted-imports": ["error", { patterns: [DEEP_RELATIVE_IMPORT] }],
      "import-x/no-cycle": "error",
      "react-hooks/rules-of-hooks": "error",
      // **error にする。** 読む値を替えて依存を替え忘れると、その `useCallback` は
      // 古い値を掴んだまま固定される。warn だと `npm run verify` が通るので、
      // そのまま出ていく
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // `_` で始まる名前は、使わないと分かって受けている名前として読む
      // （関数の形を合わせるための引数、分割代入で捨てる欄）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // 棋譜の表記は全角の空白を含む（`同　銀`）。コメントと複数行の題材に書けるようにし、
      // 画面に出る JSX の文字列では落とす（`{"　"}` で囲む。CLAUDE.md の既知の落とし穴）
      "no-irregular-whitespace": ["error", { skipComments: true, skipTemplates: true }],
      // `new Error(message, { cause })` の型は ES2022 の lib にある。tsconfig の lib は
      // ES2020 なので、付けると型検査が落ちる
      "preserve-caught-error": "off",
    },
  },
  ...layerBoundaries,
  ...sliceSelfBarrels,
  layerFreeTests,
);
