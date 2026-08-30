# 状態遷移表: game（L1）

対象: `src/entities/game/model/provider.tsx` と `reducer.ts`、`src/entities/game/lib/cursor.ts`、
および分岐メニューを持つ `src/widgets/kifu-stream/`。

上位は [app.md](app.md)。分岐を指す値の分類は [branch-index.md](branch-index.md)、
失敗がどこへ出るかは [failure-surfacing.md](failure-surfacing.md) が持つ。

「**いま居る局面**」と「**これから降りるつもりの変化**」を別々の値で持っている。
2つは `tesuu` と `ForkPointer[]` の組で構造が同じで、型だけでは区別がつかない。
widget へ渡す口は brand 付きの `PlannedCursor`（`entities/kifu/model/cursor.ts`）で分けてあるが、
`provider.tsx:73-78` は同じ組み立てを手書きで持っている（→ #247）。
同じ取り違えから #226 と #196 が出ている。

イベントを列でなく行に置いてあるのは、この表はイベントが状態より一桁多く、
列に並べると1行が読めない幅になるため。他の表（`app.md` / `engine.md`）とは向きが違う。

## 2つの値

|                             | 意味                                                                       | `te` の範囲                                    | 型                                                           |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `state.cursor.forkPointers` | **辿った**変化。いま盤に出ている局面をここまで再生するのに使った選択       | `te <= cursor.tesuu` に必ず正規化される        | `KifuCursor`。`cursorFromSource` が作る                      |
| `state.branchPlan`          | **計画した**変化。辿った分に加え、カーソルより先で降りるつもりの選択も持つ | 上限なし。**線の末尾より先の `te` も残りうる** | 素の `ForkPointer[]`。`PlannedCursor` に載せて widget へ渡す |

**`te <= cursor.tesuu` の範囲では2つは必ず同じ内容になる**（不変条件1）。
食い違うのは `te > cursor.tesuu` の部分だけ。だから取り違えは
「カーソルより**先**の行を操作したとき」にしか表に出ない。手元で一度触った程度では踏まない。

## 状態

`tesuu` は `state.cursor?.tesuu ?? 0` の略。

| 記号   | 状態                       | 判定                                                                                 |
| ------ | -------------------------- | ------------------------------------------------------------------------------------ |
| **G0** | 未ロード                   | `jkf === null`（`cursor === null`、`branchPlan` は `[]`）                            |
| **G1** | カーソルより先の予定が無い | `jkf !== null && !branchPlan.some((fp) => fp.te > tesuu)`。2つの値は同じ内容         |
| **G2** | カーソルより先の計画を持つ | `jkf !== null && branchPlan.some((fp) => fp.te > tesuu)`。先の行にチェックが出ている |

**G1 は「本譜にいる」ではない。** 3手目で変化1を選んでそこに留まれば
`branchPlan = [{te: 3, forkIndex: 0}]` / `tesuu = 3` で `te > tesuu` が無いので G1 だが、
盤は変化の上にいる。G1 が言っているのは「**いま辿っている線**より先の予定が無い」ことだけ。

**G2 はユーザーの1操作では作れない。** 入るには

1. 先の分岐を選ぶ（`applyCursor` → `branchPlan = [{te: 10, forkIndex: 0}]`）
2. 戻る。`cursor.forkPointers` からは `te > 5` が落ちるが、`mergeBranchPlan` が
   `prevPlan.filter((fp) => fp.te > cursor.tesuu)` で計画側には残す

の2手が要る。**2手目を踏まずに実装を確認すると、G2 の列は全部素通りする。**
`te > 線の末尾` の計画が残る場合も G2 に含む。

## 外部の状態（ディスク上の棋譜）

編集系は**メモリを先に更新してから保存する**。保存が失敗しても state は戻さない。

| 記号   | 状態                           | 判定                                                                   |
| ------ | ------------------------------ | ---------------------------------------------------------------------- |
| **P0** | 保存先が無い                   | `persistence === undefined`（`activeKifuPath` か `kifuFormat` を欠く） |
| **P1** | メモリとディスクが一致         | 最後の `save` が成功                                                   |
| **P2** | **メモリとディスクが食い違う** | `save` が `success: false` を返した後                                  |

判定は `persistIfPossible` の `if (!persistence) return`（`provider.tsx:45`）だけ。
`state.loadedAbsPath` は保存の判定に関与しない。`persistence` を作るのは
`GamePersistenceGate` で、`activeKifuPath` と `kifuFormat` の両方が揃ったときだけ。
**そして `GameFileTreeBridge` は3つ揃いでしか `loadGame` しない**ので、
棋譜が載った状態で P0 になる経路は現状の配線には無い。

