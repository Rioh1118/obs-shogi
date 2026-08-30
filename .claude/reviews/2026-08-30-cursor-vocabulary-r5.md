# レビュー cursor-vocabulary ラウンド5

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `80ef3a9`
- 走らせた reviewer: robustness / comment / architecture

## robustness の差分検証（r3 の続き）

r4 で型を動かしたので走らせ直した。**退行なし。**

| 何を                                                          | どう確かめたか                                | 結果                                                    |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| 鍵の書式変更（`cursorToStableKey` → `cursorKey`）             | 旧新を **30,000ケース** ＋ 同値類を約87万ペア | **不一致 0**                                            |
| コメント欄の開閉判定（`.tesuuPointer` → `cursorKey`）         | 同上 30,000ケース                             | **全ケース一致**                                        |
| brand 追加（`PlannedCursor` / `planByTe` / `navigate`）       | 差分の実行文を全確認                          | **実行文の変更なし**                                    |
| `computeLeafTesuu` / `buildStreamRowsFromCursor`（r3 未実施） | `main` と同一プロセスで各 **4,000ケース**     | **差分 0**                                              |
| `nextMove` / `goToEnd` の走査（r3 未実施）                    | 同 各 **4,000ケース**                         | 差分 667。**全件が「main が投げる → HEAD が投げない」** |

最後の行は退行ではなく**沈黙する失敗が1つ減った**もの。`main` は壊れた計画を
無検査で `forkAndForward` に渡して `TypeError` を投げ、それが読み手0の
`state.error` へ流れていた（＝利用者には何も起きないように見えた）。

## 所見

### HIGH

| #   | 所見                                                                                 | 結果   |
| --- | ------------------------------------------------------------------------------------ | ------ |
| C1  | `PLAN_WALK_LIMIT` の doc がまた偽（`nextMove` はこの定数を通らない）                 | 直した |
| C2  | 「`te > tesuu` を持てるのは誰か」に同じファイルの3つの doc が3通りの答えを書いている | 直した |
| C3  | このブランチで足したテストのコメントに変更の経緯が入っている（CONTRIBUTING 違反）    | 直した |

**C1 は同じ定数について5回目。** `nextMove` が呼ぶのは `advanceWithPlan` で、
`PLAN_WALK_LIMIT` を読むのは `advanceToLeafWithPlan` だけ。5回とも
「どちらが先に効くか」を推測で書いて外している。**推測をやめ、数えられる事実
（この定数を読む関数と、その呼び出し側）だけを書く形に変えた。**

### MEDIUM

| #   | reviewer     | 所見                                                                                     | 結果                       |
| --- | ------------ | ---------------------------------------------------------------------------------------- | -------------------------- |
| R1  | robustness   | `cursorKey` / `makeKifuCursor` の正規化を外しても 458 本すべてが緑                       | **直した（+テスト）**      |
| C4  | comment      | `cursorKey` の「正典はこれ1つ」が偽（`tesuuPointer` を直接使う経路が4つある）            | 直した                     |
| C5  | comment      | `planByTe` の理由が `buildStreamRows` で成り立たない（壊れ方が違う）                     | 直した                     |
| C6  | comment      | `buildPlayer` の doc が `CursorPath` に無い `cursor.tesuuPointer` を指す（tsc が落ちる） | 直した                     |
| C7  | comment      | 局面を指す文字列に名前が6つ。このブランチが2つ増やした                                   | 直した（`noteKey` を畳む） |
| A1  | architecture | 「te を選び直してそこへ移る」の**合成**が2箇所に手書き                                   | 直した（`descendTo`）      |
| A2  | architecture | `features/position-search` に3つ目の鍵書式が2箇所（正規化なし）                          | 直した                     |
| A3  | architecture | `buildTesuuPointer` が外部呼び出し0で公開。CLAUDE.md がそちらを規約に名指し              | 直した                     |
| A5  | architecture | 「線を乗り換えたときの深い計画」が未決のまま issue 番号も無い                            | **issue #306**             |

**R1 が最も重い。** `main` ではこの正規化は `buildCursorWithForkSelection` の中に
あり、すぐ上に理由も書かれていた。この PR で `cursorKey` / `makeKifuCursor` へ
移したとき**テストが移らなかった**ので、外しても全部緑のまま通る状態だった。
`cursor.test.ts` はどちらの関数も一度も呼んでいなかった。
テストを足して、外すと `cursorKey` で3本 / `makeKifuCursor` で2本落ちることを確認した。

## 重複・矛盾した所見

**C4（comment）と A2（architecture）は同じ主張の両側だった。**
comment は「`tesuuPointer` を直接使う経路が4つあるから『正典1つ』は偽」、
architecture は「`position-search` に3つ目の書式があるから偽」。
**両方を採った。** doc を「`CursorPath` どうしを比べる鍵はこれ1つ。着いた局面を
比べるのは `tesuuPointer`」と2種類あることを明示する形に狭め、そのうえで
`position-search` の3つ目の書式は `cursorKey` に寄せた。

**A5 は「決めずに閉じるな」という指摘。** #279 の本文は「この束が #276 / #278 の
前提になる」と宣言しており、#278 は「#196 は `branchPlan` の扱いが決まらないと
直せない」と書いている。ただし**この規則をどちらに倒すかは設計の選択**なので、
`/implement` 手順7に従い issue #306 を立ててユーザーに選んでもらう形にした。
`game.md` の「判断が決まっていない」行も番号を持つようにした。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）。`index_builder.rs` の `fork_path` 生成規則だけ、
  `cursorFromLite` の正規化が索引の出力を落とさないことの裏取りに読んだ（no-op と確認）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（r1 で実測済み）
- react（r2 で1件、#227 へ送った）

## lint / hook で強制できるもの

- **`model/cursor.ts` の export に対応するテストの存在検査。** R1 はこれで止まる
  （`cursorKey` を足したときに `describe("cursorKey")` が無ければ落とす）
- **`${p.te}-${p.forkIndex}` / `JSON.stringify(forkPointers)` を `model/cursor.ts` の
  外に書かせない**検査。A2 / A3 はこれで止まる
- **`cursor.ts` の外に `tesuuPointer:` を書かせない**ラチェット（r4 から再掲）
- `commentHistory` の `HISTORY_WORDS` に `"この PR"` を足した（C3 の実施ぶん）
- **`src/` 直下にレイヤ名以外のディレクトリを作らせない**検査（r3 / r4 から再掲）

## 次ラウンドの対象

`descendTo` の新設、`buildTesuuPointer` の非公開化、`position-search` の鍵の変更を
見る。robustness は鍵の変更（`hitKey` / `useEffect` の dep）に退行が無いかを見る。
