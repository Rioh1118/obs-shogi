# 状態遷移表: 盤の向き（L2）

対象: `src/features/board-orientation/`。上位は [app.md](app.md)、
合図の出どころは [file-tree.md](file-tree.md)。

読む側（`useBoardOrientation`）は盤の中に載る（`src/widgets/game-board/ui/GameBoard.tsx`）。
落とす側（`useResetOrientationOnKifuChange`）は盤より上
（`src/app/providers/bridges/BoardOrientationBridge.tsx`）。
**落とす側を盤の中へ入れると E2 が消える**——棋譜を閉じると盤ごと unmount するので、
落とす者が居なくなって `?pov=gote` が URL に残る。

盤の向きは `?pov` 1つで決まる。表がこれだけのために在るのは、
**向きを戻す合図の選び方を間違えると、失敗も出さずに盤が回る**から。

## この表の軸

`pov` の値そのものではなく、**`pov` を落とす判断が何を見ているか**が軸。

「その棋譜を見ている」に見えるフィールドが3つあり、**どれもずれる。**

| フィールド            | 持ち主    | 意味                           | 動く条件                                       |
| --------------------- | --------- | ------------------------------ | ---------------------------------------------- |
| `state.loadedAbsPath` | game      | **盤に載っている棋譜**         | `game_loaded` のみ                             |
| `activeKifuPath`      | file-tree | ツリーが開いたと言っているパス | `kifu_opened` / `kifu_closed` / 改名の張り替え |
| `selectedNode`        | file-tree | ツリーで選択されている行       | クリック即時。失敗すると巻き戻る               |

下2つは**盤の中身ではない。** `openKifuNode` は構文として読めれば `kifu_opened` を出すが、
盤に載せられない `initial` を持つ棋譜はその先の `loadGame` で落ちる（E9）。
そのとき `activeKifuPath` は動くのに盤は前の棋譜のまま。`selectedNode` はさらに手前で、
読み込みに失敗すると巻き戻る（E5）。

**合図に選ぶのは `loadedAbsPath`。** `game_loaded` でしか動かないので、
定義上「盤に載っている棋譜」そのもの。

## 状態

| 記号   | 状態         | 判定                                                              |
| ------ | ------------ | ----------------------------------------------------------------- |
| **B0** | 盤に何も無い | `loadedAbsPath === null` かつ `shownKifuPathRef.current === null` |
| **B1** | 先手が手前   | `loadedAbsPath !== null` かつ `params.pov === undefined`          |
| **B2** | 後手が手前   | `loadedAbsPath !== null` かつ `params.pov === "gote"`             |
| **B3** | 記録が古い   | `shownKifuPathRef.current !== loadedAbsPath`                      |

**B3 はレンダとエフェクトの間にしか無い。** `loadedAbsPath` が変わったレンダでは
まだ ref が前の値を持っていて、その差でリセットするかどうかが決まる。
エフェクトが走り終われば必ず B0〜B2 のどれかに落ちる。**B3 が残ったら不変条件3の破れ。**

## イベント

| 記号   | イベント                                   | 発生源                                                                         |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| **E1** | 棋譜が盤に載る                             | `loadGame` の `game_loaded`（起点は `GameFileTreeBridge`）                     |
| **E2** | 棋譜を閉じる                               | `resetGame` の `reset_state`（`activeKifuPath` が null になると走る）          |
| **E3** | 向きのボタンを押す                         | `AnalysisPaneHeader` の `handleTogglePov`                                      |
| **E4** | ツリーの選択だけが動く                     | `FileNode` のクリック。`selectNode` は同期、読み込みは非同期                   |
| **E5** | 読み込みに失敗して選択が巻き戻る           | `openKifuNode` の `restoreSelection`（→ [file-tree.md](file-tree.md) E11）     |
| **E6** | 開いている棋譜をもう一度クリックする       | `FileNode.handleClick` と `selectNodeByAbsPath` の両方に `isActive` の関門     |
| **E7** | 改名・移動で `activeKifuPath` が張り替わる | `renameNode` / `moveNode` → `reconcilePathMutation` → `active_kifu_reconciled` |
| **E8** | `pov` 以外の URL が変わる                  | モーダルの開閉、`tesuu` の移動                                                 |
| **E9** | 開いた棋譜が盤に載せられず落ちる           | `loadGame` の catch → `set_error`。`game_loaded` は出ない                      |

**E8 を落とすと表が嘘になる。** `updateParams` は `searchParams` を閉じ込むので
URL が変わるたびに同一性が変わり、エフェクトの依存に載っている以上**毎回再実行される**。
「棋譜が変わったときだけ走る」のは依存配列ではなく `shownKifuPathRef` の比較が守っている。

## 表

