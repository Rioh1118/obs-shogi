# 利用先プロジェクトへの導入

このデザインシステムを使うプロジェクト（利用先）での設定。このリポジトリの CLAUDE.md は利用先では読まれないので、利用先の CLAUDE.md に下のルールを貼る。

## 1. 読み込み

```sh
# 利用先のプロジェクトで（パスはこのリポジトリの場所）
npm i ../lumen-ds
```

```js
// エントリ（main.jsx など）で1回だけ
import 'lumen-ds/tokens.css';
```

```html
<!-- テーマは data-theme で切り替える。一部だけ切り替えるときはその要素に付ける -->
<html lang="ja" data-theme="light">
```

```jsx
import { Button } from 'lumen-ds/react/Button';
```

スキルのディレクトリ（`~/.claude/skills/...`）から直接 import しない。バンドラのファイルアクセス制限にかかるため、npm の依存として入れる。

## 2. 利用先の CLAUDE.md に貼るルール

下の印の間をそのまま貼る（ds:eval のケースもこのブロックを使う）。

<!-- consumer-rules:start -->
## デザインシステム
- UI・CSS・画面上の文言を作る／直す前に、lumen-design-system スキルを使う。
- 色・余白・角丸・文字サイズ・行間は、デザインシステムの CSS 変数（`var(--lm-*)`）だけを使う。hex・rgb()・任意の px を書かない。
- スタイルは素の CSS（部品ごとの .css、クラス名は `lm-` で始める）。Tailwind・CSS-in-JS・CSS Modules は使わない。
- 既存の部品（`lumen-ds/react/*`）を import して使う。新しい部品やトークンが要るときは、作る前に聞く。
- トークンは `import 'lumen-ds/tokens.css'` で読み込み済み。テーマは `data-theme="light" | "dark"`。
<!-- consumer-rules:end -->

hex 値、props、部品の一覧はここに書かない。それらはスキルの中にある。
