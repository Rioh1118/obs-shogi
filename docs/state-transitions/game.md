# 状態遷移表: game（L1）

対象: `src/entities/game/model/provider.tsx` と `reducer.ts`、`src/entities/game/lib/cursor.ts`、
および分岐メニューを持つ `src/widgets/kifu-stream/`。

上位は [app.md](app.md)。分岐を指す値の分類は [branch-index.md](branch-index.md)、
失敗がどこへ出るかは [failure-surfacing.md](failure-surfacing.md) が持つ。

「**いま居る局面**」と「**これから降りるつもりの変化**」を別々の値で持っている。
2つは `tesuu` と `ForkPointer[]` の組で構造が同じなので、`BranchPlan` と `PlannedCursor` の
brand で型として分けてある（`entities/kifu/model/cursor.ts`）。印を付けられるのは
`asBranchPlan` と `plannedCursorFrom` だけで、`cursor.forkPointers` を計画として渡すと
tsc が落ちる。同じ取り違えから #226 と #196 が出ている。

イベントを列でなく行に置いてあるのは、この表はイベントが状態より一桁多く、
列に並べると1行が読めない幅になるため。他の表（`app.md` / `engine.md`）とは向きが違う。

## 2つの値

|                             | 意味                                                                       | `te` の範囲                                    | 型                                                                             |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `state.cursor.forkPointers` | **辿った**変化。いま盤に出ている局面をここまで再生するのに使った選択       | `te <= cursor.tesuu` に必ず正規化される        | `KifuCursor`。`cursorFromSource` が作る                                        |
| `state.branchPlan`          | **計画した**変化。辿った分に加え、カーソルより先で降りるつもりの選択も持つ | 上限なし。**線の末尾より先の `te` も残りうる** | `BranchPlan`。`mergeBranchPlan` が作り、`PlannedCursor` に載せて widget へ渡す |

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

編集系は**メモリを先に更新してから保存し、保存が失敗したら戻す**
（ADR-0004 決定7 の楽観的更新）。

| 記号   | 状態                           | 判定                                                                   |
| ------ | ------------------------------ | ---------------------------------------------------------------------- |
| **P0** | 保存先が無い                   | `persistence === undefined`（`activeKifuPath` か `kifuFormat` を欠く） |
| **P1** | メモリとディスクが一致         | 最後の `save` が成功、または失敗して `jkf_restored` が通った           |
| **P2** | **メモリとディスクが食い違う** | `save` が失敗し、かつ `jkf_restored` が**通らなかった**                |

`persistIfPossible` は2つ門番を持つ。`persistence` が無ければ書かない（P0）。
`persistence.absPath !== state.loadedAbsPath` なら書かない
（**開いている棋譜と宛先が食い違う**間に書くと、前の棋譜が新しいファイルへ入る）。
`persistence` を作るのは `GamePersistenceGate` で、`activeKifuPath` と `kifuFormat` の
両方が揃ったときだけ。**そして `GameFileTreeBridge` は3つ揃いでしか `loadGame` しない**ので、
棋譜が載った状態で P0 になる経路は現状の配線には無い。

**P2 は「失敗したら必ず起きる」ではなく、巻き戻しが飛んだときだけ起きる。**
`jkf_restored` は `state.jkf !== expectedJkf` なら何もしない（待っている間に別の
編集や読み込みが入っていたら、巻き戻しがそれを消してしまうため）。
飛んだかどうかは**呼び出し元に返らない** → #301

## イベント