`—` はそのイベントがその状態で起きないか、状態が変わらないもの。
`✓` は踏むテストがあるセル
（`src/features/board-orientation/model/__tests__/useBoardOrientation.test.tsx`）。

|        | E1 盤に載る                                          | E2 閉じる     | E3 ボタン     | E4 選択が動く | E5 選択が巻き戻る | E6 再クリック | E7 改名・移動 | E8 他の URL | E9 載せられず落ちる |
| ------ | ---------------------------------------------------- | ------------- | ------------- | ------------- | ----------------- | ------------- | ------------- | ----------- | ------------------- |
| **B0** | → B1（✓）                                            | —             | —※1           | —             | —                 | —             | —             | —           | —                   |
| **B1** | → B1（記録更新）                                     | → B0          | → **B2**（✓） | —             | —                 | —             | 記録更新※2    | —           | —                   |
| **B2** | → **B1**（✓）                                        | → **B0**（✓） | → B1          | **—**（✓）    | **—**（✓）        | —             | → **B1**※2    | —           | **—**（✓）          |
| **B3** | 記録を更新して `pov` を落とす。落ちる先は B0 か B1※3 | —※3           | —※3           | —※3           | —※3               | —※3           | —※3           | —※3         | —※3                 |

### 注

※1 **B0 ではボタンが描かれない。** 向きを付ける口は `AnalysisPaneHeader` だけで、
それを含む `AnalysisPane` は `AppLayout` が `gameView.hasKifu` の真の枝でしか描かない。
盤に何も載っていない間は DOM に存在しないので、E3 は起きない。
`?pov=gote` を B0 で付ける経路は、URL を直接打つほかに無い。

※2 **改名・移動では、この feature の外を一周してから合図が動く。** 経路は4段:

1. `active_kifu_reconciled` が `jkfData` を `?? state.jkfData` で持ち越し、
   `activeKifuPath` だけを張り替える（`src/entities/file-tree/model/reducer.ts`）
2. `GameFileTreeBridge` は `activeKifuPath` を依存に持つので effect が再実行され、
   **同じ `jkfData` を新しいパスで `loadGame` し直す**
3. `loadGame` は `ROOT_CURSOR` で `game_loaded` を撃つ
4. `loadedAbsPath` が新しいパスへ動く → 合図が動くので `pov` が落ちる

**「名前を直しただけで盤が回る」では済まない。** 2 で載せ直しているのは
file-tree が**開いた時点で持った** `jkfData` なので、盤・棋譜一覧・カーソルが
開いた時点まで戻る。→ 「埋まっていないセル」と #433

※3 **B3 で受けたイベントは、B3 の結末を変えない。** B3 はレンダとエフェクトの間だけの状態。
保留されているエフェクトが読むのは**そのエフェクトを登録したレンダで閉じ込めた合図**で、
現在値ではない。React は次のレンダを始める前に保留分を流すので、合図が n 個ぶん進んでいれば
n 回走り、各回が `shownKifuPathRef` を1段ずつ追いつかせる。**追いついた時点で必ず B0 か B1**
になり、途中でどのイベントを挟んだかに依らない。だから空欄ではなく `—`。

**この比較（`:29` の `shownKifuPathRef.current === shownKifuPath`）を「常に最新どうしを
比べているのだから要らない」と読んで落とさないこと。** 落とすと不変条件1が破れ、
E8（`pov` 以外の URL 変更）のたびに `pov` が消える。

## この表が満たすべき不変条件

1. **`pov` が落ちるのは、盤に載っている棋譜が変わったときだけ。**
   ツリーの選択・URL の他の変更・再クリックでは落ちない
2. **`isGotePov` は `params.pov` だけから決まる。** 別に真偽値を持たない。
   持つと URL と盤が食い違ったまま気付けない
3. **B3 はレンダを跨がない。** エフェクトが走れば必ず記録が追いつく。
   跨ぐと「棋譜が変わったのに向きが残る」か「変わっていないのに落ちる」のどちらかになる

## 埋まっていないセル

| セル       | 何が抜けているか                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `(B2, E7)` | **開いている棋譜を改名・移動すると、盤ごと開いた時点まで戻り、向きも落ちる。** テストも無い※2 → #433                    |
| `(B1, E1)` | `pov` が既定のまま別の棋譜が盤に載る経路。記録だけが更新され、`pov` の落下は no-op なので**外から観測できるものが無い** |

いずれも実装上は経路があるが、**テストは無い**。

`(B2, E7)` だけは挙動そのものが疑わしく、**この feature の外に locus がある**。
※2 の 2 段目——`GameFileTreeBridge` が「同じ `jkfData` でパスだけが変わった」場合にも
`loadGame` を撃つこと——を分ければ、向きも局面も両方直る。この feature からは
どちらの経路で `loadedAbsPath` が動いたのか見分けが付かないので、ここでは直せない。
→ #433
