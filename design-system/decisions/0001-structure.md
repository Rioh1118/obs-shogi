# 0001. デザインシステムの構造：7つのシステムから何を採ったか

- 状態：承認済み
- 日付：2026-11-08
- 対象版：v0.0.0
- 根拠資料：references/research-2026-11.md（「優れたデザインシステムの構造比較」「倣う部分とカスタムする部分」「推奨リポジトリ構成」）

## 背景

器（ディレクトリ、トークンの層、検査、スキルの手順）だけを先に作る。値（色・書体・密度）は brief を書いたあと、SKILL.md のモード B で決める。構造は1つのシステムに決め打ちせず、7つのシステムからそれぞれ優れた部分を組み合わせる。借りるのは構造だけで、値・コード・文章は持ち込まない。

## 決定：何を採り、何を採らなかったか

| 論点 | 採ったもの | 採らなかったもの | 理由 |
| --- | --- | --- | --- |
| トークンの層 | **Primer**：Base → Functional → Component の3層（`base.*` → `color.text.default` → `button.*`） | Material の ref / sys / comp（考え方は同じだが、ライブラリがメンテナンスモード）、DADS の Primitive → Semantic の2層 | 3層にすると、部品だけの値（Button の背景など）を semantic に混ぜずに置ける。DADS の2層では部品固有の上書きの置き場がない |
| トークンの命名 | **Atlassian**：foundation.property.modifier（`color.text.subtle`、`color.border.default`）。base 層には Primer に倣って `base.` を付ける | Primer の `fgColor-default`（camelCase とハイフンの混在）、DADS の `Std-16N-170`（サイズ・太さ・行間を名前に入れる） | ドット区切りが DTCG の入れ子とそのまま対応し、CSS 変数（`--lm-color-text-subtle`）にも機械的に変換できる。名前に値を入れると、値を変えたときに名前が嘘になる |
| パターンの層 | **GOV.UK**：パターンごとに「いつ使う／使わない／仕組み／検証」（patterns/_template.md） | Material の Guidelines 構成 | 「いつ使うか」が最も厚く、AI が場面から部品を選ぶ判断に直結する |
| 文言の層 | **旧 Polaris**：content を独立した層にする（voice-and-tone、用語集、表記ルール） | Polaris の文章そのもの | 文言をパターンや部品の文書に散らさず、1か所で決める。文章は Shopify 連携アプリ限定なので持ち込まない |
| 日本語タイポの下限 | **DADS**：本文 16px、行間 1.5 以上を下限にする（GOV.UK v6 の最小 16px とも一致） | DADS のタイポの命名と具体的な段階の値 | 日本語での実績がある下限。段階の値はモード B で決める |
| 変えてよい値／固定する値 | **DADS**：アクセシビリティに関わる値を固定し、それ以外をブランドで変える。固定値の正本を locked.json に置き、ds:check で照合する | 値をすべて自由にする | フォーカス表示や文字の下限をブランドの都合で動かさないため |
| フォーカス表示 | 明暗2色の二重リング（黒 2px のアウトライン＋白 2px の内側の縁）を固定。色もブランドから独立させる | ブランド色に連動するフォーカスリング | どの背景でもどちらかの色が 3:1 以上になる。ブランド色を決めるときに一緒に動かないようにする |
| テーマ | **Carbon**：テーマ＝semantic の完全な値の組。`[data-theme]` で切り替え、light を既定にする | Carbon の layer トークン（`layer-01` など）、Atlassian の余白・モーションのテーマ | 今は light / dark の2つで足りる。layer は面の重なりが増えてから検討する |
| 配布の形 | DTCG 2025.10 の JSON を正本にし、Style Dictionary 5 で CSS 変数へ。DESIGN.md は生成物 | DESIGN.md を正本にする | 調査記事の Supernova と Atlassian の検証で、DESIGN.md だけではトークンが落ちる・トークン消費が増えると分かっている |
| 履歴 | 全システム共通：semver の CHANGELOG と、判断記録（この decisions/） | — | 利用者が何が変わったかを追えるようにする |

## 調査記事のツリーとの差分

| 記事 | このリポジトリ | 理由 |
| --- | --- | --- |
| tokens/primitive.tokens.json | tokens/base.tokens.json | Primer の層名に合わせた |
| （なし） | tokens/component/button.tokens.json | Primer の Component 層 |
| （なし） | tokens/locked.json、tokens/contrast-pairs.json | 固定値の正本と、コントラスト検査の対象ペアを技術に依存しない形で置く |
| （なし） | implementations/react/、dist/ | 正本（技術に依存しない）と見本実装（React + CSS）を分けるため |
| （なし） | lumen.config.json | ブランド名を1か所に置くため |
| （なし） | docs/consumer-claude-md.md | 利用先の CLAUDE.md に貼るルール（このリポジトリの CLAUDE.md は利用先では読まれない） |
| scripts/ の build-tokens / contrast / lint-tokens / gen-design-md / screenshot | scripts/build.mjs、check.mjs、run-evals.mjs と lib/、tests/visual.spec.mjs | npm scripts（ds:build / ds:check / ds:shot / ds:eval）の単位に合わせた。lint-tokens は check に、screenshot は Playwright のテストにした |
| evals/evals.json（ケースとアサーション） | evals/<ケース>/（prompt.md・case.yaml・graders/）＋ evals/evals.json（索引） | 2026-11 時点の skill-creator は evals.json を旧形式として扱い、`claude plugin eval` はフォルダ形式だけを読む。索引として evals.json を残した |
| 寸法のトークンなし（依頼は「グレーと最低限の semantic」） | 余白・角丸・文字サイズ・行間・太さの仮トークン | トークン外の値を禁止する lint と Button の見本を動かすための最小限。すべて「仮」 |

## ライセンス上の注意（構造だけを借りる理由）

| システム | 注意 |
| --- | --- |
| デジタル庁 DADS | 文章を引用するときは出典を書き、編集したらその旨を書く。Figma は CC BY 4.0、コードは MIT。官公庁と紛らわしい見た目にしない |
| GOV.UK | コードは MIT。GDS Transport 書体は gov.uk のサービス専用 |
| Material 3 | Apache-2.0。ライブラリはメンテナンスモード |
| IBM Carbon | Apache-2.0。IBM Plex などの書体とブランドの印象はライセンスとは別の問題 |
| GitHub Primer | MIT |
| Shopify Polaris | Shopify と連携するアプリでの利用に限定。React 版は 2026-09 にアーカイブ |
| Atlassian | Atlassian 製品と連携するアドオン専用で、派生物の作成を禁止。命名規則の考え方だけを参考にし、トークン名の一覧や値は持ち込まない |

## 結果

- 値を決める前に、検査（構文、固定値、コントラスト、トークン外の値、axe、画像差分、eval）が動く状態になった。
- モード B で3案を作るとき、案のトークンを本体と同じ名前の体系で作れば、選ばれた案をそのまま本体へ移せる。
- 未着手の項目は 0002（フックと CI）に TODO として残す。
