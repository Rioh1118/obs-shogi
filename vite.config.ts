import { defineConfig } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// レイヤは Feature-Sliced Design。import は下向きだけ許す。
const LAYERS_TOP_DOWN = ["app", "pages", "widgets", "features", "entities", "shared"] as const;

// 2階層以上遡る相対 import を禁じる。下のレイヤ規則は `@/` から始まるパスしか見ないため、
// これが無いと相対パスで書かれた層違反が素通りし「違反ゼロ」が信用できなくなる。
const DEEP_RELATIVE_IMPORT = {
  group: ["../../**"],
  message:
    "2階層以上遡る相対 import は禁止。`@/` エイリアスで書くこと。相対パスはレイヤ規則を素通りする。",
};

// 各レイヤから、自分より上のレイヤへの import を禁じる。
// 型を戻り値側に置くのは、末尾の `.slice(1)` が文脈型の伝播を止めてしまい、
// `["error", {...}]` が oxlint の要求するタプルではなく配列に広がるため。
const layerBoundaries = LAYERS_TOP_DOWN.map(
  (layer, depth): OxlintOverride => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      // 後勝ちで上書きされるため、共通側の DEEP_RELATIVE_IMPORT をここでも並べる。
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            DEEP_RELATIVE_IMPORT,
            {
              // 自分より前＝自分より上位のレイヤ。
              // `../${upper}/**` も並べるのは、レイヤ直下のファイルからは `../` 1段で
              // 隣のレイヤに届き、`@/` と `../../**` の2本だけでは素通りするため。
              group: LAYERS_TOP_DOWN.slice(0, depth).flatMap((upper) => [
                `@/${upper}/**`,
                `../${upper}/**`,
              ]),
              message: `${layer} から上位レイヤへの import は禁止。共有したい型やロジックは共有できる位置まで下げること。`,
            },
          ],
        },
      ],
    },
    // app は最上位なので禁止する相手がいない。
  }),
).slice(1);

// https://vite.dev/config/
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react", "import"],
    categories: {
      correctness: "error",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ["dist"],
    overrides: [
      {
        files: ["**/*.{ts,tsx}"],
        rules: {
          "no-restricted-imports": ["error", { patterns: [DEEP_RELATIVE_IMPORT] }],
          "import/no-cycle": "error",
          "constructor-super": "off",
          "for-direction": "error",
          "getter-return": "off",
          "no-async-promise-executor": "error",
          "no-case-declarations": "error",
          "no-class-assign": "off",
          "no-compare-neg-zero": "error",
          "no-cond-assign": "error",
          "no-const-assign": "off",
          "no-constant-binary-expression": "error",
          "no-constant-condition": "error",
          "no-control-regex": "error",
          "no-debugger": "error",
          "no-delete-var": "error",
          "no-dupe-class-members": "off",
          "no-dupe-else-if": "error",
          "no-dupe-keys": "off",
          "no-duplicate-case": "error",
          "no-empty": "error",
          "no-empty-character-class": "error",
          "no-empty-pattern": "error",
          "no-empty-static-block": "error",
          "no-ex-assign": "error",
          "no-extra-boolean-cast": "error",
          "no-fallthrough": "error",
          "no-func-assign": "off",
          "no-global-assign": "error",
          "no-import-assign": "off",
          "no-invalid-regexp": "error",
          "no-irregular-whitespace": "error",
          "no-loss-of-precision": "error",
          "no-misleading-character-class": "error",
          "no-new-native-nonconstructor": "off",
          "no-nonoctal-decimal-escape": "error",
          "no-obj-calls": "off",
          "no-prototype-builtins": "error",
          "no-redeclare": "off",
          "no-regex-spaces": "error",
          "no-self-assign": "error",
          "no-setter-return": "off",
          "no-shadow-restricted-names": "error",
          "no-sparse-arrays": "error",
          "no-this-before-super": "off",
          "no-undef": "off",
          "no-unexpected-multiline": "error",
          "no-unreachable": "off",
          "no-unsafe-finally": "error",
          "no-unsafe-negation": "off",
          "no-unsafe-optional-chaining": "error",
          "no-unused-labels": "error",
          "no-unused-private-class-members": "error",
          "no-unused-vars": "error",
          "no-useless-backreference": "error",
          "no-useless-catch": "error",
          "no-useless-escape": "error",
          "no-with": "off",
          "require-yield": "error",
          "use-isnan": "error",
          "valid-typeof": "error",
          "no-var": "error",
          "prefer-const": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error",
          "@typescript-eslint/ban-ts-comment": "error",
          "no-array-constructor": "error",
          "@typescript-eslint/no-duplicate-enum-values": "error",
          "@typescript-eslint/no-empty-object-type": "error",
          "@typescript-eslint/no-explicit-any": "error",
          "@typescript-eslint/no-extra-non-null-assertion": "error",
          "@typescript-eslint/no-misused-new": "error",
          "@typescript-eslint/no-namespace": "error",
          "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
          "@typescript-eslint/no-require-imports": "error",
          "@typescript-eslint/no-this-alias": "error",
          "@typescript-eslint/no-unnecessary-type-constraint": "error",
          "@typescript-eslint/no-unsafe-declaration-merging": "error",
          "@typescript-eslint/no-unsafe-function-type": "error",
          "no-unused-expressions": "error",
          "@typescript-eslint/no-wrapper-object-types": "error",
          "@typescript-eslint/prefer-as-const": "error",
          "@typescript-eslint/prefer-namespace-keyword": "error",
          "@typescript-eslint/triple-slash-reference": "error",
          "react-hooks/rules-of-hooks": "error",
          "react-hooks/exhaustive-deps": "warn",
          "react/only-export-components": [
            "warn",
            {
              allowConstantExport: true,
            },
          ],
        },
        env: {
          es2020: true,
          browser: true,
        },
        globals: {
          AudioWorkletGlobalScope: "readonly",
          AudioWorkletProcessor: "readonly",
          currentFrame: "readonly",
          currentTime: "readonly",
          registerProcessor: "readonly",
          sampleRate: "readonly",
          WorkletGlobalScope: "readonly",
        },
      },
      ...layerBoundaries,
    ],
    options: {},
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
