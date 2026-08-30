# BranchIndex と forkIndex

分岐を指す値は2種類あり、1ずれる。取り違えると**別の分岐が消えてファイルに保存される**。

値の分類を先に列挙せず個別に検査を足すと、`空配列` → `[null]` → `NaN`・小数 → 負 のように
**1形ずつ漏れる**。実際にそうなった。だから表にする。

## 2つの座標系

|               | 意味                                                         | 本譜                             | k番目の変化 |
| ------------- | ------------------------------------------------------------ | -------------------------------- | ----------- |
| `forkIndex`   | `IMoveFormat.forks` の添字。`ForkPointer.forkIndex` と同じ値 | 持たない（`null` / `undefined`） | `k`         |
| `BranchIndex` | 分岐一覧の中での位置                                         | `MAIN_LINE` = 0                  | `k + 1`     |

`BranchIndex` の上限は**候補数**。候補数は `forks.length + 1` とは限らない。
`readCandidates` が「同じ手数の入れ子の変化」を兄弟に平坦化するので、それより多くなりうる。

## 状態（`BranchIndex` の値の分類）

| 記号 | 判定条件                                            | 例                        |
| ---- | --------------------------------------------------- | ------------------------- |
| S0   | `Number.isInteger(b) && b === 0`                    | `MAIN_LINE`、`-0`         |
| S1   | `Number.isInteger(b) && 1 <= b < candidates.length` | `1`, `2`                  |
| S2   | `Number.isInteger(b) && b >= candidates.length`     | 候補3本での `3`           |
| S3   | `Number.isInteger(b) && b < 0`                      | `-1`                      |
| S4   | `!Number.isInteger(b)`                              | `0.5`, `NaN`, `±Infinity` |

`-0` は S0 に入る。`Number.isInteger(-0)` は `true`、`-0 < 0` は `false` で、
`splice(-0, 1)` も `splice(0, 1)` と同じ。**`0` と区別しない**。

## 生成側 — どの状態が作れるか

| イベント                                                      | 入力              | 結果                                                | テスト                  |
| ------------------------------------------------------------- | ----------------- | --------------------------------------------------- | ----------------------- |
| `MAIN_LINE`                                                   | —                 | S0                                                  | ✓ `branch.test.ts`      |
| `branchIndexFromSelection(null)`                              | —                 | S0                                                  | ✓                       |
| `branchIndexFromSelection(f)` / `branchIndexFromForkIndex(f)` | `f` が0以上の整数 | S1 または S2                                        | ✓                       |
| 同上                                                          | `f` が負          | **throw** `forkIndex -1 is not a valid forks index` | ✓                       |
| 同上                                                          | `f` が非整数      | **throw** 同上                                      | ✓                       |
| `neighborBranchIndex(b, "up")`                                | `b = MAIN_LINE`   | S3（`-1`）。**検査しない**                          | ✓ 消費側で throw を確認 |
| `neighborBranchIndex(b, "down")`                              | `b` が末尾        | S2。**検査しない**                                  | ✓ 同上                  |
| `branchIndexAfterRemoval(b)`                                  | `b = MAIN_LINE`   | S3（`-1`）。**検査しない**                          | ✗ 到達不能（下記）      |
| `as BranchIndex`                                              | 任意              | 任意。**型では止まらない**（規約で禁止）            | —                       |

**S2 / S3 を意図的に返す関数が3つある。** どれも候補数を知らないので上限を見られない。
値が正しいかは消費側が決める。

## 消費側 — 各状態を渡すと何が起きるか