| 記号    | イベント                        | 発生源                                                                                                      |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **E1**  | `loadGame`                      | `GameFileTreeBridge`（ツリーで棋譜を開く）                                                                  |
| **E2**  | `resetGame`                     | 棋譜を閉じる                                                                                                |
| **E3**  | `nextMove`                      | → キー / `GameControls`                                                                                     |
| **E4**  | `previousMove`                  | ← キー / `GameControls`                                                                                     |
| **E5**  | `goToStart`                     | `GameControls`                                                                                              |
| **E6**  | `goToEnd`                       | `GameControls`                                                                                              |
| **E7**  | `goToIndex(n)`                  | 棋譜ストリームの行クリック                                                                                  |
| **E8**  | `applyCursor(c)`                | 局面ナビ / 検索ヒット / 分岐メニュー                                                                        |
| **E9**  | 分岐メニューで「本譜」          | `KifuForkMenu`                                                                                              |
| **E10** | 分岐メニューで「変化 k」        | `KifuForkMenu`                                                                                              |
| **E11** | `makeMove`                      | 盤のクリック                                                                                                |
| **E12** | `setCommentsByCursor`           | コメント欄                                                                                                  |
| **E13** | `swapBranches` / `deleteBranch` | 行メニュー                                                                                                  |
| **E14** | 保存の失敗                      | `persistence.save`（Rust の書き込み）                                                                       |
| **E15** | ワークスペース変更              | `GameFileTreeBridge` / `GamePersistenceGate`                                                                |
| **E16** | 棋譜を載せられない              | パース済み JKF の複製・`JKFPlayer` 構築の失敗（`loadGame` の `catch`）                                      |
| **E17** | 編集の失敗                      | `applyMoveWithBranch` / `assertBranchIndex` の throw（`edit` / `swapBranches` / `deleteBranch` の `catch`） |

`selectSquare` / `selectHand` の失敗は `selectedPosition` の話で、
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

| イベント                   | G0 未ロード    | G1 先の予定なし                                                                                                                                                                                                        | G2 先の計画あり                                                                         | テスト |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| **E1** `loadGame`          | → G1           | → G1（前の計画は消える）                                                                                                                                                                                               | → G1（同左）                                                                            | ✗      |
| **E2** `resetGame`         | —              | → G0                                                                                                                                                                                                                   | → G0                                                                                    | ✗      |
| **E3** `nextMove`          | 無視           | いま辿っている線を1手進む                                                                                                                                                                                              | `te = tesuu+1` の計画があればそこへ降りる。**線の末尾に計画が残っていると throw**※1     | ✗      |
| **E4** `previousMove`      | 無視           | 1手戻る。**戻る前の `tesuu` に fork ポインタがあるときだけ G2 へ**                                                                                                                                                     | 1手戻る。G2 のまま                                                                      | ✗      |
| **E5** `goToStart`         | 無視           | te 0 へ。**`cursor.forkPointers` が空でなければ G2 へ**                                                                                                                                                                | te 0 へ。G2 のまま                                                                      | ✗      |
| **E6** `goToEnd`           | 無視           | いま辿っている線の葉まで                                                                                                                                                                                               | 計画に沿って降りた葉 → G1。**末尾より先に計画が残っていると throw して1手も動かない**※1 | ✗      |
| **E7** `goToIndex(n)`      | 無視           | `n` までいま辿っている線を進む                                                                                                                                                                                         | `te <= n` の計画に沿って降りる。`n < tesuu` なら G2 のまま                              | ✗      |
| **E8** `applyCursor(c)`    | 無視           | `c` の局面へ。`c` が `te > c.tesuu` を持てば → G2                                                                                                                                                                      | `c.forkPointers` と旧計画の `te > c.tesuu` を**両方**残す                               | ✗      |
| **E9** 「本譜」            | 無視           | `te` に選択があれば `applyCursor` で落とす。無ければ `goToIndex(te)`                                                                                                                                                   | 同じ規則。計画に選択があるので `applyCursor` へ行き、本譜へ戻る※2                       | ✓      |
| **E10** 「変化 k」         | 無視           | 選択済みを再度なら `goToIndex(te)`、別のものなら `applyCursor`                                                                                                                                                         | 同じ規則※2                                                                              | ✓      |
| **E11** `makeMove`         | 無視           | 手を足して1手進む                                                                                                                                                                                                      | **先の計画が消える** → #226                                                             | ✗      |
| **E12** コメント保存       | 無視           | 局面は動かない（`forceCommit`）。開いた棋譜と違えば書かない※6                                                                                                                                                          | **先の計画が消える** → #226                                                             | ✓      |
| **E13** `swap` / `delete`  | 無視           | 棋譜が変わり、カーソルは `res.nextCursor` 由来へ                                                                                                                                                                       | **先の計画が消える。** 消えて正しいのは消した枝を指す分だけ                             | ✗      |
| **E14** 保存の失敗         | —              | `jkf_restored` が編集前へ戻すので **P1 のまま**。戻せなかったときだけ P2（→ #301）。`error` は棋譜が別物になっていたら積まれない（`write_failed`）。**戻り値では必ず返る**。画面に出るのはコメントの保存と分岐の削除※5 | 同左                                                                                    | ✗      |
| **E15** ワークスペース変更 | —              | 棋譜が新しい根の外なら E2 と同じ。取得の成否は見ない※4                                                                                                                                                                 | 同左                                                                                    | ✓      |
| **E16** 棋譜を載せられない | 棋譜が載らない | 前の棋譜がそのまま残り、`error` だけ載る（読み手0）※3                                                                                                                                                                  | 同左。**計画も残るので、別の棋譜の計画を持ったままになる**                              | ✗      |
| **E17** 編集の失敗         | 無視           | 棋譜も計画も変わらず `error` だけ載る（読み手0）                                                                                                                                                                       | 同左                                                                                    | ✗      |

