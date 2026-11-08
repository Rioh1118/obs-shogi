# Changelog

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に倣い、版は semver（上げ方は CLAUDE.md）。

## [0.2.0] - 2026-11-08

### 追加
- dist/scss/_tokens.scss：製品が読む SCSS。値そのもの（CSS 変数ではない）で、文字・間隔・角丸は 10px 基準の rem。製品は `rgba(<トークン>, 透明度)` のようにコンパイル時に値を使うため
- content/glossary.md に「将棋 GUI の語」の表（製品の design-language.md から移した）
- `z` の説明に重なりの並び順（トークンを持たない層も含む）。工程2で写し漏らしていた

### 変更
- principles.md の原則4に「読むペインは本文の背景の上で詰める」を足した（写し漏れ）
- 置き場を製品のリポジトリの `design-system/` に移した
- SKILL.md の「利用先での前提」とモード A、docs/consumer-claude-md.md を製品の実際（SCSS、`index.scss` の名前、`src/shared/ui/` の部品、テーマ1つ）に合わせた

## [0.1.0] - 2026-11-08

### 変更（トークン名の削除・改名を含む）
- 値を製品の今の画面（src/index.scss）から写した基準線にした。色は sunken / default / canvas の面、text の4段、accent・commit・feedback（info / warning / danger / fatal）、border の3段。文字は用途の8段（hint〜hero）、太さ4段、間隔と角丸は 2px 刻み、角丸の役割名、動き7段、重なり、影（decisions/0003）
- テーマを1つにした。themes/dark.tokens.json を消した
- 固定値を製品に合わせた：文字の下限を本文 13px・全体 11px、行間の下限を外した、フォーカスを銅の1本のリング（#c29a78）にした（ユーザーの承認。decisions/0003）
- Button の見本・例・プレビュー・DESIGN.md の生成を新しいトークン名に合わせた。Button の部品トークンの割り当ては仮

### 追加
- 製品の規則を写した：principles.md（7原則と Do's and Don'ts）、content/（ボイスとトーン、表記、用語集）、components/_index.md（入力の種類から部品、並ぶ部品の共通の基準）、components/button.md（4つの役割、ホバーの向き）、patterns/（状態と失敗の見せ方、選択の見せ方、未決の問い）、references/product-references-2026-11.md


### 変更
- 汎用の土台（upstream）から製品専用に複製した。ブランド名・スキル名・パッケージ名を lumen.config.json と手書きの文書で替えた。CSS の接頭辞は upstream に合わせて `lm` のまま

### 追加
- references/current-screens-2026-11-08/：移行前の製品の画面16枚と一覧、実測の色
- brief.md v0.2：製品側の既存の決定と利用者の発言、モード B の質問への回答（コンセプト・性格の軸・成功を判定する目・避けたいもの）を埋めた

## [0.0.0] - 2026-11-08

### 追加
- リポジトリの器：スキル（SKILL.md）、保守規約（CLAUDE.md）、利用先向けルール（docs/consumer-claude-md.md）
- トークンの3層（base / semantic / component）を DTCG 2025.10 で。値はすべて仮（グレーの階調、4px 基数の余白、OS 標準書体）
- 固定値（locked.json）：フォーカス表示の二重リング、本文 16px・行間 1.5 の下限、コントラスト基準
- light / dark テーマ（`[data-theme]`）
- Button の見本（React + 素の CSS）
- ds:build / ds:check / ds:shot / ds:eval
- 判断記録 0001（構造）、0002（フックと CI の TODO）
