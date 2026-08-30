# レビュー game-cursor-plan ラウンド11

- 日付: 2026-08-30
- 範囲: `git diff ebb041a..HEAD`（`CLAUDE.md` 1行 + テスト2本）
- 対象コミット: `67eac96`
- 走らせた reviewer: comment / react / oss-hygiene
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) 〜 [r10](2026-08-30-game-cursor-plan-r10.md)

**コードとドキュメントの所見はゼロ。** comment「無し」/ react「無し」。
残った2件はどちらも **GitHub の issue の本文**についてで、リポジトリの中身ではない。

## 所見

| #   | 深刻度 | 所見                                                                  | reviewer    | 結果                    |
| --- | ------ | --------------------------------------------------------------------- | ----------- | ----------------------- |
| X1  | MEDIUM | #196 が結果を取り違えている（別の枝に当たる → 実際は throw して失敗） | oss-hygiene | 対応済み（#196 を改稿） |
| X2  | MEDIUM | #272 の単体再現コマンドが、リポジトリの実行系と別のものを動かしている | oss-hygiene | 対応済み（#272 を改稿） |

### react が変異で確かめた（今回の主眼）

r10 の W2 で react 自身が挙げた破り方を、実際に当てた。

```
- const forkTexts = player.getReadableForkKifu?.() ?? [];
+ const forkTexts = player.getReadableForkKifu?.(te) ?? [];
```

→ `1 failed / 14 passed`。落ちたのは今回足した1本。

```
FAIL buildStreamRows.test.ts > 選択肢は te の forks から出る
AssertionError: expected [ +0, 1, +0, +0 ] to deeply equal [ +0, +0, 1, +0 ]
```

呼び出し点では `player.tesuu === te - 1` なので、引数を `te` にすると1手先の `forks` を
数えることになる。**狙った性質は固定されている。** 確認後にファイルを戻し、
`npm run verify` 397件緑・`git status --porcelain` 空を確認済み。

### X1 — 症状の分類を取り違えていた

r10 の W3 で #196 を書き直したとき、「辿っていない枝に**当たりうる**」と書いた。
oss-hygiene が実際に組んで確かめると、`resolveLine` は解決できないパスを解決せず

```
THROW: resolveLine failed at te=4 forkIndex=0
```

を投げる。`deleteBranch` が catch して `set_error` に落とすので、**棋譜は書き換わらず、
画面には何も出ない**。`forkAndForward` が false を返す条件と `isUsableFork` が false になる
条件は同じ枝を見ているので、**走査が降りられなかった pointer は必ず `resolveLine` でも落ちる**。

「別の枝が消える（データが壊れる）」を再現しようとした人は、エラーで何も消えないのを見て
「再現しない」と判断する。**W3 が避けようとした穴を、別の形で作り直していた。**
原因（`branchForkPointers` が計画から作られる）と「やること」は正しいのでそのまま。

### X2 — issue に載せた再現コマンドが別物を動かしていた

#272 に「単体で走らせると毎回出る」として `npx vitest run <file>` を載せたが、
`npx` が拾うのはリポジトリの実行系（`vp test run`）とは別の vitest で、
`Cannot find package 'happy-dom'` で**テストを1件も実行していない**。
`Errors 1 error` の中身は `ERR_MODULE_NOT_FOUND` であって、報告している
`ReferenceError: window is not defined` ではなかった。

`npx vp test run <file>` なら3回とも緑。**flake 自体は実在する**（`npm test` 全体で
2回に1回出る）が、単体再現の節だけが誤り。これを合否のオラクルにすると、
`AnalysisProvider` の cleanup を足しても足さなくても同じ出力になり「直った」と誤判定する。

## 見ていない範囲

- **`src-tauri/`** — 11ラウンド続けて誰も読んでいない
- **実行時検証（アプリの起動）** — 11ラウンドすべて静的な読みと vitest のみ
- `KifuForkActions` / `KifuMoveActions` / `KifuCommentNote` の中身（#263 / #266 / #268 へ）
- `readCandidates` の入れ子フォーク平坦化

## lint / hook で強制できるもの

新規は無し。持ち越しは次のとおり。

1. **`as TesuuPointer` の出現箇所を数える検査** → #243
2. **`failure-surfacing.md` の F 番号の参照検査**（r9 V4）
3. **実装を変えたら、その関数を引用している open issue を洗い直す手順**（r10 W3 / X1）。
   このループは #245 で2回・#196 で2回、同じ外し方をしている
4. `docs/**/*.md` を verify-gate に（#251）/ `vp lint --deny-warnings`（r5 から）

## 打ち切りの判断

**コードとドキュメントに対する所見がゼロのラウンドが出た。** X1 / X2 は
リポジトリの外（issue 本文）で、どちらもこのラウンドで直した。
`CLAUDE.md` のループ条件（指摘ゼロのラウンドが1回出る）を満たしたものとして、PR を出す。

11ラウンドで出た所見は延べ **60件超**。うちこのブランチで直したのが大半で、
差分の範囲外だったものは issue に送った（#196 #245 #260 #262 #263 #264 #265 #266 #268 #272）。