## イベント

| 記号    | イベント                        | 発生源                                                                           |
| ------- | ------------------------------- | -------------------------------------------------------------------------------- |
| **E1**  | `loadGame`                      | `GameFileTreeBridge`（ツリーで棋譜を開く）                                       |
| **E2**  | `resetGame`                     | 棋譜を閉じる                                                                     |
| **E3**  | `nextMove`                      | → キー / `GameControls`                                                          |
| **E4**  | `previousMove`                  | ← キー / `GameControls`                                                          |
| **E5**  | `goToStart`                     | `GameControls`                                                                   |
| **E6**  | `goToEnd`                       | `GameControls`                                                                   |
| **E7**  | `goToIndex(n)`                  | 棋譜ストリームの行クリック                                                       |
| **E8**  | `applyCursor(c)`                | 局面ナビ / 検索ヒット / 分岐メニュー                                             |
| **E9**  | 分岐メニューで「本譜」          | `KifuForkMenu`                                                                   |
| **E10** | 分岐メニューで「変化 k」        | `KifuForkMenu`                                                                   |
| **E11** | `makeMove`                      | 盤のクリック                                                                     |
| **E12** | `setCommentsByCursor`           | コメント欄                                                                       |
| **E13** | `swapBranches` / `deleteBranch` | 行メニュー                                                                       |
| **E14** | 保存の失敗                      | `persistence.save`（Rust の書き込み）                                            |
| **E15** | ワークスペース変更              | `GameFileTreeBridge` / `GamePersistenceGate`                                     |
| **E16** | 棋譜を載せられない              | パース済み JKF の複製・`JKFPlayer` 構築の失敗（`provider.tsx:256`）              |
| **E17** | 編集の失敗                      | `applyMoveWithBranch` / `assertBranchIndex` の throw（`:233` / `:366` / `:403`） |

`selectSquare` / `selectHand` の失敗（`:521` / `:552`）は `selectedPosition` の話で、
この表が持つ `cursor` / `branchPlan` / `jkf` を動かさないので扱わない。
`set_error` の9箇所はこの2つを引いた7つが E14 / E16 / E17 と E3〜E10 に対応する。

**棋譜の読み取り失敗とパース失敗はこの表に来ない。** `GameFileTreeBridge` は
`activeKifuPath` / `jkfData` / `kifuFormat` が揃ったときだけ `loadGame` を呼ぶので、
パースできなかった棋譜は `loadGame` に届かない。それらは file-tree が `kifu_error` に
落とし、`KifuReadErrorDialog` がモーダルで出す（**数少ない画面に出る失敗**）。
→ [file-tree.md](file-tree.md) の E11 / S5。E16 はその先、パースできた JKF から
`JKFPlayer` を組めなかった場合だけを指す。

## 表

`—` はそのイベントがその状態で起きないか、状態が変わらないもの。
`無視` は早期 return（`if (!state.jkf) return` / `if (!plannedCursor) return`）で抜けること。

