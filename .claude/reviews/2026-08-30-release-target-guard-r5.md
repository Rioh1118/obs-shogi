# レビュー release-target-guard ラウンド5

- 日付: 2026-08-30
- 範囲: `.github/workflows/release.yml`（`main` `9aa963b` からの差分）
- 走らせた reviewer: `oss-hygiene-reviewer` / `comment-reviewer`
- 対象コミット: `4714d30`
- 前ラウンド: [r4](2026-08-30-release-target-guard-r4.md)

**4件のうち3件がコメントの腐り。**「直したコメントを、次の変更でまた直す」が
3ラウンド続いたので、この回で**置き場そのものを変えた**（下の「打ち切りの判断」）。

## 所見

### [HIGH] R5-1 `concurrency` の group が起動経路で変わる。復旧が dispatch を通るのでこの経路を踏む

- 場所: `.github/workflows/release.yml:28-30`（reviewer: oss-hygiene）
- 根拠: `github.ref` は push tag では `refs/tags/v0.3.0`、`workflow_dispatch` では撃った ref。
  **排他したい資源は `RELEASE_TAG`（＝リリース1本）なのに、group はそれを見ていない。**
  `tauri-action` の `upload-version-json.ts` は `latest.json` を read-modify-delete-write する。排他は無い。
- なぜ問題か: `v0.3.0` を push → Windows が落ちる → 直したブランチから同じタグを dispatch すると、
  **別グループなので即座に起動**（`cancel-in-progress: false` なので前の run も止まらない）。
  2つの run の leg が同じ `releaseId` に対して `latest.json` を read-modify-write し、
  後勝ちで片方のプラットフォームの entry が消える。
  これまで表に出ていなかったのは、Release run が履歴上すべて `push` で
  （`gh run list --workflow=release.yml --json event` の20件すべて）、
  同じタグの撃ち直しが同じ group に入って直列化されていたため。
  **R4 が dispatch を正式な復旧手段として文書化したことで、この保護が外れる経路が初めて運用に載る。**
- 直し方: `group: release-${{ github.event.inputs.tag || github.ref_name }}`。
  workflow レベルの `concurrency` では `env` が解決されないので、`RELEASE_TAG` と同じ式を2回書く。
  その理由を残さないと、次に `env.RELEASE_TAG` へ寄せた人が group を空に落とす。
- 導入コミットの sha: `d78964a`（`git log -S 'group: release-'`）。**R4 の文書化で初めて踏む経路になった。**
- 主張を固定するテスト名: 未検証（→ #270）

### [HIGH] R5-2 `target_commitish` を消したときに起きることの説明が、`sha` の解決順序と合わない

- 場所: `.github/workflows/release.yml:89-91`（reviewer: comment）
- 根拠: `tagSha` は `createRelease` **より前**に解決され、`sha = tagSha ?? context.sha` が配られる。
  したがって `target_commitish` を消しても、その run は `context.sha`（撃った ref）から資産を組む。
  出るのは「ブランチの修正が入らないリリース」ではなく、**タグは既定ブランチ・資産はブランチ**という不一致。
  修正が本当に消えるのは**その次に同じタグで撃ち直したとき**（`tagSha` が既定ブランチを返す）。
- なぜ問題か: 確かめた読み手が「書いてあることが起きない」と判断して `target_commitish` を消しうる。
  この理由づけは `ref: ${{ env.RELEASE_TAG }}` だった r2 時代の形には正しかったもので、
  r3 でも r4 でも更新されなかった。**r3 末尾の自己批判が、書き直した当のコメントの中で再発した。**
- 直し方: 2段構え（1回目は不一致、2回目から資産まで入れ替わる）を書く。
- 導入コミットの sha: `2d1725f`（**ラウンド4で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R5-3 `outputs.sha` の1行が「タグから解決する」と言い切っている

- 場所: `.github/workflows/release.yml:44`（reviewer: comment）
- 根拠: 出所は2つある（既存タグ → `tagSha` / 新規タグ → `context.sha`）。
  r4 の短縮で「タグから」が足され、成り立たない経路が生まれた。
- なぜ問題か: 「なぜ build が私のブランチを checkout したのか」を調べる人が `:44` だけ読むと、
  タグが常に権威だと思って原因を別の場所に探す。同じジョブの中に2つの答えがある。
- 直し方: 出所を書かず `# 4本の build が組む commit。ここで1度だけ解決して配る` に戻す。
- 導入コミットの sha: `2d1725f`（**ラウンド4で私が入れた**）
- 主張を固定するテスト名: 未検証