### 注

※1 throw は `forkAndForward` の入口。`getMoveFormat(tesuu + 1)` が無いと
`「N手目に有効な棋譜がありません」` を投げる。**線の末尾より先に計画が残っていれば
踏める。** 例: te=10 の分岐を選ぶ → te=5 へ戻る（`te > 5` の計画が残る）→ te=3 で
全長9手の変化へ乗り換える → `goToEnd` が tesuu=9 まで降り、`nextTe=10` が計画に
当たって `getMoveFormat(10)` を掴めずに落ちる。`navigate` の `catch` が `set_error` に
落とすが読み手が0なので、**盤が1手も動かず画面には何も出ない**。

`deleteBranch` で枝を消す手順では踏めない。W6 が `te > tesuu` の計画ごと捨てるので、
throw の前提が消える。

※2 振り分けるのは `resolveForkSelection`。比較先は `PlannedCursor` で、
`KifuCursor` は型で弾く。行のチェックとの食い違いは不変条件2 を見る。

※3 **盤には前の棋譜が出たままなのに、保存先だけが新しいファイルになっている。**
`kifu_opened` は `activeKifuPath` を先に更新し、`GamePersistenceGate` はそれを見て
`persistence` を組み直す。`loadGame` が落ちても `state.jkf` は前の棋譜のまま。
この後に1手指すかコメントを1つ保存すると、**門番が止める**
（`persistence.absPath !== state.loadedAbsPath` なので `Err` を返す）。
前の棋譜が新しいファイルへ入ることは無いが、**保存だけが黙って落ちる状態**が残る
（`error` の読み手が0 → #277）。盤には前の棋譜が出たまま。

※4 **開いている棋譜は、いまのワークスペースの中にある。** `FileTreeProvider` が
`rootDir` と `activeKifuPath` を突き合わせ、外に出た時点で `kifu_closed` を撃つ
（`isSameOrDescendantPath`）。ツリーの成否は見ない。取得が失敗しても
「新しい根の外にある」は変わらないため。新しい根が前の根の親なら棋譜は内側に残るので、
そのときは開いたままでよい。

ツリーの取得が成功したときにしか閉じない形だと、取得の失敗で `activeKifuPath` も
`persistence` も旧ワークスペースを指したまま残り、新しいワークスペースを開いている
つもりで旧ワークスペースのファイルに書き込んでいた。

