# レビュー cursor-vocabulary ラウンド8

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `e41bfea`
- 走らせた reviewer: comment / architecture / robustness

## robustness: **所見なし**

r7 で振る舞いを変えた3点を実物の `json-kifu-format` で検証。**すべて等価。**

最優先で見てもらった `goto(0)` → `goto(0, [])`（`goToStart`）は、依頼どおり
**別の分岐に入る**（第2引数が truthy なので `forkPointers` の連鎖分解へ行く）。
ただしループ本体は0回で、増えるのは `goto(forkPointers[0].te - 1)` を1回挟むことだけ。

| 生成条件                       | ケース数 | うち `forkPointers` 非空 | 不一致 |
| ------------------------------ | -------- | ------------------------ | ------ |
| 本譜7手 / fork率0.6 / 入れ子2  | 4800     | 1101                     | **0**  |
| 本譜7手 / fork率0.85 / 入れ子4 | 1800     | 531                      | **0**  |

比較したのは `tesuu` / `forkPointers` / `currentStream` / `getTesuuPointer` /
盤（SFEN・持ち駒込み）/ `player.kifu` の変異 / throw の有無と文言。
**「変化の中から goToStart」は 1632 ケース含まれている。**

唯一の差は**退行ではない**。ちょうど 10000 半手の線で `goto` の番人（`0 === c` の
等値判定）が分かれ、`main` は投げて `HEAD` は投げない。最終状態は両者とも
`tesuu: 0` / `forkPointers: []` で同一。`main` の throw は読み手0の `state.error` へ
行っていたので、利用者から見ると「戻るを押しても何も起きない」だった。
**沈黙する失敗が1つ減っている。**

## 所見

### HIGH

| #   | 所見                                                                   | 結果   |
| --- | ---------------------------------------------------------------------- | ------ |
| C1  | `descendTo` の `null` の doc が、描画されない状況を名指ししている      | 直した |
| C2  | `TesuuPointer` の型 doc が観測値だけを説明。`cursorKey` が同じ型を返す | 直した |

**C2 は r4 A1 の詰め残し。** 「要求の鍵と観測の識別子を分ける」で分けたのは
`KifuCursor` を組む口だけで、**型は共有のまま**。型 doc をそのまま信じると
`makeKifuCursor(tesuu, fps, cursorKey(path))` が書ける（第3引数は素の `string`）。
それは `state.cursor.tesuuPointer` に要求の鍵が入る形。

### MEDIUM

| #   | reviewer     | 所見                                                                        | 結果                        |
| --- | ------------ | --------------------------------------------------------------------------- | --------------------------- |
| A1  | architecture | `loadGame` の player が「カーソルの計算」に見えて、実体は E16 の検証        | 直した                      |
| A2  | architecture | `BranchPointRef` の `- 1` が3箇所に手書きで、同じ理由書きが3回              | 直した（`normalizeBefore`） |
| A3  | architecture | `branch-index.md` の不変条件1 が、守られていない2経路を**番号なし**で残した | **issue #310**              |
| C3  | comment      | `exportsTested` の doc が「model 全体」と言うが `TARGETS` は2ファイル       | 直した（+テスト）           |
| C4  | comment      | `branch-index.md` の `branchIndexAfterRemoval` が「テスト無し」のまま       | 直した                      |
| C5  | comment      | 「`KifuCursor` を作れるのは何本か」に1・2・3の3通りの答え                   | 直した                      |

**A1 が最も重い。** `cursorFromPlayer(buildPlayer(nextJkf, null))` の値は
jkf の中身によらず必ず `ROOT_CURSOR`。この行の実体は `initial` の検証で、
`game.md` の E16 はこの1行だけが根拠。「カーソルの計算」と読んで
`const cursor = ROOT_CURSOR` に縮めると、**E16 が黙って消える**。

**A3 は自分の編集が作った穴。** `branch-index.md` の不変条件1 から
`→ #213` を落としたが（#213 は CLOSED で正しい）、「守っていない2経路」は
残したまま行き先を与えなかった。r7 の「未決で番号の無いものは無い」の反例。
→ #310 を立てた。

**C3 で `TARGETS` を `model/` の走査と突き合わせる形にしたら `jkf.ts` が落ちた。**
`isUsableFork` は `buildNextOptions` / `branchEdit` / `sanitizeJkf` / `resolveLine` の
4つの門で使われているのにテストが1本も無かったので足した。

## このラウンドで足した機械の検査

- **`src/__tests__/playerAccess.test.ts`**（ラチェット）。`new JKFPlayer(` /
  `.goto(` / `.getTesuuPointer(` / `.getForkPointers(` を `entities/kifu/lib` に閉じる。
  **r6 / r7 / r8 と3回提案されていた。** いま違反は2箇所（#302 の `nodeId` 用）
  なのでそこを基準線にした。`gotoPath` を直呼びに戻す変異で落ちることを確認
- **`buildPlayer.test.ts`**。`gotoPath(player, ROOT_CURSOR)` を変化の中から呼ぶ経路は
  robustness が 6600 ケースで等価を確かめたが、テストは1本も無かった

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（r1 実測 / r6 で `hitKey` 再測）
- react（r2 で1件、#227 へ送った）
- 生成した棋譜に成る手を含まない（`goto` の分岐は `forkPointers` の長さだけで
  決まり手の種類を見ないので、結論は変わらないと reviewer が判断）

## lint / hook で強制できるもの

- （実装した）`JKFPlayer` に触る場所のラチェット
- （実装した）`model/` の全ファイルを `exportsTested` の対象にする突き合わせ
- 束縛なしの空 `catch {}` を UI 層で禁止（#308）
- architecture が「`src/` 直下にレイヤ名以外のディレクトリを作らせない検査は
  `testsLayerBoundary.test.ts` の `NOT_A_LAYER` で既に成立しているので
  **この項目は消してよい**」と指摘。r3 から4回再掲していたものを落とす

## 次ラウンドの対象

`normalizeBefore` の新設、`loadGame` の書き換え、ラチェット2件を見る。
所見が0件になるかを確かめる。
