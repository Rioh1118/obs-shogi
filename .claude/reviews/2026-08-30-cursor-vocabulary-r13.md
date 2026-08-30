# レビュー cursor-vocabulary ラウンド13

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `9d19344`
- 走らせた reviewer: comment / robustness

## robustness: **所見なし**

`main` との差分試験を、**再生の途中で例外を投げる盤**まで含めて回した最終確認。

| 対象                                                                                                                                                                  | ケース数     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `buildPlayer` / `computeLeafTesuu` / `buildStreamRowsFromCursor` / `deleteBranchInKifu` / `swapBranchesInKifu` / `getCommentsByCursor` / `PositionSearchContinuation` | 各 **20000** |
| `descendTo` / `resolveForkSelection`                                                                                                                                  | **100000**   |

- **不一致 0件。**「HEAD が例外 / `main` が成功」**0件**、「両方成功で値が違う」**0件**
- 差の出た 350 件は**すべて HEAD 側が良い**。うち 210 件は `goToEnd` で、
  `main` が内部の文言を**誰も読まない `state.error`** に流していたもの

r11 が「乱択棋譜は `move` を持たないので `doMove` が投げる経路を通っていない」と
残していた穴が、このラウンドで埋まった。

## 所見（comment のみ、1件 MEDIUM）

**C1 `KifuCursor` を作る口が、doc の間で2つに割れていた**

| 場所                                                                            | 何と書いてあったか        |
| ------------------------------------------------------------------------------- | ------------------------- |
| `CLAUDE.md:67` / `game.md:24`                                                   | `makeKifuCursor` が作る   |
| `branch-index.md:86-87` / `playerCursor.ts:7` / `cursor.ts:261` / `game.md:291` | `cursorFromPlayer` が作る |

`game.md` は**同じファイルの中で** 24 行目と 291 行目が食い違っていた。

`makeKifuCursor` の第3引数は**素の `string`** で、中で brand を付けるだけ。
再生器を通した値かは見ない。だから前者を先に読んだ人が書く自然な形は
`makeKifuCursor(te, fps, cursorKey({ tesuu: te, forkPointers: fps }))` で、
これは**要求の鍵を `state.cursor.tesuuPointer`（観測の欄）に入れる**。
入ると `provider.tsx` の移動前後の比較が着けもしない局面の識別子で回り、
**盤が動かないのにエラーも出ない**。r4 A1 / r8 C2 / r10 が実測した退行そのもの。

→ `CLAUDE.md` と `game.md:24` を他の4箇所に揃えた（`a821f9f`）。

## doc では保てなかったので口を閉じた（`bf0b584`）

この取り違えは **doc で禁じたあとに2回起きている**（r4 A1 / r8 C2）。
CLAUDE.md の two-strikes を満たすので、3度目を doc に頼らない形にした。

`src/__tests__/cursorConstruction.test.ts` — `makeKifuCursor(` の呼び出しと
`as TesuuPointer` を `model/cursor.ts` と `lib/playerCursor.ts` の外で禁じる。

**両方向に変異を当てて落ちることを確認した。**

| 変異                                                    | 結果                                           |
| ------------------------------------------------------- | ---------------------------------------------- |
| `lib/` に `makeKifuCursor(..., cursorKey(p))` を1本足す | `× 外から使っていない`（違反ファイル名が出る） |
| `playerCursor.ts` の呼び出しを潰す                      | `× 持つ側では実際に使っている`                 |

後者は「対象が0件になったのに緑」を止める番人。**ラチェットは足すだけでなく、
それが空振りしていないことも同時に見る**形にしてある。

これで `CLAUDE.md` の `grep -rn "as TesuuPointer" src/` という手作業の指示は不要になり、
落とし穴の記述から外した。件数はテストが数える。

## comment が確認して「食い違いなし」とした点

- r12 で直した `KifuCommentNote` の `editorKey` のコメントと CLAUDE.md の落とし穴
- 差分の新規コメントへの**変更経緯の混入 0件**
- `TODO` / `→ #N` の番号欠落 0件

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- architecture（r11 / r12 で連続して所見なし。以降の実装変更は
  ラチェット1本のみで import 関係を変えていない）
- perf（r1 / r6 で実測済み）

## lint / hook で強制できるもの

- （実装した）`makeKifuCursor` / `as TesuuPointer` の封じ込め
- doc 中の `#N` が CLOSED を指していないかの検査（r11 で two-strikes 到達、CI 向き）

## 次ラウンドの対象

C1 の doc 修正とラチェットを見る。所見が0件になるかを確かめる。