※5 棋譜を書き換える操作は `AsyncResult` を返す。**`state.error` に積んだうえで
呼び出し側にも返す**（積むだけでは届かない。読み手が0）。読んでいるのは2つ。

- `KifuCommentNote`：失敗したら `baseText` を進めずノートの中に出す。
  進めてしまうと `dirty` が落ちて autosave も閉じるときの保存も走らず、
  **画面には「保存済み」だけが出て本文が消える**。
  **楽観的更新の写しを `baseText` に入れないこと。** 走っている保存の最中に面を
  組み直すと、まだディスクに無い本文が入って同じ失われ方をする
- `KifuStreamList` の `confirmDelete`：確認ダイアログの中に出す。
  **失敗したあとは実行ボタンを押せなくする**（押した時点の指定を撃ち直すので、
  失敗の間にメモリ側の棋譜が変わっていると別のものを指す）

盤で1手指したときと分岐の入れ替えの失敗は依然としてどこにも出ない
（`async-result-ignored` の印）。
→ [failure-surfacing.md](failure-surfacing.md) の F-12a。出口を作るのは #277

**書き込みは直列化していない。** Rust 側の `write_kifu_to_file` は並行に走るので、
同じファイルへ2本重なると**後に着地したほうが勝つ**（コメントの自動保存が分岐の削除を
ディスク上で取り消す）。`main` から在る形で、**この表の範囲では直していない** → #309

**✓※4 が固定しているのは file-tree の側だけ。** `workspaceGuard.test.tsx` は
`activeKifuPath` が落ちることまでを見る。そこから `resetGame` へ渡る橋渡し
（`GameFileTreeBridge`）と、G2 で計画も消えることは**未検証**。

※6 コメントの保存は、**ノートを開いた時点の棋譜と `state.loadedAbsPath` が同じときだけ**書く。
`setCommentsByCursor` は現在の `state.jkf` を複製して当てるので、棋譜が差し替わったあとに
autosave が撃つと、前のファイルの本文が**次のファイルの同じ手数へ**入る。
`KifuStreamList` が棋譜の変化で開いている面を閉じ、`editorKey` に棋譜の識別子を混ぜて
Lexical を作り直すが、**エディタを作り直す前に autosave が撃つ競合が残る**ので
この突き合わせが要る。→ #204

**✓※6 が固定しているのはこの突き合わせだけ。** `KifuCommentNote.test.tsx` は
`entities/game` を丸ごとモックしているので、`forceCommit` で局面が動かないことも
G2 で計画が消えること（#226）も**見ていない**。

## ディスクを組で見る

`G × P` の組で見ないと分からないセルがあるので、行を組にする。

| 状態  | E1 `loadGame`（同じファイル）                              | E2 棋譜を閉じる                          | E11 / E12 / E13 成功 | E14 失敗                                     |
| ----- | ---------------------------------------------------------- | ---------------------------------------- | -------------------- | -------------------------------------------- |
| G1/P1 | ディスクの内容で置き換わる                                 | 捨てて正しい                             | P1 のまま            | 巻き戻しが通れば P1 のまま。飛んだら → G1/P2 |
| G2/P1 | 先の計画が消える → G1/P1                                   | 捨てて正しい                             | P1 のまま            | 同上（飛んだら → G2/P2）                     |
| G1/P2 | **未保存の編集がディスクの内容で上書きされ、黙って消える** | **未保存の編集が保存されずに捨てられる** | → P1 へ復帰          | P2 のまま                                    |
| G2/P2 | **未保存の編集と先の計画の両方が消える**                   | 同上。先の計画も一緒に消える             | → P1 へ復帰          | P2 のまま                                    |

E14 で巻き戻しが飛ぶのは、**待っている間に別の編集や読み込みが入ったとき**だけ
（`expectedJkf` の突き合わせ）。並行する書き込みが実在するので絵空事ではない
（コメントの自動保存は 900ms 後に、開いている面や確認ダイアログとは無関係に撃つ）。

