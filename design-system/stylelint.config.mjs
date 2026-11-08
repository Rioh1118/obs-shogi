// トークン外の値の検出。色の直書きを禁止し、余白・角丸・文字サイズは var(--<prefix>-*) だけを許す。
// var() のフォールバック（var(--lm-x, 13px)）や他の接頭辞の変数も不合格にする。
import fs from 'node:fs';

const { cssPrefix } = JSON.parse(fs.readFileSync(new URL('./lumen.config.json', import.meta.url), 'utf8'));
const v = `var\\(--${cssPrefix}-[a-z0-9-]+\\)`;
// 1〜4個の値（ショートハンド）。各値はトークン、0、auto、またはトークンの符号反転
const term = `(?:${v}|0|auto|calc\\(${v} \\* -1\\))`;
const spacing = `/^${term}(?:\\s+${term}){0,3}$/`;
const single = `/^${v}$/`;

export default {
  ignoreFiles: ['dist/**', 'preview/**', 'node_modules/**', '**/node_modules/**', 'examples/bad/**', 'evals/results/**', 'test-results/**'],
  rules: {
    // トークンの CSS 変数（--<prefix>-*）を tokens.css 以外で宣言・上書きしない
    'property-disallowed-list': [[`/^--${cssPrefix}-/`], { message: (p) => `${p} はトークン。tokens.css 以外で宣言・上書きしない` }],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix'],
    'declaration-property-value-allowed-list': {
      '/^(padding|margin|inset|top|right|bottom|left)(-.+)?$/': [spacing, 'inherit'],
      '/^(row-|column-)?gap$/': [spacing, 'inherit'],
      '/radius$/': [spacing, 'inherit'],
      'font-size': [single, 'inherit'],
      'line-height': [single, 'inherit'],
      'font-family': [single, 'inherit'],
      'font-weight': [single, 'inherit'],
    },
  },
};
