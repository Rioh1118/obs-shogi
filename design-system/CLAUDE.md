# このリポジトリの保守規約

このリポジトリは、デザインシステムの正本であり、そのまま Claude Code のスキルでもある（`~/.claude/skills/obs-shogi-design-system` からシンボリックリンク）。UI を作る・デザインシステムを探る／更新する手順は SKILL.md にある。ここには保守するときの事実と常設ルールだけを書く。

## 正本と生成物

| 種類 | ファイル | 手で編集するか |
| --- | --- | --- |
| 正本（技術に依存しない） | design_system/tokens/*.tokens.json（DTCG 2025.10）、locked.json、contrast-pairs.json、principles.md、brief.md、components/*.md、patterns/、content/ | する |
| 正本（技術に依存する見本） | implementations/react/ | する |
| 設定 | lumen.config.json（ブランド名・スキル名・CSS 接頭辞） | する |
| 生成物 | design_system/DESIGN.md、dist/、preview/、SKILL.md の frontmatter | **しない**。`npm run ds:build` で作る |
| 実行結果 | evals/results/、test-results/ | しない（git 管理外） |

- DESIGN.md は生成物。直したいときは正本（トークン、principles.md）を直して `npm run ds:build`。
- 生成物はコミットする（利用先が npm の依存として読むため）。正本を変えたら同じコミットで生成物も更新する。`ds:check` は更新漏れを検出する。
- ブランド名は lumen.config.json の `brandName` にだけ書く。手書きの文書では「このデザインシステム」と書く（`ds:check` が検出する）。
- design_system/ には技術に依存する内容（React の props、CSS のクラス名、CSS 変数名）を書かない。トークン名（`color.text.subtle`）で書く。CSS との対応は implementations/README.md。

## コマンド

- `npm run ds:build` — 生成物をすべて作り直す
- `npm run ds:check` — 完了前に必ず実行。不合格のまま「完了」と言わない
- `npm run ds:check -- --dir <path>` — explorations の案や利用先のディレクトリを検査する
- `npm run ds:shot` — 画像差分。基準画像の更新（`ds:shot:update`）はユーザーの承認後だけ
- `npm run ds:eval -- --dry-run` — ケースの形式と採点ロジックの自己テスト（無料）
- `npm run ds:eval` — スキルあり／なしの本実行（実費。実行前にユーザーに確認する）

## 値を変えるとき

1. 変更の理由を確認する（きっかけの画面や指摘）。
2. 正本を変え、`npm run ds:build`、`npm run ds:check`、`npm run ds:shot` を実行する。
3. CHANGELOG.md に追記する。
4. 判断を伴う変更は decisions/ に ADR を書く（`NNNN-短い名前.md`、番号は連番）。値の変更は理由を必ず ADR に残す。
5. 画像差分はユーザーに見せる。基準画像はユーザーの承認後に更新する。

## 版の上げ方（semver）

- 1.0.0 の確定まで（0.x）：トークン名の削除・改名は minor、値の変更・追加は patch。
- 1.0.0 以降：トークン名の削除・改名は major、トークンや部品の追加と値の変更は minor、文書の修正は patch。
- 版は package.json の `version` と CHANGELOG.md の見出しをそろえる。

## 固定値

design_system/tokens/locked.json が正本。フォーカス表示（銅の1本のリング、2px、オフセット 2px）、文字サイズの下限（本文 13px、全体 11px）、コントラスト（文字 4.5:1、UI 部品 3:1）。変えるには ADR とユーザーの明示的な承認が要る。トークン側の `$extensions["local.design-system"].locked` は印で、照合は locked.json を正とする。

## トークンの約束

- 3層：`base.*`（基礎。直接使わない）→ semantic（`color.text.subtle` のような foundation.property.modifier）→ component（`button.*`）。
- テーマは semantic の `color.*` を全項目上書きする（themes/<name>.tokens.json）。一部だけの上書きは ds:check で不合格。
- `$description` を必ず書く。暫定の値は「仮」と書く。
- 新しい前景色×背景色の組み合わせを作ったら contrast-pairs.json に足す。

## やらないこと

- 他社の DESIGN.md・サイト・スクリーンショットから値やコードや文章を持ち込む。参考は references/ に「何を学んだか」として、出典 URL・確認日・ライセンスつきで書く。
- explorations/ の案を本体に直接混ぜる。選ばれた案はモード C で本体に反映し、案自体は残す。
- examples/bad を手本にする。
