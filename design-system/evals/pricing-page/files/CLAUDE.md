## デザインシステム
- UI・CSS・画面上の文言を作る／直す前に、obs-shogi-design-system スキルを使う。
- 色・余白・角丸・文字サイズ・行間は、デザインシステムの CSS 変数（`var(--lm-*)`）だけを使う。hex・rgb()・任意の px を書かない。
- スタイルは素の CSS（部品ごとの .css、クラス名は `lm-` で始める）。Tailwind・CSS-in-JS・CSS Modules は使わない。
- 既存の部品（`obs-shogi-ds/react/*`）を import して使う。新しい部品やトークンが要るときは、作る前に聞く。
- トークンは `import 'obs-shogi-ds/tokens.css'` で読み込み済み。テーマは `data-theme="light" | "dark"`。