| イベント                   | G0 未ロード    | G1 先の予定なし                                                      | G2 先の計画あり                                                                         | テスト |
| -------------------------- | -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| **E1** `loadGame`          | → G1           | → G1（前の計画は消える）                                             | → G1（同左）                                                                            | ✗      |
| **E2** `resetGame`         | —              | → G0                                                                 | → G0                                                                                    | ✗      |
| **E3** `nextMove`          | 無視           | いま辿っている線を1手進む                                            | `te = tesuu+1` の計画があればそこへ降りる。**線の末尾に計画が残っていると throw**※1     | ✗      |
| **E4** `previousMove`      | 無視           | 1手戻る。**戻る前の `tesuu` に fork ポインタがあるときだけ G2 へ**   | 1手戻る。G2 のまま                                                                      | ✗      |
| **E5** `goToStart`         | 無視           | te 0 へ。**`cursor.forkPointers` が空でなければ G2 へ**              | te 0 へ。G2 のまま                                                                      | ✗      |
| **E6** `goToEnd`           | 無視           | いま辿っている線の葉まで                                             | 計画に沿って降りた葉 → G1。**末尾より先に計画が残っていると throw して1手も動かない**※1 | ✗      |
| **E7** `goToIndex(n)`      | 無視           | `n` までいま辿っている線を進む                                       | `te <= n` の計画に沿って降りる。`n < tesuu` なら G2 のまま                              | ✗      |
| **E8** `applyCursor(c)`    | 無視           | `c` の局面へ。`c` が `te > c.tesuu` を持てば → G2                    | `c.forkPointers` と旧計画の `te > c.tesuu` を**両方**残す                               | ✗      |
| **E9** 「本譜」            | 無視           | `te` に選択があれば `applyCursor` で落とす。無ければ `goToIndex(te)` | 同じ規則。計画に選択があるので `applyCursor` へ行き、本譜へ戻る※2                       | ✓      |
| **E10** 「変化 k」         | 無視           | 選択済みを再度なら `goToIndex(te)`、別のものなら `applyCursor`       | 同じ規則※2                                                                              | ✓      |
| **E11** `makeMove`         | 無視           | 手を足して1手進む                                                    | **先の計画が消える** → #226                                                             | ✗      |
| **E12** コメント保存       | 無視           | 局面は動かない（`forceCommit`）                                      | **先の計画が消える** → #226                                                             | ✗      |
| **E13** `swap` / `delete`  | 無視           | 棋譜が変わり、カーソルは `res.nextCursor` 由来へ                     | **先の計画が消える。** 消えて正しいのは消した枝を指す分だけ                             | ✗      |
| **E14** 保存の失敗         | —              | P2 へ。`error` に載るが**画面には出ない**                            | 同左                                                                                    | ✗      |
| **E15** ワークスペース変更 | —              | 取得が成功すれば E2 と同じ。失敗したときの窓は未検証 → #245          | 同左                                                                                    | ✗      |
| **E16** 棋譜を載せられない | 棋譜が載らない | 前の棋譜がそのまま残り、`error` だけ載る（読み手0）                  | 同左。**計画も残るので、別の棋譜の計画を持ったままになる**                              | ✗      |
| **E17** 編集の失敗         | 無視           | 棋譜も計画も変わらず `error` だけ載る（読み手0）                     | 同左                                                                                    | ✗      |

### 注

※1 throw は `forkAndForward` の入口。`getMoveFormat(tesuu + 1)` が無いと
`「N手目に有効な棋譜がありません」` を投げる。「te=12 の変化を計画 → その枝を
`deleteBranch` で消す → `goToEnd`」で踏める。`navigate` の `catch` が `set_error` に
落とすが読み手が0なので、**盤が1手も動かず画面には何も出ない**。

※2 振り分けるのは `resolveForkSelection`。比較先は行のチェックを描いたのと
同じ `PlannedCursor` で、`KifuCursor` は型で弾く。

## ディスクを組で見る

`G × P` の組で見ないと分からないセルがあるので、行を組にする。

| 状態  | E1 `loadGame`（同じファイル）                              | E2 棋譜を閉じる                          | E11 / E12 / E13 成功 | E14 失敗  |
| ----- | ---------------------------------------------------------- | ---------------------------------------- | -------------------- | --------- |
| G1/P1 | ディスクの内容で置き換わる                                 | 捨てて正しい                             | P1 のまま            | → G1/P2   |
| G2/P1 | 先の計画が消える → G1/P1                                   | 捨てて正しい                             | P1 のまま            | → G2/P2   |
| G1/P2 | **未保存の編集がディスクの内容で上書きされ、黙って消える** | **未保存の編集が保存されずに捨てられる** | → P1 へ復帰          | P2 のまま |
| G2/P2 | **未保存の編集と先の計画の両方が消える**                   | 同上。先の計画も一緒に消える             | → P1 へ復帰          | P2 のまま |

E2 は `GameFileTreeBridge.tsx:11-15` が `activeKifuPath` / `jkfData` / `kifuFormat` の
どれかを失った瞬間に `resetGame()` を呼ぶ経路。`reset_state` は保存を挟まない。

E15（ワークスペース変更）で `activeKifuPath` が落ちるのは、新しいツリーの取得が成功し、
その中に旧パスが見つからなかったときだけ（`file-tree/model/provider.tsx:134-140`）。
**取得に失敗すると `kifu_closed` が来ないので、`activeKifuPath` も `persistence` も
旧ワークスペースを指したまま残る。** その状態で編集すると、新しいワークスペースを
開いているつもりで旧ワークスペースのファイルに書き込む。→ #245

P2 は state の中に印が無い。`error` は7箇所で消える（`clear_error` を撃つ
`provider.tsx:164` / `207` / `243` / `343` / `380` / `609` と、明示的な `clearError`
`:563`）ので、**「保存に失敗したまま操作を続けている」状態を後から判定する手段が無い。**

そもそも `state.error` には**読み手が0**で、上の表の「`error` に載る」は state に載るだけで
画面には出ない。発火元の数と読み手の数を数えているのは
[failure-surfacing.md](failure-surfacing.md) の F-12 なので、そちらを見る。