E2 は `GameFileTreeBridge` が `activeKifuPath` / `jkfData` / `kifuFormat` の
どれかを失った瞬間に `resetGame()` を呼ぶ経路。`reset_state` は保存を挟まない。

E15（ワークスペース変更）の帰結は ※4。

P2 は state の中に印が無い。`error` は7箇所で消える（局面を動かすか棋譜を書き換える
操作の先頭6つ — `navigate` / `edit` / `loadGame` / `swapBranches` / `deleteBranch` /
`applyCursor` — と、公開されている `clearError`）ので、
**「保存に失敗したまま操作を続けている」状態を後から判定する手段が無い。**

そもそも `state.error` には**読み手が0**で、上の表の「`error` に載る」は state に載るだけで
画面には出ない。発火元の数と読み手の数を数えているのは
[failure-surfacing.md](failure-surfacing.md) の F-12a（保存）と F-12b（操作）なので、
そちらを見る。この段落が言っているのは保存の側で、F-12a。

分岐メニューの失敗もここに落ちる。壊れた計画が残っていると `applyCursor` の中で
`goto` が `TypeError` を投げ、`catch` が `set_error` に落として終わる。
`closeForkMenu` を先に呼んでいるので選択画面も残らず、**メニューが閉じるだけで
盤もチェックも動かない**。復帰の導線は無い。

## 書き込み — 7経路のうち3経路が先の計画を捨てる

| #      | イベント         | 実装                                     | `branchPlan` の決め方                                  | G2 で呼ぶと                                                            |
| ------ | ---------------- | ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| **W0** | E2               | `reset_state`（`reducer.ts`）            | `initialGameState` の空                                | 棋譜ごと捨てるので自明に正しい                                         |
| **W1** | E1               | `loadGame` → `game_loaded`               | `asBranchPlan([...cursor.forkPointers])`（reducer 側） | 棋譜が変わるので捨てて正しい                                           |
| **W2** | E3〜E7           | `navigate` → `navigated`                 | `mergeBranchPlan(next, plan)`                          | 先の計画が**残る**                                                     |
| **W3** | E8〜E10          | `applyCursor` → `navigated`              | `mergeBranchPlan(next, plan, cursor.forkPointers)`     | 先の計画が**残る**                                                     |
| **W4** | E11 / E12        | `edit` → `jkf_replaced`                  | `asBranchPlan([...nextCursor.forkPointers])`           | 先の計画が**消える** → #226                                            |
| **W5** | E13（swap）      | `swapBranches` → `jkf_replaced`          | 同上                                                   | 同上                                                                   |
| **W6** | E13（delete）    | `deleteBranch` → `jkf_replaced`          | 同上                                                   | 同上                                                                   |
| **W7** | E14（E11 / E13） | `jkf_restored`（`restoreCursor: true`）  | 編集の**前**の `branchPlan` へ戻す                     | 巻き戻しなので、置く前の組へ戻す                                       |
| **W8** | E14（E12）       | `jkf_restored`（`restoreCursor: false`） | **触らない**（棋譜だけ戻す）                           | 局面を動かさない書き込みで戻すと、待っている間に進めた手数まで巻き戻る |

W4〜W6 は `te > tesuu` の計画を無条件に捨てる。**コメントを1つ保存するだけで、
見ていた変化の予定が消えて手数表示が本譜の長さに戻る**（#226）。
W8 でも戻さないので、**コメントの保存は成功しても失敗しても計画を失う**。
直すなら W4 の側（`jkf_replaced` が `mergeBranchPlan` を使う）で、そこが #226。
W5 / W6 は棋譜が変わって枝が実在しなくなることがあるが、それは「捨てる」ではなく
「作り直す」で扱うべき区別で、今は両方まとめて捨てている。