### [MEDIUM] R5-4 `fail-fast` の上の11行は運用の手順書で、読む人が来ない場所にある

- 場所: `.github/workflows/release.yml:117-127`（reviewer: comment）
- 根拠: 11行が1トークンの設定に付いている。ファイル内の他のコメントは3〜7行。
  さらに `:11-12` が同じ帰結を先に書いており、**R2-3 で一度潰した「同じ話を離れた2箇所に書く」が復活**。
- なぜ問題か: 「資産が欠けたリリースを直したい」人は `strategy:` を開かない。
  R3-5 が `with:` について指摘した「**届かない場所に置いた説明は、次に仕様が変わったときに
  更新されずに腐る**」と同じ構図が、同じラウンドの修正で別の場所に作られている。
- 直し方: **`docs/RELEASE.md` を作ってそこへ移す。** #267 の空打ち手順も同じ文書に置ける。
- 導入コミットの sha: `4714d30`（**ラウンド4で私が入れた**）
- 主張を固定するテスト名: 未検証

## 重複・矛盾した所見

無し。oss は振る舞い（`concurrency`）、comment はコメントの真偽で軸が割れている。

## 確認して問題が無かったもの（所見にしない）

- `releaseId` が `null` のまま `createRelease` も通らない経路は無い
- `tagSha` が null で `context.sha` も空になる経路は無い。`if (!sha) throw` は現状発火しない防御
- `throw` が job を落とせば `build` は `needs` で skip される
- 復旧手順の外部の振る舞いへの主張は現物と一致（リリースの削除は資産も消しタグは残す。
  残ったタグに撃ち直すと `createRelease` 経路に戻り、`sha` は `tagSha`）
- `// Reuse if already exists (idempotent re-run)` は嘘になっていない。
  `return` が消えて役割は縮んだが、再利用の判断は `if (releaseId === null)` に残っている
- `actions/checkout` の入力解決（空の `ref` / 40桁 hex）の記述は `input-helper.ts` と一致
- 変更の経緯の混入は無い。`TODO(#269)` は `CONTRIBUTING.md` の形に合っている
- コメント59行 / コード149行。「コメントがコードより多い」には当たらない

## 見ていない範囲

- ワークフローを走らせていない。R5-1 の同時実行は静的な結論で、2 run を並走させていない
- `workflow_dispatch` はこの repo で一度も使われていない（20件すべて `event: push`）
- 「published なリリースの tag ref を消したら published のままか」を確認していない
  （確認するには repo を壊す必要がある）
- `tauri-action@v1` での実行例が無い（r1 から未解決）

## lint / hook で強制できるもの

- R5-1 は形として検出できる。**`on:` に `workflow_dispatch` を持つのに
  `concurrency.group` が `github.ref` を使っている** workflow は静的に拾える（→ #270）
- 「workflow レベルの `concurrency` で `env` は解決されない」は actionlint が既に持つ検査
- R5-2 / R5-3 のような同一ファイル内の言い換え矛盾は機械化できない。
  R5-4 は閾値に根拠が無いので、規則を足すより `docs/RELEASE.md` を作るほうが安い

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                       |
| ---- | -------------- | ---------------------------------------------------------------- |
| R5-1 | `73957d1`      | `concurrency.group` をタグに合わせ、`env` が使えない理由を残した |
| R5-2 | `24a3832`      | 2段構えを書いた                                                  |
| R5-3 | `24a3832`      | 出所の断定を落とした                                             |
| R5-4 | `24a3832`      | **`docs/RELEASE.md` を新設**し、運用の説明を丸ごと移した         |

送ったもの: 無し。

## 打ち切りの判断ではなく、原因を変えた

r2 で3/4、r3 で4/5、r4 で4/4、r5 で3/4 が「前のラウンドで自分が書いたコメント」に紐づいていた。
**同じ書き方を続けたまま回しても、次のラウンドで同じ比率が出る。**

原因は所見ごとの不注意ではなく、**置き場**にあった。
workflow のコメントに「この設定を消すと何が壊れるか」「壊れたときにどう直すか」を書くと、
その説明は制御フロー全体に依存するので、**どこか1行を直すたびに全部を再導出しないと嘘になる**。
5ラウンドで再導出に失敗し続けたのはそのため。

R5-4 で `docs/RELEASE.md` を作り、yml に残すのを
**「その行の値の理由」と「コードから読み取れない外部の制約」だけ**に絞った。
次のラウンドで見るのは、この分離が実際に効いているか。
