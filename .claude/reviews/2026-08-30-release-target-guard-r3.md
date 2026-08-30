# レビュー release-target-guard ラウンド3

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml`（`main` `c6e1deb` からの差分）
- 走らせた reviewer: `oss-hygiene-reviewer` / `comment-reviewer`
- 対象コミット: `c7d7eed`
- 前ラウンド: [r1](2026-08-30-release-target-guard-r1.md) / [r2](2026-08-30-release-target-guard-r2.md)

**ラウンド2で入れた `ref: ${{ env.RELEASE_TAG }}` が、塞ごうとした穴を別経路で開けていた。**
5件のうち3件がラウンド2の修正そのものに紐づく。

## 所見

### [HIGH] R3-1 `ref: <タグ名>` は checkout の commit 固定を外す。4本の leg が別の木を組みうる

- 場所: `.github/workflows/release.yml:119-121`（reviewer: oss-hygiene）
- 根拠: `actions/checkout@v4` の `src/input-helper.ts` を実際に引いた
  （`gh api "repos/actions/checkout/contents/src/input-helper.ts?ref=v4"`）。

  ```ts
  if (!result.ref) {
    if (isWorkflowRepository) {
      result.ref = github.context.ref;
      result.commit = github.context.sha; // ← 実行開始時に確定した SHA
    }
  }
  // SHA?
  else if (asciiTrimmedRef.match(/^[0-9a-fA-F]{40}$/)) {
    result.commit = asciiTrimmedRef;
  }
  ```

  **`ref` を省いたときだけ commit が入る。** 40桁 hex 以外を明示すると `commit` は空のままで、
  `ref-helper.ts` の `+refs/tags/${ref}*:refs/tags/${ref}*` に落ち、fetch した時点のタグを引く。

- なぜ問題か: このリポジトリの Release は履歴上すべて `push` 経路で、`workflow_dispatch` は1本も無い。
  しかも **タグを消して push し直す運用が実際にある**（`gh run list --workflow=release.yml --json headSha,event`:
  v0.2.1 が `c03713d` で2回、v0.1.7 が `b538f54` で2回、いずれも `event: push`）。
  `concurrency` は `cancel-in-progress: false` なので走っている run は止まらない。
  付け替えの前後で leg ごとに別の木が checkout され、
  **R2-5 が塞いだつもりの「1つのリリースに別の木の資産が混ざる」が、変更前は起き得なかった経路で起きる。**
  R2-5 が得をするのは `workflow_dispatch` 経路だけで、その経路はまだ一度も使われていない。
- 直し方: `create-release` で commit を1度だけ解決して `outputs.sha` に出し、
  `build` は `ref: ${{ needs.create-release.outputs.sha }}` を取る。
  再利用経路は `git.getRef`（annotated tag は `git.getTag` でもう一段）、新規作成経路は `context.sha`。
- 導入コミットの sha: `28c12c6`（**ラウンド2で私が入れた**）
- 主張を固定するテスト名: 未検証（workflow を静的に見る検査がこの repo に無い → #270）

### [BLOCK] R3-2 `target_commitish` の上のコメントが、`ref:` を足したことで嘘になった

- 場所: `.github/workflows/release.yml:66-69`（reviewer: comment）
- 根拠: コメントは「build の checkout は `github.ref` を取り、タグが指す木と配布物の中身が一致しない」と
  書いていたが、`:119-121` で `ref:` が明示されているので取らない。
  そのうえ `target_commitish` を消しても、タグは既定ブランチに作られ `build` はその**タグ**を取るので、
  木と配布物は一致する。**「この行を消すと何が壊れるか」の説明が、成立しない故障を指していた。**
- なぜ問題か: この文を読んだ人が「checkout が `ref` を取るようになったのでこの行は要らない」と判断すると、
  ブランチから dispatch したときにタグも配布物も `main` の木になり、
  ブランチに入れた修正が入らないリリースが静かに公開される。
  `28c12c6` が checkout を変えたのに、`c4c212e` が書いたコメントを更新していなかった。
- 直し方: 現在も残る理由に書き換える。`target_commitish` が効くのは**タグをこれから作る初回だけ**で、
  効かせないと既定ブランチの木がリリースされる。
- 導入コミットの sha: `c4c212e`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R3-3 「タグを唯一の出所にする」は成り立たない。workflow の定義自体は `github.ref` から来る

- 場所: `.github/workflows/release.yml:113`（reviewer: oss-hygiene）
- 根拠: `workflow_dispatch` で走る yml は**選んだ ref のもの**で、入力の `tag` が指すタグのものではない。
  Linux の apt の行も `setup-node` のバージョンも matrix も `RELEASE_TAG` の定義自体も、
  すべて dispatch 元の ref から来る。
- なぜ問題か: 「古いタグを dispatch すればそのリリースを再現できる」と読める。
  再現されるのはソースだけで、ビルド手順は今日のものが当たる。
  さらに R2-5 のコメントが動機に挙げていた「`main` に修正を積んで同じタグを撃ち直す」は、
  この変更で**閉じている**（撃ち直してもタグの木を組むので同じ失敗が再現する）。
  復旧はタグの付け替えか新しいバージョンを切るしかないが、それがどこにも書かれていない。
- 直し方: 「組むのはソースだけで、手順は `github.ref` から来る」を1行足す。
  資産が欠けたリリースの直し方を `fail-fast: false` の隣に置く。
- 導入コミットの sha: `28c12c6`（**ラウンド2で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R3-4 `latest.json` の url の説明に「v0 が書いていた」が入っている

- 場所: `.github/workflows/release.yml:210`（reviewer: comment）
- 根拠: `:157` は `tauri-apps/tauri-action@v1`。v0 はこのファイルのどこにも現れない。
- なぜ問題か: `CONTRIBUTING.md`「『元は〜だった』も書きません。消したコードの説明は履歴の仕事です」。
  実害のある事実（`api.github.com` 形式・未認証は 60 req/h）は v0 との比較を落としても失われない。
  **R2-7 で「なぜ v1 で変わったか」を調べた経緯がそのまま残った形**で、
  r2 の末尾が自分で名指しした再発の3番目に当たる。
- 直し方: 節ごと落とし、事実は空打ちの受入手順を持つ #267 へ。
- 導入コミットの sha: `5e8af7d`（**ラウンド2で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R3-5 `with:` の16行のコメントが、その入力の値の理由になっていない

- 場所: `.github/workflows/release.yml:187-205`（reviewer: comment）
- 根拠: `with:` は入力5行に対しコメント16行。うち `latest.json` の url とレート制限、
  `[arch]` の綴り一覧はどちらも**その入力にその値を書いた理由ではない**。
  `[arch]` の節は自分で読者を外へ向けている（「ダウンロードの URL を手で組む文書はここを見て書くこと」）。
  ファイル全体では他のコメントは1行が主で、この2ブロックだけ粒度が違う。
- なぜ問題か: `CONTRIBUTING.md`「説明が必要な状態を、説明で埋めないでください」。
  README のダウンロード導線を書く人は `with:` の中を読まない。
  **届かない場所に置いた説明は、次に資産名を変えたときに更新されずに腐る**（R2-1 が実際にその形で腐った）。
- 直し方: `[arch]` は「パターンを固定の綴りに書き換えると資産と署名の突き合わせが壊れる」に絞る。
  url の話は #267 へ移す。
- 導入コミットの sha: `e6ed584` / `5e8af7d`（**ラウンド2で私が入れた**）
- 主張を固定するテスト名: 未検証

## 重複・矛盾した所見

R3-2（comment）と R3-3（oss-hygiene）は同じ行のまわりを別の理由で指している。
R3-2 は「消したら何が壊れるかの説明が偽」、R3-3 は「タグから来ないものがある」。
両方を1つの書き換えで満たした。

矛盾は無し。

## 確認して問題が無かったもの（所見にしない）

- `github.ref_name` は `refs/tags/v1.2.3` に対して `v1.2.3` を返す（v0.2.1 の実行で実証済み）
- `env` コンテキストは step の `with:` で使える
- `create-release` → `build` のタグ伝播は `needs` で順序が保証される
- `fetch-depth` の既定は 1 のままで、`git describe` に依存する箇所は無い
  （`src-tauri/build.rs` は `tauri_build::build()` だけ、バージョンはタグから焼いている）
- 資産名のパターンは v1 の実物と一致する（`utils.ts` の `renderNamePattern` と `build.ts` の arch 変換）
- `65535` / `uploadUpdaterJson` の既定 / `[arch]` の綴り / `api.github.com` 形式 / `env.RELEASE_TAG` の中身は、
  comment-reviewer が全て現物を引いて一致を確認した
- `TODO(#269)` の形は `CONTRIBUTING.md` の規約に一致。#269 は OPEN

## 見ていない範囲

- ワークフローを実際に走らせていない。R3-1 は静的解析（`actions/checkout` の入力解決）と
  実行履歴からの推論で、タグ付け替え中の混在を実演していない
- 4本の leg が並行に `latest.json` を read-modify-write する構造。
  v0.2.1 の実物には4プラットフォーム全部が載っており、取りこぼしの証拠は無い
- `tauri-action@v1` での実行例がまだ無い（r1 から未解決）
- `vp`（vite-plus）が detached HEAD で追加の要求をしないか
- `.github/workflows/ci.yml` は今回読んでいない

## lint / hook で強制できるもの

- **`actions/checkout` の `ref:` に 40桁 hex 以外を渡している箇所を弾く**検査なら機械化できる。
  R3-1 はこの形なので、#270 の workflow 検査を作るならそこに置ける
- R3-2 / R3-3 / R3-4（コメントの腐りと経緯の混入）は `commentHistory` の `ROOTS` に
  `.github/workflows/` が入っていないため止まらない（r1・r2 と同じ結論 → #270）

## 結果（書き戻し）

| 所見 | 直したコミット        | 何をしたか                                                                       |
| ---- | --------------------- | -------------------------------------------------------------------------------- |
| R3-1 | `eb8e77b`             | `create-release` が commit を1度だけ解決して配る。`build` はその SHA を checkout |
| R3-2 | `eb8e77b`             | 同じコミット。コードとコメントが同じ行のものなので分けない                       |
| R3-3 | `eb8e77b` / `b262162` | 「手順は `github.ref` から来る」を1行。復旧手順を `fail-fast` の隣へ             |
| R3-4 | `b3d8f0f`             | 「v0 が書いていた」を落とし、url の話は #267 へ                                  |
| R3-5 | `b3d8f0f`             | `with:` のコメントを16行から6行へ。`[arch]` は壊れ方だけ残した                   |

送ったもの: 無し（#267 には r2 の時点で受入手順を追記済み）。

## 3ラウンドで繰り返した形

**ラウンド1・2で入れた修正が、次のラウンドで新しい所見になった件数**: r2 で4件中3件、r3 で5件中4件。
r2 の末尾に書いた「事実の出どころを1つ挙げられるか確かめる」は、
外部の既定（`65535` / `uploadUpdaterJson` / `[arch]`）については**効いた**（r3 では1件も出ていない）。

効かなかったのは別の形。

- **直した箇所の近くにある、触っていないコメントを読み直していない。** R3-2 は
  `checkout` を変えたときに 50 行上のコメントが嘘になった。同じファイルの中でも見ていない
- **「塞いだ」と思った穴が、別の入力経路では開いたまま。** R3-1 は
  `workflow_dispatch` だけを見て `push` を見なかった。**この repo で実際に使われているのは push のほうだった**

次に何かを塞いだら、**そのコードが持つ入力経路を全部数えてから**「塞いだ」と書く。
`release.yml` の入力経路は2つ（push tag / workflow_dispatch）、
かつタグは「これから作る」「既にある」の2状態を取る。