W3 の第3引数 `overridePlan` に `te > tesuu` を渡しうるのは、3つの呼び出し側のうち
`PositionNavigationModal` だけ。← で戻ると `tesuu` だけ減って `forkPointers` は残る
（`PositionNavigationModal` の `handlePrevious`）。`KifuStreamList` は
`buildCursorWithForkSelection` が `normalizeForkPointers(picked, te)` で落とすので常に空。
`usePositionHitNavigation` の `cursorFromLite` は正規化しないが、供給元の
`src-tauri/src/search/index_builder.rs` が `fork_path` に `te <= tesuu` しか積まないので
（`walk_sequence` / `push_node`）構造的に保証されている。破れるのはインデックスが
壊れている場合だけ。

## 読み手 — 6箇所。捨てるのは2箇所だけ

| #      | 読み手                                           | 何に使うか                               | 壊れた `forkIndex` を                                       |
| ------ | ------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| **R1** | `cursorView` → `computeLeafTesuu`                | `view.totalMoves`                        | **捨てる** ✓                                                |
| **R2** | `goToIndex` → `goto`                             | `goto` の第2引数（`te <= index` に絞る） | 捨てない。`goto` は `forkAndForward` の返り値も見ない       |
| **R3** | `nextMove` → `forkAndForward`                    | 次の1手で降りる変化                      | 捨てない。範囲外は `false` だが**負・非整数は `TypeError`** |
| **R4** | `goToEnd` → `forkAndForward`                     | 末尾まで降り続ける経路                   | 同上。加えて**線の末尾+1 に計画が残ると throw**             |
| **R5** | `plannedCursor` → `buildStreamRowsFromCursor`    | 行の並び・チェック・分岐メニューの表示   | **捨てる** ✓                                                |
| **R6** | `plannedCursor` → `buildCursorWithForkSelection` | 分岐メニューの選択・コメントの書き込み先 | 捨てない。`applyCursor` → `goto` まで届く                   |

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

2. **画面が「選ばれている」と描いた値と、押したときに比較する値は、食い違っても
   押せる選択肢の中では一致していなければならない。**
   一致判定は `branchPlan` から引く（`resolveForkSelection`）。行のチェックは
   `buildStreamRowsFromCursor` が**実際に降りた**分岐から出るので、計画が `forks` の
   範囲外だったときだけ2つは食い違う。その値はメニューの選択肢に無い（選択肢も同じ
   `forks` から作られる）ので、どの項目を押しても `applyCursor` に落ちる。
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
| `GameProvider` 自体の遷移すべて                        | ✓ `persistGuard.test.tsx`（保存先の門番・巻き戻し・コメントが行を止めないこと）。**それ以外は未検証で、上の表で ✗ を付けたものは全部これ**                                                         |
| **E9** / **E10** 分岐メニュー                          | ✓ `cursorSelection.test.ts`。ただし `resolveForkSelection` の**振り分けまで**。`applyCursor` / `goToIndex` を通した結果は未検証                                                                    |
| **E15** でツリーの取得が失敗したとき                   | ✓ `workspaceGuard.test.tsx`（根の外に出た棋譜を閉じる）。**読み込み中の窓は未検証** — 取得の途中に編集が走った場合の順序は決めていない                                                             |
| `(G2, P2)` で `loadGame`                               | **テスト無し。** 未保存の編集と先の計画が同時に消える。手で再現していない                                                                                                                          |
| E16 のあとで編集する                                   | ✓ `persistGuard.test.tsx`「宛先が別のファイルを指している間は書かない」。門番が止めることは固定した（※3）                                                                                          |
| `(G1/P2, E2)` 保存に失敗したまま棋譜を閉じる           | **テスト無し。** 巻き戻しが通れば消える編集そのものが無い。飛んだときだけ永久に消える（`resetGame` は保存を挟まない）。**書きかけのコメントは失われる**（→ #314）                                  |
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
