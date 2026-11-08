# implementations/

技術に依存する見本実装だけを置く場所。使い分け・状態・アクセシビリティの規則は `design_system/components/*.md` が正本で、ここはそれを満たす実装である。

| 技術 | 場所 | 配布物（`npm run ds:build` が生成） |
| --- | --- | --- |
| React 19 + 素の CSS | `react/<Component>/{Component.jsx, Component.css, index.js}` | `dist/react/<Component>/` |

## CSS の約束

- クラス名は `lm-` を付けた BEM 風：`lm-button`、`lm-button--primary`。
- 値はすべて CSS 変数（`var(--lm-*)`）。トークン名 `color.text.subtle` は `--lm-color-text-subtle` になる（接頭辞は `lumen.config.json` の `cssPrefix`）。
- コンポーネントは component トークン（`--lm-button-*`）を優先し、なければ semantic を使う。base（`--lm-base-*`）は参照しない。
- フォーカス表示は `focus.ring.*` をそのまま使う。変えない。
- Tailwind、CSS-in-JS、CSS Modules は使わない。
