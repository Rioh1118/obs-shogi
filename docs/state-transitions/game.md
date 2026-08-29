# game — カーソルと分岐計画

L1。棋譜の読み込み・移動・編集を持つ `GameProvider` の状態機械。

「**いま居る局面**」と「**これから降りるつもりの変化**」を別々の値で持っている。
型はどちらも `ForkPointer[]` なので、取り違えても型では止まらない。
既に3件の不具合が同じ取り違えから出ている（#225 / #226 / #196）。
どれも「片方だけ直す」で消える形をしていないので、値の対応を先に表にする。

盤の再生そのもの（`goto` が届かない、`forkIndex` が壊れている）は
[branch-index.md](branch-index.md) 側の話。ここでは**2つの値がどう食い違うか**だけを扱う。

## 2つの値

|                             | 意味                                                                       | `te` の範囲                                    | 作る場所                                                         |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `state.cursor.forkPointers` | **辿った**変化。いま盤に出ている局面をここまで再生するのに使った選択       | `te <= cursor.tesuu` に必ず正規化される        | `cursorFromSource`（`normalizeForkPointers(fps, tesuu)` を通す） |
| `state.branchPlan`          | **計画した**変化。辿った分に加え、カーソルより先で降りるつもりの選択も持つ | 上限なし。**線の末尾より先の `te` も残りうる** | `mergeBranchPlan` または `[...cursor.forkPointers]`              |

**`te <= cursor.tesuu` の範囲では2つは必ず同じ内容になる**（不変条件1）。
食い違うのは `te > cursor.tesuu` の部分だけ。だから取り違えは
「カーソルより**先**の行を操作したとき」にしか表に出ない。手元で一度触った程度では踏まない。

## 状態

`tesuu` は `state.cursor?.tesuu ?? 0` の略。

| 記号 | 判定条件                                                  | 意味                                                                |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| G0   | `jkf === null`                                            | 未ロード。`cursor === null`、`branchPlan` は `[]`                   |
| G1   | `jkf !== null && !branchPlan.some((fp) => fp.te > tesuu)` | 計画がカーソルに追いついている。2つの値は同じ内容                   |
| G2   | `jkf !== null && branchPlan.some((fp) => fp.te > tesuu)`  | **カーソルより先の計画を持つ。** 画面では先の行にチェックが出ている |

**G2 はユーザーの1操作では作れない。** 入る経路は「先の `te` で変化を選ぶ → 戻る」だけで、

1. 先の分岐を選ぶ（`applyCursor` → `branchPlan = [{te: 10, forkIndex: 0}]`）
2. 戻る（`previousMove` / `goToIndex`）。`cursor.forkPointers` からは `te > 5` が落ちるが、
   `mergeBranchPlan` が `prevPlan.filter((fp) => fp.te > cursor.tesuu)` で計画側には残す

の2手が要る。**2手目を踏まずに実装を確認すると、G2 の列は全部素通りする。**
`te > 線の末尾` の計画が残る場合も G2 に含む（`computeLeafTesuu` はそれを捨てて本譜へ落とす）。

`isLoading` / `error` / ディスク上の棋譜は G0〜G2 と直交する。下の「ディスクを列に入れる」を見る。

## 書き込み — 6経路のうち3経路が先の計画を捨てる

| #   | イベント                                                            | 実装                                | `branchPlan` の決め方                              | G2 で呼ぶと                    |
| --- | ------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------- | ------------------------------ |
| W1  | `loadGame`                                                          | `provider.tsx:250` → `game_loaded`  | `[...cursor.forkPointers]`（reducer 側）           | — 棋譜が変わるので捨てて正しい |
| W2  | `goToIndex` / `nextMove` / `previousMove` / `goToStart` / `goToEnd` | `provider.tsx:182` → `navigated`    | `mergeBranchPlan(next, plan)`                      | 先の計画が**残る**             |
| W3  | `applyCursor`                                                       | `provider.tsx:615` → `navigated`    | `mergeBranchPlan(next, plan, cursor.forkPointers)` | 先の計画が**残る**             |
| W4  | `makeMove` / `setCommentsByCursor`（`edit`）                        | `provider.tsx:221` → `jkf_replaced` | `[...nextCursor.forkPointers]`                     | 先の計画が**消える** → #226    |
| W5  | `swapBranches`                                                      | `provider.tsx:354` → `jkf_replaced` | 同上                                               | 同上                           |
| W6  | `deleteBranch`                                                      | `provider.tsx:391` → `jkf_replaced` | 同上                                               | 同上                           |

W4〜W6 が捨てるのは判断の結果ではなく、`edit` を書いた時点で `branchPlan` がまだ無かった名残。
**コメントを1つ保存するだけで、見ていた変化の予定が消えて手数表示が本譜の長さに戻る**（#226）。
W5 / W6 は棋譜そのものが変わるので `te > tesuu` の計画が実在しなくなることはあるが、
それは「捨てる」ではなく「作り直す」で扱うべき区別。今は両方まとめて捨てている。

