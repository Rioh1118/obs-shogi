# 07 プロジェクトの運営

出典: `CONTRIBUTING.md`、`.github/ISSUE_TEMPLATE/`、`.github/workflows/`、`specs/`
版: `de27f0c1c352`

## 1. `specs/` — 機能ごとの仕様書 13 本

```
batch-analysis.md          next-move-problem.md        settings-file-recovery.md
book-data-fields.md        packed-sfen-format.md       wasm-engine-abi.md
next-move-problem-format.md  position-editing-mode.md  wasm-engine.md
record-branch-tree.md      sbk-format.md               webapp-update.md
ybb-format.md
```

大きく2種類ある。**13本のうち11本がどちらかに入り、残る2本
（`next-move-problem.md` / `wasm-engine-abi.md`）はどちらにも属さない。**

- **フォーマット仕様**（`sbk-format` / `ybb-format` / `packed-sfen-format` /
  `book-data-fields` / `next-move-problem-format`）— 外部フォーマットの読み書き規則
- **機能仕様**（`position-editing-mode` / `record-branch-tree` /
  `batch-analysis` / `wasm-engine` / `webapp-update` / `settings-file-recovery`）

`position-editing-mode.md` は 30 行ほど（[04](04-position-editing.md) に全文要旨）。
**短い。** 「どう作るか」でなく「何がどうあるべきか」だけを書いていて、
実装の詳細もファイル名も出てこない。

**obs-shogi の `docs/state-transitions/` との違い**: あちらは
「実装がいまどうなっているか・どのセルが未検証か」を書く器で、
`specs/` は「そもそも何を作るのか」を書く器。**層が違う。両方あってよい。**

## 2. issue テンプレートは4種

```
.github/ISSUE_TEMPLATE/
  config.yml
  不具合報告---bug-report.md          labels: bug        assignees: sunfish-shogi
  提案---suggestion.md
  質問---question.md
  各種タスク-管理者以外使用禁止-.md    ← メンテナ専用
```

不具合報告テンプレートの構成:

```markdown
## Checklist

- [ ] understand CONTRIBUTING.md
- [ ] I am human
- [ ] do not remove following sections

## 説明 / Description

## 再現手順 / To Reproduce （1. 2. 3. 4. の番号付き）

## 期待する動作 / Expected behavior

## スクリーンショット / Screenshots

## 環境 / Env. （OS / Version / PC App or Web App）

## その他 / Additional context
```

特徴。

- **日英併記。** 見出しも本文のガイドも両方。
- HTML コメントで書き方の指示を入れ、投稿時には消える。
- 冒頭に3つのチェックボックス。**`I am human` と
  `do not remove following sections` が入っている**のが実践的
  （テンプレートを丸ごと消して1行だけ書く投稿への対策）。
- **`assignees` が固定**でメンテナ本人。
- 「メンテナ専用」テンプレートがあり、タイトルに `管理者以外使用禁止` と書いてある。

## 3. `CONTRIBUTING.md` — 境界を引く文書

**機能一覧でも手順書でもない。「何を歓迎し、何を歓迎しないか」だけを書いている。**

歓迎するもの:

- 客観的に整理された不具合報告（環境・設定・操作手順・エラー文言・スクリーンショット）
- 関連技術のエキスパートによる助言・提言・修正（`help wanted` ラベルで募集）
- 継続的な翻訳活動
- コントリビューションに必要な質問

歓迎しないもの:

- **機能要望**（「要求されたものを作ることは望んでいません」）
- 運用や機能開発への意見・不満
- 勉強や実績づくりを主目的とした活動
- **AI まかせのコーディングやコミュニケーション**
  （「AI を開発に活用することは歓迎しますが、効率化としての利用ではなく
  能力自体を AI まかせにすることは絶対にやめてください」）

前段に「個人開発である／広告収入も寄付も受け取っていない／
メンテナーの労力を利用しているのだということを忘れないでください」を置いている。

