# レビュー release-target-guard ラウンド8

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml` / `docs/RELEASE.md` / `CONTRIBUTING.md`
- 走らせた reviewer: `oss-hygiene-reviewer` / `comment-reviewer`
- 対象コミット: `e08ea47`
- 前ラウンド: [r7](2026-08-30-release-target-guard-r7.md)

**BLOCK / HIGH は2ラウンド続けて0件。** 出た4件のうち1件は振る舞いの穴
（5ラウンド追ってきた「タグの木 ≠ 配布物」の最後の1セル）、残り3件は散文。

## 所見

### [MEDIUM] R8-1 `sha` を決める行が、4セルのうち1セルで無言に `context.sha` を配る

- 場所: `.github/workflows/release.yml`（reviewer: oss-hygiene）
- 根拠: `createRelease` に入る条件は「リリースが無い」だけ。**リリースがあってタグが無い**セルでは
  `releaseId !== null` なので `createRelease` は呼ばれず、`tagSha` は `null` のまま
  `sha = context.sha` になる。コメントの「いま createRelease が作った」は起きていない。
- なぜ問題か: このセルは**このブランチ自身が扱うと決めたセル**（`shaOfTag` が自前で 404 を
  閉じているのは、まさにここで 422 が出るのを避けるため）。実挙動は
  「タグが1本も無いまま、dispatch した ref の先端を4本の build に配り、既存のリリースへ資産を上げる」。
  R1-4 → R2-5 → R3-1 → R4-1 と5ラウンド追ってきた形が1セルだけ残っていた。
  `if (!sha) throw` は非空なので発火しない。
- 直し方: `sha` を配る前に止める。コメントも到達するセルだけに限定した。
- 導入コミットの sha: `2d1725f`（**ラウンド4で私が入れた**）
- 主張を固定するテスト名: 未検証（inline `script:` は検査の外 → #286）

### [MEDIUM] R8-2 `concurrency` のコメントが、`env` へ寄せたときの壊れ方を誤って書いている

- 場所: `.github/workflows/release.yml`（reviewer: oss-hygiene）
- 根拠: workflow レベルの `concurrency` で `env` を参照すると、GitHub は式を空に評価せず
  **ファイルごと拒否**する（`Unrecognized named-value: 'env'`）。reviewer は他リポジトリの
  実行時エラーと actionlint の検査（`context "env" is not allowed here`）を引いている。
- なぜ問題か: この2行は「`RELEASE_TAG` に寄せるな」を守らせる唯一の説明。
  実際に寄せた人が受け取るのは group が空の run ではなく、**タグを push しても run が
  1つも始まらない**状態。症状が違えば調査の入口も違う（Actions に何も出ないので trigger を疑う）。
- 直し方: 括弧内を実態に差し替えた。
- 導入コミットの sha: `73957d1`（**ラウンド5で私が入れた**）
- 主張を固定するテスト名: 未検証。**actionlint がそのまま拾う**（→ #286 で最初に入れるべき検査）

### [MEDIUM] R8-3 復旧手順の主要な操作にコマンドが無く、最も自然な打ち方は既定ブランチの yml を使う

- 場所: `docs/RELEASE.md`（reviewer: comment）
- 根拠: この doc は他のすべての操作にコマンドを添えている（`git tag …` / `gh api …` / `curl …`）。
  「直したブランチから同じタグで `workflow_dispatch`」の行だけコマンドが無い。
  `gh workflow run` は `--ref` を省くと**既定ブランチ**を使う（`--help` の EXAMPLES に明記）。
  UI の "Run workflow" のブランチ選択も既定ブランチが初期値。
- なぜ問題か: この行の要点は「**直したブランチから**」の一点なのに、そこだけコマンドが無い。
  手順どおりリリースを消したあと `gh workflow run release.yml -f tag=v0.3.0` と撃つと
  修正前の `main` が走り、同じジョブが同じ理由で落ちる。**リリースは既に消してあるので、
  資産の欠けたリリースがもう一度公開される。** 見え方は1回目と同じで、気づく手掛かりが無い。
- 直し方: `gh workflow run release.yml --ref <直したブランチ> -f tag=vN.N.N` を置き、
  `--ref` を省くと既定ブランチが走ることを1文添える。
- 導入コミットの sha: `4714d30`（**ラウンド4で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R8-4 マトリクスの1本を「OS」「leg」「本」の3通りで呼んでいる

- 場所: `docs/RELEASE.md`（reviewer: comment）
- 根拠: 同じ `fail-fast: false` の同じ帰結を、11行離れて「1つの OS」と「1つの leg」で2回書いている。
  `leg` は r7 で足した段落で持ち込んだ語で、この doc のどこにも定義が無い。
  `4本` / `4ジョブ` / `計8本の leg` も同じものを指している。
- なぜ問題か: この doc は読み手を「yml を開かない人」に限定している。その読み手が見ている
  Actions の画面に出る語は "Jobs" と "Runs" だけ。しかも `leg` の側は
  「run はまだ続いているのでキャンセルが要るかもしれない」という**別の判断**を要求しており、
  「OS」の記述からその判断へ辿り着けない。
- 直し方: `ジョブ` に統一する（画面と既存の用法に合う）。`run` はそのまま。
- 導入コミットの sha: `24a3832` / `a306cd2`（**ラウンド5・7で私が入れた**）

## 確認して問題が無かったもの

- **r7 の3件は全て現物と一致した。** `createArtifact` が macOS の2ジョブとも `platform: 'darwin'` を
  返すこと、`upload-release-assets.ts` が同名資産を delete してから上げ直すこと、
  `upload-version-json.ts` に排他が無いこと。旧記述（署名の突き合わせが壊れる）が誤りだったことも確認された
- 資産名の表5行すべてが v0.2.1 の実物と一致
- MSI の 65535、`uploadUpdaterJson` の既定、`latest.json` の url 形式、CLI 既定名の例も一致
- `draft: false` で資産が上がるまで `latest.json` が 404 になる窓は、
  `useUpdater` が `catch` で `idle` に落とすので利用者には見えない

## 見ていない範囲

- ワークフローを走らせていない。R8-2 / R8-3 は他リポジトリの実行時エラーと
  `gh workflow run --help` からの結論で、この repo で再現させていない
- 「published なリリースを残したまま tag ref だけ消せるか」を API で実証していない。
  **消せないなら R8-1 の throw は発火しない防御になるが、`shaOfTag` の 404 ハンドリング
  （R4-2 の修正）自体も不要だったことになる**
- v0.2.1 は tauri-action **v0** で作られた資産。`@v1` で作られたリリースはまだ1つも無いので、
  資産名の一致確認は「v1 のソースを読んだ結果」と「v0 の実物」の突き合わせに留まる
- `.github/workflows/ci.yml` との比較（r2 から未実施のまま）
- NSIS が非数値 pre-release をどう扱うか（msi のみ確認）

## lint / hook で強制できるもの

- **R8-2 は actionlint がそのまま拾う。** `.github/workflows/**` に1本掛ければ
  寄せた瞬間に落ちるので、このコメント自体が要らなくなる。#286 で最初に入れるべきはこれ
- R8-1 は r4 が書いた案（`script:` を `.github/scripts/*.mjs` へ出し、
  「リリースの有無 × タグの有無」の4セルを vitest で固定する）でそのまま落ちる
- R8-4 は grep で拾えるが、**用語表が決まっていない**ので検査より先に統一を決めるほうが先
  （two-strikes に照らして1回目）

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                               |
| ---- | -------------- | -------------------------------------------------------- |
| R8-1 | `c3c0522`      | `sha` を配る前に止める。コメントも到達するセルだけに限定 |
| R8-2 | `c3c0522`      | 「空になる」→「workflow ごと弾かれ run が始まらない」    |
| R8-3 | 次ラウンドで   | `gh workflow run --ref` を復旧手順へ                     |
| R8-4 | 次ラウンドで   | `ジョブ` に統一                                          |

## 傾向（r1〜r8）

| ラウンド | 所見 | BLOCK / HIGH | 対象                     |
| -------- | ---- | ------------ | ------------------------ |
| r1〜r4   | 23   | 12           | yml の振る舞い           |
| r5       | 4    | 2            | 振る舞い1件＋置き場      |
| r6       | 7    | 1            | 新設した doc の中身      |
| r7       | 4    | 0            | doc と、doc が指す issue |
| r8       | 4    | 0            | 振る舞い1件＋散文3件     |

**まだ0件のラウンドは出ていない。** ただし r5 以降、振る舞いに対する所見は
r5 の `concurrency` と r8 の `sha` の2件だけで、どちらも
「**状態の掛け合わせを1セル見落としていた**」という同じ形をしている
（push/dispatch × 起動経路、リリースの有無 × タグの有無）。
r4 の末尾に書いた「入力経路を全部数えてから塞いだと書く」は、
**経路は数えたが掛け合わせを数えていなかった。**