W3 の第3引数 `overridePlan` に `te > tesuu` を渡しうるのは、3つの呼び出し側のうち
`PositionNavigationModal` だけ。← で戻ると `tesuu` だけ減って `forkPointers` は残る
（`PositionNavigationModal.tsx:144-149`）。
`KifuStreamList` は `buildCursorWithForkSelection` が `normalizeForkPointers(picked, te)` で
落とすので常に空。`usePositionHitNavigation` の `cursorFromLite` は**正規化しない**ので
Rust 側が返す値次第（下の「埋まっていないセル」）。

## 読み手 — 5箇所

| #   | 読み手                                  | 何に使うか                                | 計画が壊れていたら                         |
| --- | --------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| R1  | `provider.tsx:76` → `computeLeafTesuu`  | `view.totalMoves`（計画に沿った終端手数） | 捨てて本譜へ落ちる ✓                       |
| R2  | `provider.tsx:269` `goToIndex`          | `goto` の第2引数（`te <= index` に絞る）  | **捨てていない。** `goto` は返り値も見ない |
| R3  | `provider.tsx:278` `nextMove`           | 次の1手で降りる変化                       | `forkAndForward` が `false` なら本譜 ✓     |
| R4  | `provider.tsx:304` `goToEnd`            | 末尾まで降り続ける経路                    | 同上 ✓                                     |
| R5  | `KifuStreamList.tsx:48` `plannedCursor` | 行の並び・チェック・分岐メニュー          | 捨てて本譜へ落ちる ✓                       |

**同じ「計画に沿って1手進める」規則が R1〜R5 に手書きで5回ある。** → #213

## 状態 × イベント

| イベント（発生源）                                 | G0 未ロード | G1 計画なし                                                                              | G2 先の計画あり                                                            | テスト |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| `loadGame`（ファイル選択 / 検索ヒット）            | → G1        | → G1（前の計画は消える）                                                                 | → G1（同左）                                                               | ✗      |
| `resetGame`（棋譜を閉じる）                        | —           | → G0                                                                                     | → G0                                                                       | ✗      |
| `nextMove`（→ キー）                               | —           | 本譜を1手進む                                                                            | `te = tesuu+1` の計画があればそこへ降りる。G1 へ近づく                     | ✗      |
| `previousMove`（← キー）                           | —           | 1手戻る。**G2 へ移る**（辿った分が計画に残る）                                           | 1手戻る。G2 のまま                                                         | ✗      |
| `goToIndex(n)`（行クリック）                       | —           | `n` まで本譜を進む                                                                       | `te <= n` の計画に沿って降りる。`n < tesuu` なら G2 のまま                 | ✗      |
| `goToStart`                                        | —           | te 0 へ。**G2 へ移る**                                                                   | te 0 へ。G2 のまま                                                         | ✗      |
| `goToEnd`                                          | —           | 本譜の末尾                                                                               | 計画に沿って降りた葉。→ G1                                                 | ✗      |
| `applyCursor(c)`（分岐メニュー / 局面ナビ / 検索） | 無視        | `c` の局面へ。`c` が先の計画を持てば → G2                                                | `c.forkPointers` と旧計画の `te > c.tesuu` を**両方**残す                  | ✗      |
| **分岐メニューで「本譜」**（`KifuStreamList`）     | —           | `applyCursor` で本譜へ ✓                                                                 | **`goToIndex` に落ちて変化が確定する** → #225                              | ✓ 下記 |
| **分岐メニューで「変化 k」**（選択済みを再度）     | —           | `goToIndex(te)` でその手数へ ✓                                                           | 「別の選択」と誤判定して `applyCursor`。結果は同じ局面なので**表に出ない** | ✓ 下記 |
| `makeMove`（盤クリック）                           | 無視        | 手を足して1手進む                                                                        | **先の計画が消える** → #226                                                | ✗      |
| `setCommentsByCursor`（コメント欄）                | 無視        | 局面は動かない（`forceCommit`）                                                          | **先の計画が消える** → #226                                                | ✗      |
| `swapBranches` / `deleteBranch`（行メニュー）      | 無視        | 棋譜が変わり、カーソルは `res.nextCursor` へ                                             | **先の計画が消える。** 消えて正しいのは削除した枝を指す分だけ              | ✗      |
| 保存の失敗（`persistence.save`）                   | —           | `error` に出る。**state は戻さない**                                                     | 同左                                                                       | ✗      |
| `goto` が届かない / 壊れた `forkIndex`             | —           | `navigate` の `catch` → `error`。ただし `goto` は黙って止まるので**多くは throw しない** | 同左                                                                       | 部分的 |

「無視」は `if (!state.jkf) return` で早期に抜けること。「—」は起こらないこと。

## ディスクを列に入れる

編集系（W4〜W6）は**メモリを先に更新してから保存する**。保存が失敗しても state は戻さない。

| 記号 | 判定条件                                                | 意味                                 |
| ---- | ------------------------------------------------------- | ------------------------------------ |
| D0   | `persistence === undefined \|\| loadedAbsPath === null` | 保存先が無い。編集はメモリだけに残る |
| D1   | 最後の `save` が成功                                    | メモリとディスクが一致               |
| D2   | `save` が `success: false` を返した後                   | **メモリとディスクが食い違う**       |