分岐メニューの失敗もここに落ちる。壊れた計画が残っていると `applyCursor` の中で
`goto` が `TypeError` を投げ、`catch` が `set_error` に落として終わる。
`closeForkMenu` を先に呼んでいるので選択画面も残らず、**メニューが閉じるだけで
盤もチェックも動かない**。復帰の導線は無い。

## 書き込み — 7経路のうち3経路が先の計画を捨てる

| #   | イベント      | 実装                                | `branchPlan` の決め方                              | G2 で呼ぶと                    |
| --- | ------------- | ----------------------------------- | -------------------------------------------------- | ------------------------------ |
| W0  | E2            | `reducer.ts:64` → `reset_state`     | `initialGameState` の `[]`                         | 棋譜ごと捨てるので自明に正しい |
| W1  | E1            | `provider.tsx:250` → `game_loaded`  | `[...cursor.forkPointers]`（reducer 側）           | 棋譜が変わるので捨てて正しい   |
| W2  | E3〜E7        | `provider.tsx:182` → `navigated`    | `mergeBranchPlan(next, plan)`                      | 先の計画が**残る**             |
| W3  | E8〜E10       | `provider.tsx:615` → `navigated`    | `mergeBranchPlan(next, plan, cursor.forkPointers)` | 先の計画が**残る**             |
| W4  | E11 / E12     | `provider.tsx:221` → `jkf_replaced` | `[...nextCursor.forkPointers]`                     | 先の計画が**消える** → #226    |
| W5  | E13（swap）   | `provider.tsx:354` → `jkf_replaced` | 同上                                               | 同上                           |
| W6  | E13（delete） | `provider.tsx:391` → `jkf_replaced` | 同上                                               | 同上                           |

W4〜W6 は `te > tesuu` の計画を無条件に捨てる。**コメントを1つ保存するだけで、
見ていた変化の予定が消えて手数表示が本譜の長さに戻る**（#226）。
W5 / W6 は棋譜が変わって枝が実在しなくなることがあるが、それは「捨てる」ではなく
「作り直す」で扱うべき区別で、今は両方まとめて捨てている。

W3 の第3引数 `overridePlan` に `te > tesuu` を渡しうるのは、3つの呼び出し側のうち
`PositionNavigationModal` だけ。← で戻ると `tesuu` だけ減って `forkPointers` は残る
（`PositionNavigationModal.tsx:144-149`）。`KifuStreamList` は
`buildCursorWithForkSelection` が `normalizeForkPointers(picked, te)` で落とすので常に空。
`usePositionHitNavigation` の `cursorFromLite` は正規化しないが、供給元の
`src-tauri/src/search/index_builder.rs` が `fork_path` に `te <= tesuu` しか積まないので
（`walk_sequence` / `push_node`）構造的に保証されている。破れるのはインデックスが
壊れている場合だけ。

## 読み手 — 6箇所。捨てるのは2箇所だけ

| #   | 読み手                                                   | 何に使うか                               | 壊れた `forkIndex` を                                       |
| --- | -------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| R1  | `provider.tsx:76` → `computeLeafTesuu`                   | `view.totalMoves`                        | **捨てる** ✓                                                |
| R2  | `provider.tsx:269` `goToIndex` → `goto`                  | `goto` の第2引数（`te <= index` に絞る） | 捨てない。`goto` は `forkAndForward` の返り値も見ない       |
| R3  | `provider.tsx:278` `nextMove` → `forkAndForward`         | 次の1手で降りる変化                      | 捨てない。範囲外は `false` だが**負・非整数は `TypeError`** |
| R4  | `provider.tsx:304` `goToEnd` → `forkAndForward`          | 末尾まで降り続ける経路                   | 同上。加えて**線の末尾+1 に計画が残ると throw**             |
| R5  | `KifuStreamList.tsx:48` → `buildStreamRowsFromCursor`    | 行の並び・チェック・分岐メニューの表示   | **捨てる** ✓                                                |
| R6  | `KifuStreamList.tsx:48` → `buildCursorWithForkSelection` | 分岐メニューの選択・コメントの書き込み先 | 捨てない。`applyCursor` → `goto` まで届く                   |

捨てているのは R1（`computeLeafTesuu`）と R5（`buildStreamRowsFromCursor`）の2箇所だけで、
これは [branch-index.md](branch-index.md) の不変条件1が挙げている2箇所と一致する。
**同じ規則が何箇所に手書きで散っているかは `branch-index.md` が数える。**
この表が数えるのは `branchPlan` の読み手であって、手書きの走査の数ではない。→ #213