| 消費側                                     | S0 (`0`)                 | S1 (範囲内)             | S2 (上に外れる)             | S3 (負)                                  | S4 (非整数)                    |
| ------------------------------------------ | ------------------------ | ----------------------- | --------------------------- | ---------------------------------------- | ------------------------------ |
| `assertBranchIndex(b, candidates)`         | 通す                     | 通す                    | throw `out of range (0..N)` | throw `out of range`                     | throw `is not an integer`      |
| `forkIndexFromBranchIndex(b)`              | throw `has no forkIndex` | `b - 1`                 | `b - 1`（範囲は見ない）     | throw `has no forkIndex`                 | throw `has no forkIndex`       |
| `setBranchIndex(fps, te, b)`               | `te` の pointer を削除   | `forkIndex: b-1` を書く | 同左（範囲は見ない）        | throw（`forkIndexFromBranchIndex` 経由） | throw（同左）                  |
| `swapBranchesInKifu` の `a` / `b`          | 本譜を入れ替え           | 変化を入れ替え          | throw                       | throw                                    | throw                          |
| `deleteBranchInKifu` の `target`           | 本譜を削除               | その変化を削除          | throw                       | throw                                    | throw                          |
| `branchLabel(forkIndex)`（`forkIndex` 側） | `"変化1"`                | `"変化k+1"`             | `"変化k+1"`                 | `"変化0"`（throw しない）                | `"変化NaN"` 等（throw しない） |

`assertBranchIndex` は `swapBranchesInKifu` / `deleteBranchInKifu` の入口で必ず走る。
`forkIndexFromBranchIndex` が範囲を見ないのは、上限（候補数）を知らないから。
役割が違う2つの門で、**上限は `assertBranchIndex` だけが見る**。

## 埋まっていないセル

| セル                                                    | 状態                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `-0` を各消費側に渡す                                   | **テスト無し。** 実装上 `0` と同じ経路に落ちる（`Number.isInteger(-0)` も `splice(-0)` も `0` と同じ）ことを実測で確認済み |
| `branchIndexAfterRemoval(MAIN_LINE)` → `setBranchIndex` | **テスト無し。** 今日の呼び出し側は `chosen >= 1` を確かめてから呼ぶので到達しない。到達したら throw する                  |
| `branchLabel` の S3 / S4                                | ✓ テストあり。throw せず壊れたラベルを出す                                                                                 |
| `as BranchIndex` で作った値                             | **テストで固定できない。** 型では止まらないので規約と lint で守る                                                          |

## 不変条件

1. **`forks` の添字として書かれる値は、必ず0以上の整数である。**
   `ForkPointer.forkIndex` に `-1` や `0.5` が残ると、その場では落ちず遠くで表に出る。
   出方は経路で違う。`resolveLine`（`branchEdit`）は
   `resolveLine failed at te=N forkIndex=-1` を投げるが、`JKFPlayer.forkAndForward` は
   **`forks.length` 以上なら `false` を返すのに、負や非整数は `forks[-1]` を掴んで
   内部で `TypeError`** になる。

   計画に沿って `forkAndForward` する走査は `advanceWithPlan`
   （`src/entities/kifu/lib/advanceWithPlan.ts`）の1本で、壊れた値はそこで捨てる。
   **捨てていないのは `goto` に渡す経路**（`buildPlayer` / `goToIndex`。`goto` は
   `forkAndForward` の返り値すら見ない）**と `buildCursorWithForkSelection`** の2つ。
   この2つは値を検査せず、`cursor.forkPointers` に載せたまま先へ運ぶ。

2. **要求した局面に着いたかは `tesuu` では判定できない。**
   `goto` は実在しない変化を黙って捨てて本譜を進むので、**要求した `tesuu` ちょうどで
   別の線に着く**。比べるなら `player.getTesuuPointer(tesuu)` と `cursor.tesuuPointer`。
3. **範囲外の値は、黙って別の候補に丸められない。**
   `splice` は `NaN` も小数も0方向へ丸めるので、大小比較だけの検査では
   `NaN` が「本譜を消す」に化ける。整数であることを先に見る。
4. **表示のための関数は throw しない。**
   `branchLabel` は `BranchCard` / `StatusTips` / `KifuForkMenu` からレンダ中に呼ばれる。
   壊れた `forkIndex` では壊れたラベルを出す。ラベル1つのために画面を落とさない。
   値の検査は編集の入口（`swapBranchesInKifu` / `deleteBranchInKifu`）が行う。

## 実装との対応

- 生成: `src/entities/kifu/model/branch.ts`
- 上限の検査: `src/entities/kifu/lib/branchEdit.ts` の `assertBranchIndex`（非公開）
- 候補数の決まり方: 同ファイルの `readCandidates`（入れ子の変化を平坦化する）
- テスト: `src/entities/kifu/model/__tests__/branch.test.ts`、
  `src/entities/kifu/lib/__tests__/branchEdit.test.ts`