| イベント                       | D0                              | D1                   | D2                                             |
| ------------------------------ | ------------------------------- | -------------------- | ---------------------------------------------- |
| `makeMove` / コメント保存 成功 | D0 のまま（黙って保存されない） | D1                   | D1 へ復帰                                      |
| 同 失敗                        | —                               | → D2。`error` に出る | D2 のまま                                      |
| `loadGame`（同じファイル）     | —                               | D1                   | **ディスクの内容で上書き。編集が黙って消える** |

D2 は state の中に印が無い。`error` は `clear_error` で消え、
次の `navigate` / `edit` の先頭でも消える（`provider.tsx:164` / `207`）ので、
**「保存に失敗したまま操作を続けている」状態を後から判定する手段が無い。**

そもそも `state.error` は `set_error` が9箇所から書くのに**読み手が0**
（`useGame()` の消費者16ファイルのどれも読んでいない）。
つまり上の表の「`error` に出る」は state に載るだけで**画面には出ない**。
→ [failure-surfacing.md](failure-surfacing.md) の F-12。
コメント保存のこの経路が #227（別ブランチで対応中）。

## 埋まっていないセル

| セル                                                   | 状態                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GameProvider` 自体の遷移すべて                        | **テスト無し。** `provider.tsx` にテストが1本も無い。上の表で ✗ を付けたものは全部これ                                    |
| 分岐メニュー「本譜」/「変化 k」                        | ✓ `KifuStreamList.forkMenu.test.tsx`（G2 で「本譜」が本譜へ戻ること、選択済みを再度押しても局面が動かないこと）           |
| `cursorFromLite` が `te > tesuu` を返しうるか          | **未検証。** 正規化していないので Rust 側の出力次第。検索ヒットのカーソルがどう作られるかは `search.md`（未作成）で扱う   |
| `PositionNavigationModal` の ← で作った `overridePlan` | **テスト無し。** `te > tesuu` を持つカーソルを `applyCursor` に渡す唯一の経路                                             |
| D2 のあと `loadGame` で編集が消える                    | **テスト無し。** 手で再現していない。表に残す                                                                             |
| `branchPlan` が線の末尾より先を指す                    | ✓ `leafTesuu.test.ts`「線の末尾より先に計画が残っていても throw しない」。ただし読み手 R1 だけ。R2（`goToIndex`）は未検証 |
| 行の `branchForkPointers` が計画から作られる           | **テスト無し。** 削除・入れ替えのクエリが「辿っていない枝」を指しうる → #196                                              |

## 不変条件

1. **`te <= cursor.tesuu` の範囲で `branchPlan` と `cursor.forkPointers` は一致する。**
   `mergeBranchPlan` はその範囲を `cursor.forkPointers` からしか取らず（`prevPlan` と
   `overridePlan` は `fp.te > cursor.tesuu` で絞る）、`jkf_replaced` / `game_loaded` は
   `cursor.forkPointers` をそのまま写す。6つの書き込み経路すべてがこれを守っている。
   **破れると「盤に出ている局面」と「行のチェック」が同じ手数で食い違う。**

2. **画面が「選ばれている」と描いたものと、押したときに比較される値は、同じ出どころでなければならない。**
   行のチェックは `branchPlan`（`buildStreamRows.ts:49`）、メニューの一致判定は
   かつて `cursor.forkPointers` だった。**不変条件1がある限り G1 では一致するので、
   G2 でしか壊れない**。これが #225 が長く残った理由。

3. **カーソルより先の計画を捨ててよいのは、棋譜が変わってその枝が実在しなくなったときだけ。**
   コメントの保存も駒を1つ動かすのも「棋譜が変わった」に含めているので、
   関係の無い先の計画まで巻き添えで消える（#226）。

4. **計画は無検証で持ち越される。** `branchPlan` に入る `forkIndex` を誰も検査しない。
   読み手のうち R1 / R3 / R4 / R5 は自分で捨てるが、**R2（`goToIndex` → `goto`）は捨てない**。
   値の分類は [branch-index.md](branch-index.md)、寄せ先の議論は #213。

## 実装との対応

- 状態と action: `src/entities/game/model/types.ts`、`src/entities/game/model/reducer.ts`
- 書き込み6経路: `src/entities/game/model/provider.tsx`
- 計画の合成: `src/entities/game/lib/cursor.ts` の `mergeBranchPlan`
- カーソルの正規化: `src/entities/kifu/model/cursor.ts` の `normalizeForkPointers` / `cursorFromSource`
- 行と分岐メニュー: `src/widgets/kifu-stream/`
- テスト: `src/entities/game/model/__tests__/reducer.test.ts`（identity のみ）、
  `src/widgets/kifu-stream/ui/__tests__/KifuStreamList.forkMenu.test.tsx`、
  `src/widgets/kifu-stream/lib/__tests__/buildStreamRows.test.ts`、
  `src/entities/kifu/lib/__tests__/leafTesuu.test.ts`