## この表が満たすべき不変条件

1. **`te <= cursor.tesuu` の範囲で `branchPlan` と `cursor.forkPointers` は一致する。**
   `mergeBranchPlan` はその範囲を `cursor.forkPointers` からしか取らず（`prevPlan` と
   `overridePlan` は `fp.te > cursor.tesuu` で絞る）、`jkf_replaced` / `game_loaded` は
   `cursor.forkPointers` をそのまま写し、`reset_state` は両方空にする。
   7つの書き込み経路すべてがこれを守っている。
   **破れると「盤に出ている局面」と「行のチェック」が同じ手数で食い違う。**

2. **画面が「選ばれている」と描いた値と、押したときに比較する値は、同じ出どころでなければならない。**
   行のチェックは `branchPlan`（`buildStreamRows.ts:49`）から出るので、
   一致判定も `branchPlan` から引く（`resolveForkSelection`）。
   `cursor.forkPointers` と比べても**不変条件1により G1 では一致してしまう**ので、
   取り違えは G2 でしか表に出ない。テストを G1 だけで書くと素通りする。

3. **カーソルより先の計画を捨ててよいのは、棋譜が変わってその枝が実在しなくなったときだけ。**
   コメントの保存も駒を1つ動かすのも「棋譜が変わった」に含めているので、
   関係の無い先の計画まで巻き添えで消える（#226）。

4. **計画は無検証で持ち越される。** `branchPlan` に入る `forkIndex` を誰も検査しない。
   読み手6箇所のうち自分で捨てるのは R1 と R5 だけで、**R2 / R3 / R4 / R6 は捨てない**。
   値の分類は [branch-index.md](branch-index.md)、寄せ先の議論は #213。

## 埋まっていないセル

| セル                                                   | 状態                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameProvider` 自体の遷移すべて                        | **テスト無し。** `provider.tsx` にテストが1本も無い。上の表で ✗ を付けたものは全部これ                                                                                                             |
| **E9** / E10 分岐メニュー                              | ✓ `cursorSelection.test.ts`。ただし `resolveForkSelection` の**振り分けまで**。`applyCursor` / `goToIndex` を通した結果は未検証                                                                    |
| **E15** でツリーの取得が失敗したとき                   | **未検証 → #245。** `kifu_closed` が来ないので旧ワークスペースの `activeKifuPath` と `persistence` が残る。読み込み中の窓も見ていない                                                              |
| `(G2, P2)` で `loadGame`                               | **テスト無し。** 未保存の編集と先の計画が同時に消える。手で再現していない                                                                                                                          |
| `(G1/P2, E2)` 保存に失敗したまま棋譜を閉じる           | **テスト無し。** 編集が永久に消える。`resetGame` は保存を挟まないので復帰の手段が無い                                                                                                              |
| 線を乗り換えたとき、深い計画をどうするか               | **判断が決まっていない。** `buildCursorWithForkSelection` は `te` 以降を落とすが `mergeBranchPlan` が復活させる。乗り換え先に無い変化を指したまま残り、`computeLeafTesuu` が見たことのない葉を返す |
| R3 / R4 に壊れた `forkIndex` を渡す                    | **テスト無し。** R1 は `leafTesuu.test.ts`、R5 は `buildStreamRows.test.ts` が固定している。捨てない4箇所は誰も固定していない                                                                      |
| `PositionNavigationModal` の ← で作った `overridePlan` | **テスト無し。** `te > tesuu` を持つカーソルを `applyCursor` に渡す唯一の経路                                                                                                                      |
| 行の `branchForkPointers` が計画から作られる           | **テスト無し。** 削除・入れ替えのクエリが「辿っていない枝」を指しうる → #196                                                                                                                       |

## 実装との対応

- 状態と action: `src/entities/game/model/types.ts`、`src/entities/game/model/reducer.ts`
- 書き込み7経路: `src/entities/game/model/provider.tsx`
- 計画の合成: `src/entities/game/lib/cursor.ts` の `mergeBranchPlan`
- 2つの型: `src/entities/kifu/model/cursor.ts` の `KifuCursor` / `PlannedCursor`
- 行と分岐メニュー: `src/widgets/kifu-stream/`
- テスト: `src/entities/game/model/__tests__/reducer.test.ts`（identity のみ）、
  `src/widgets/kifu-stream/lib/__tests__/cursorSelection.test.ts`、
  `src/widgets/kifu-stream/lib/__tests__/buildStreamRows.test.ts`、
  `src/entities/kifu/lib/__tests__/leafTesuu.test.ts`
