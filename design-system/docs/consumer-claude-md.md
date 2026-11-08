# 利用先プロジェクトへの導入

利用先は製品のリポジトリ1つで、このディレクトリはその `design-system/` にある。npm の依存としては入れない。

## 1. 読み込み

製品の `src/index.scss` が、生成物 `dist/scss/_tokens.scss` を読み、値を製品の名前へ結ぶ。

```scss
// src/index.scss（製品）
@use "../design-system/dist/scss/tokens" as ds;
$font-body: ds.$lm-font-size-body;
```

部品の SCSS は `index.scss` だけを読む（`@use "@/index.scss" as index;`）。`dist/` を直接読まない。
製品は `rgba(<トークン>, 透明度)` のようにコンパイル時に値を使うので、CSS 変数（`dist/css/tokens.css`）ではなく値そのものを読む。

## 2. 利用先の CLAUDE.md の規則

製品の `CLAUDE.md` の「実装」の節が持つ。下の印の間は、評価（ds:eval）のケースが利用先の規則として配るもので、製品の規則と同じ内容に保つ。

<!-- consumer-rules:start -->
## デザインシステム
- UI・SCSS・画面上の文言を作る／直す前に、obs-shogi-design-system スキルを使う。
- 色・余白・角丸・文字サイズ・太さ・影は、`src/index.scss` の名前（`index.$font-body` など）だけを使う。hex・rgb()・任意の px を書かない。
- スタイルは部品ごとの .scss。Tailwind・CSS-in-JS・CSS Modules は使わない。
- 既存の部品（`src/shared/ui/`）を使う。新しい部品やトークンが要るときは、作る前に聞く。
- 盤・駒台・駒は実物の画像で、トークンの対象外。
<!-- consumer-rules:end -->

## 3. 値を変えたとき

このディレクトリで `npm run ds:build` と `npm run ds:check`（製品の根からは `npm run verify:ds`）。
製品のビルドで、変えた値が出力の CSS に出ることを確かめる。
