---
name: obs-shogi-design-system
description: ObsShogi デザインシステム（トークン、コンポーネント、パターン、文言）を適用・保守する。ObsShogi を採用したプロジェクト（CLAUDE.md で指定がある）で画面・コンポーネント・CSS・画面上の文言を作る／直すとき、またはこのデザインシステム自体の方向性を探る・更新するよう頼まれたときに使う。Use when building or editing UI, CSS, or on-screen copy in a project that adopts the ObsShogi design system, or when asked to explore or update that design system. 別ブランドの UI、バックエンド、データ処理、UI を含まない作業には使わない。
---

# Design System（スキル本体）

<!-- frontmatter は生成物（lumen.config.json → npm run ds:build）。本文にはブランド名を書かない。 -->

このスキルには3つのモードがある。依頼からモードを判断し、判断できなければユーザーに聞く。

- A. 使う（既定）：このデザインシステムを採用したプロジェクトで UI を作る・直す
- B. 方向性を探る：brief から3案を作る。初回と大改修のときだけ
- C. 更新する：確定したデザインシステムを差分で変える

以下のパスは、このスキルのディレクトリ（`<skill>`。通常は `~/.claude/skills/obs-shogi-design-system`）からの相対パス。

## どのファイルをいつ読むか

| ファイル | 読むとき |
| --- | --- |
| design_system/DESIGN.md | 最初に必ず。性格、色の役割、Do's and Don'ts（生成物） |
| design_system/components/_index.md | 部品を選ぶとき。「この場面にはどれ」を引く |
| design_system/components/<名前>.md | その部品を使うときだけ |
| design_system/patterns/*.md | フォーム、エラー、空状態、レイアウトを組むとき |
| design_system/content/voice-and-tone.md | 画面に文言を書くとき |
| design_system/tokens/*.tokens.json | 値を厳密に確かめるとき。DESIGN.md よりこちらが正 |
| design_system/tokens/locked.json | 固定値と下限（フォーカス、文字サイズ、行間、コントラスト）を確かめるとき |
| design_system/brief.md | モード B・C、または「このブランドらしいか」迷ったとき |
| implementations/README.md | CSS 変数名・クラス名の約束を確かめるとき |
| implementations/react/<部品>/ | 見本実装の中身を確かめるとき |
| docs/consumer-claude-md.md | 利用先への導入方法（tokens.css と部品の読み込み方） |
| examples/good, examples/bad | 迷ったときの判断材料。bad は真似しない |

## 利用先での前提

- 技術：React と素の CSS。Tailwind、CSS-in-JS、CSS Modules は使わない。
- トークンは CSS 変数。利用先のエントリで `import 'obs-shogi-ds/tokens.css'` を1回だけ読み込む。
- テーマは `<html data-theme="light">` か `data-theme="dark"`。一部だけ切り替えるときは、その要素に `data-theme` を付ける。
- 部品は `import { Button } from 'obs-shogi-ds/react/Button'` で使う（導入は docs/consumer-claude-md.md）。
- トークン名 `color.text.subtle` は CSS 変数 `--lm-color-text-subtle` になる。クラス名には `lm-` を付ける。

## モード A：使う

1. DESIGN.md を読み、components/_index.md で使う部品を決める。
2. 既存の部品を import して使う。生の `<button>` や、自作の似た部品を作らない。
3. 色・余白・角丸・文字サイズ・行間には、意味付けトークンか部品トークンの CSS 変数（`var(--lm-*)`）だけを使う。hex、rgb()、色名、任意の px を直接書かない。`var(--lm-x, 13px)` のようなフォールバックも書かない。`--lm-base-*` は直接使わない。
4. 部品のスタイルは、部品ごとの .css ファイルに書く。クラス名は `lm-` で始める。style 属性に値を直書きしない。
5. 合う部品やトークンがないときは、作らずに止まる。「足りないもの」と「既存での代替案」を示し、ユーザーに確認する。たとえば危険や成功の色トークンはまだ無い。直書きで代用しない。
6. 文言は content/voice-and-tone.md に従う（未記入の項目は、ユーザーに聞くか、既存画面の書き方に合わせる）。
7. 完了前に検査を実行する。失敗したら直して再実行する。失敗したまま完了と報告しない。
   `npm --prefix <skill> run ds:check -- --dir <利用先で変更したディレクトリの絶対パス>`
8. 画面をスクリーンショットで確認し、DESIGN.md の Don'ts に触れていないかを自分で点検する。合否は検査結果とユーザーが決めるので、自己評価で「問題なし」と断定しない。

## モード B：方向性を探る

1. brief.md を読み、空欄や曖昧な点を最大5つまで質問する。答えは brief.md に追記する。
2. explorations/_template.md の指示に従い、3案を `explorations/<YYYY-MM-DD>-a/`、`-b/`、`-c/` に作る。3案は「軸」をずらし、互いに似せない。
3. 各案に `npm run ds:check -- --dir explorations/<YYYY-MM-DD>-a` をかけ、不合格は直してから提示する。
4. 3案を比較表で示し、ユーザーが選ぶまで待つ。勝手に1案を推して確定しない。
5. 選ばれたら、理由を decisions/ に ADR として書き、モード C の手順で本体に反映する。採らなかった案は消さずに残す。

## モード C：更新する

1. 変更の理由（きっかけとなった画面や指摘）を確認する。理由がなければ質問する。
2. 既存のトークンや部品で解決できないかを先に調べる。
3. 変更するのは正本だけ：tokens/*.tokens.json、components/*.md、patterns/、content/、principles.md、implementations/。DESIGN.md、dist/、preview/、SKILL.md の frontmatter は `npm run ds:build` で再生成し、手で編集しない。
4. `npm run ds:check` と `npm run ds:shot` を実行し、画像差分の結果をユーザーに示す。基準画像（`npm run ds:shot:update`）はユーザーの承認なしに更新しない。部品や SKILL.md を変えたら `npm run ds:eval` も実行する。
5. CHANGELOG.md を更新する。判断の理由は decisions/ に ADR として書く。版の上げ方は CLAUDE.md に従う。
6. 主色・書体・密度を大きく変える依頼だった場合は、モード B を提案する。

## 常に守ること

- brief に書かれた言葉が、一般的な「良いデザイン」より優先する。
- 固定値（locked.json）は変えない。対象はフォーカス表示（明暗2色の二重リング、太さ 2px、オフセット 2px）、本文 16px 以上（補助 14px 以上）、本文の行間 1.5 以上、コントラストの WCAG 2.2 AA（文字 4.5:1、UI 部品とフォーカス 3:1）。
- 分からない値を推測で埋めない。トークンにない値が必要になったら質問する。
- 他社の DESIGN.md、サイト、スクリーンショットの値をそのまま持ち込まない。参考元は references/ に「何を学んだか」として要約する。
- 現在の値はすべて「仮」。本番の値として扱わず、値を根拠にした判断（「この色が主色だから」など）をしない。

## コマンド（このスキルのディレクトリで実行）

- `npm run ds:build`：トークンの変換（Style Dictionary）、見本実装の配布物、SKILL.md の frontmatter、DESIGN.md、preview/ の生成
- `npm run ds:check [-- --dir <path>]`：トークンの構文と固定値、トークン外の値の lint、全ペアのコントラスト、axe（WCAG 2.2 AA）、生成物の更新漏れ、スキル文書の制約
- `npm run ds:shot`：preview/ のスクリーンショットと画像差分
- `npm run ds:eval [-- --dry-run]`：evals/ のケースを実行する（本実行は API を使う）