**ラベルの運用が1つ確認できる**: `help wanted` を
「開発者が簡単に解決できず協力を求めている issue」に使う。

## 4. CI

```
.github/workflows/
  test.yml          audit.yml
  test-cli.yml      publish-cli.yml
  release.yml
.github/dependabot.yaml
```

`audit.yml`（依存の脆弱性）と `dependabot.yaml` が独立している。
CLI（`src/command/usi-csa-bridge`）は本体と**別のワークフローで test / publish**。

## 5. その他の作法

- `.coderabbit.yaml` — AI コードレビューの設定を入れている
- `.editorconfig` / `.prettierrc.cjs` / `.prettierignore` / `.browserslistrc`
- `tsconfig.json` を3つに分割（`tsconfig.json` / `.bg.json` / `.lint.json`）
- `README.md` と `README.en.md` の2言語
- `docs/` は**GitHub Pages の実体**（`index.html` / `how-to-use.html` /
  `release-*.json` / スクリーンショット / third-party-licenses）。
  **設計文書は置いていない**（それは `specs/`）
- `docs/third-party-licenses/` に依存ライセンスの原文を番号付きで全部置いている
- i18n は `src/common/i18n/locales/` に ja / en / vi / zh_tw の4言語

## obs-shogi との対応

|                    | ShogiHome                                       | obs-shogi（`a435ba4` で確認）                                                             |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 仕様書             | `specs/` に機能仕様13本                         | **無い。**`docs/state-transitions/` は実装の状態を書く器で層が違う                        |
| issue テンプレート | 4種（md 形式）・日英併記・チェックリスト付き    | **ある。**`bug_report.yml` / `feature_request.yml` / `config.yml`（**Issue Forms 形式**） |
| PR テンプレート    | `.github/PULL_REQUEST_TEMPLATE.md`              | **ある**                                                                                  |
| CONTRIBUTING       | 受け入れの境界を引く文書                        | 430行。参加方法＋実装の作法（コメント・SCSS）。**性格が違う**                             |
| CODE_OF_CONDUCT    | 無し                                            | **ある**                                                                                  |
| SECURITY.md        | 無し                                            | **ある**                                                                                  |
| ライセンス表示     | 依存の原文を全部同梱                            | `LICENSE.md` のみ                                                                         |
| 依存の監査         | `audit.yml` ＋ `dependabot.yaml`                | `dependabot.yml` あり。専用の audit ワークフローは無し                                    |
| CI                 | test / test-cli / audit / release / publish-cli | `ci.yml` / `release.yml`                                                                  |
| CHANGELOG          | 無し（リリースノートで代替）                    | 無し                                                                                      |
| i18n               | ja / en / vi / zh_tw                            | 日本語のみ                                                                                |

## 所感

- **`specs/` の層が obs-shogi に無いのは効いていると思う。**
  `docs/state-transitions/` は「いまこうなっている」を書く器なので、
  「これから何を作るか」を書く場所が `.claude/plans/` しかない
  （**しかもそこは `.gitignore` 済みで、公開リポジトリの読み手には見えない**）。
  そして plans は実装計画（ファイル一覧・タスク分解）なので、
  **「何を作るか」と「どう作るか」が同じ文書に混ざっている**。
  局面編集の駒箱の食い違いは、まさにその混ざりから出ている。
- **テンプレート類は obs-shogi の方が揃っている**（Issue Forms・CODE_OF_CONDUCT・SECURITY）。
  欠けているのは `specs/` 相当の層と CHANGELOG。
- ShogiHome の `CONTRIBUTING.md` は**個人開発の境界防衛**に振り切っていて、
  「標準的な OSS の作法」としてそのまま真似る対象ではない。
  ただし「歓迎するもの／歓迎しないもの」を明示する形式そのものは
  一般的な良い作法（GitHub の Open Source Guides も推奨している）。
- `I am human` チェックボックスは 2026 年時点の実務として現実的。
