# レビュー #256 リリースの target ガード ラウンド9

- 日付: 2026-08-30
- 範囲: `fix/256-release-target-guard`（`main` = `9aa963b` からの差分）。#256
- 走らせた reviewer: `oss-hygiene`
- 対象コミット: `6de51db`
- 前ラウンド: [r8](2026-08-30-release-target-guard-r8.md)

**1件。r8 で入れたガードが、置いた位置のせいで恒真になっていた。**
r5 以降ずっと同じ形（「状態の掛け合わせのうち1セルを外している」）が続いている。

## 所見

### [BLOCK] R9-1 r8 のガードを `createRelease` の**後**に置いたので、新しいタグを切る正当な経路が必ず落ちる

- 場所: `.github/workflows/release.yml` の `create-release` ジョブ
- 根拠: 条件は `releaseId !== null && tagSha === null` だが、`releaseId` は
  直前の `createRelease` で**必ず**代入される。よって左辺は恒真で、
  条件は実質 `tagSha === null` 1つになっている。
- なぜ問題か: 状態の掛け合わせは4セル。

  | タグ | リリース | 起きること（r8 のガード）    |
  | ---- | -------- | ---------------------------- |
  | あり | あり     | 通る（正）                   |
  | あり | なし     | 通る（正）                   |
  | なし | あり     | 落ちる（**狙っていたセル**） |
  | なし | なし     | **落ちる（誤）**             |

  4セル目は `workflow_dispatch` で新しいタグを切る**通常の経路**。しかも
  `createRelease` がリリースとタグを作った**後**に落ちるので、
  「release X exists but the tag does not」という**事実と逆のメッセージ**で止まり、
  資産が1つも無いリリースが公開されたまま残る。
  タグに `-` が無ければ pre-release 扱いにならないので `/releases/latest` がそこへ移り、
  **既存の利用者の `latest.json` が 404 になる**（`docs/RELEASE.md` の「壊れたリリース」の節と同じ状態）。
  ガードは「リリースだけ残っている片割れ」を止めるために入れたのに、
  **止めたかった状態を自分で作る**。

- 直し方: `createRelease` を通す**前**に `const hadRelease = releaseId !== null` を取り、
  ガードは `hadRelease` で見る。
- 導入コミットの sha: `c3c0522`（**ラウンド8で私が入れた**）
- 主張を固定するテスト名: 未検証（ワークフローに単体テストの手段が無い。
  実際の確認は `workflow_dispatch` の空打ちに依存する → 手順は `docs/RELEASE.md`）

## 確認して問題が無かったもの

- `hadRelease` を導入しても `core.setOutput('release_id', releaseId)` は
  どちらの経路でも非 null（既存を引くか、作って代入するか）
- `sha = tagSha ?? context.sha` の到達条件は「タグもリリースも無く、
  いま `createRelease` がタグごと作った」1セルだけになった。コメントもそう直した
- `concurrency.group` は r5 で `github.event.inputs.tag || github.ref_name` に揃えてある。
  `env` を参照すると workflow ごと弾かれる制約はコメントに残っている
- `docs/RELEASE.md` の復旧手順は「リリースだけ残った」状態を前提に書いてあり、
  R9-1 が作りうる状態とそのまま合う

## 見ていない範囲

- **実際に走らせていない。** `workflow_dispatch` の空打ちはユーザーが行う
- 資産名 `[arch]` の実際の綴りは bundle ごとに違う。表は `tauri-action` の実装から
  起こしたもので、実物のリリースで突き合わせていない
- ビルドが通るか（Windows / Linux の runner を持っていない）

## lint / hook で強制できるもの

- **`github-script` の中で、代入のあとに同じ変数で分岐している形。**
  R9-1 と R4-1（タグの有無とリリースの有無を混ぜていた）が同型。
  ただし `actions/github-script` の本文は YAML の文字列なので、
  TypeScript の parser には載らない。**別建ての仕組みが要る**ので、いまは足さない
- 「状態の掛け合わせを表で書き出す」は `/state-transition-table` が既にある。
  **ワークフローにも使うべきだった**（r5 以降の所見が全部このパターン）

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                     |
| ---- | -------------- | -------------------------------------------------------------- |
| R9-1 | `f93a574`      | `hadRelease` を `createRelease` の前で取り、ガードをそれで見る |

## r5 以降で繰り返した形

r5・r7・r8・r9 の所見はどれも **「状態の掛け合わせのうち1セルを外している」**。

- r5: push と dispatch で `concurrency.group` が割れる
- r7: `[arch]` を固定すると bundle の種類ごとに違う綴りとぶつかる
- r8: タグの無いリリースへ資産を上げにいく
- r9: そのガードが「タグもリリースも無い」セルまで巻き込む

**次にこのワークフローを触るときは、先に状態の表を書く。**
`docs/RELEASE.md` に「タグとリリースの4通り」を置いた（このラウンドで追加）。
そこを更新してから YAML を書く。
