# レビュー game-cursor-plan ラウンド2

- 日付: 2026-08-30
- 範囲: `ce9afb8..HEAD`（10コミット）
- 対象コミット: `704b51d`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: [2026-08-30-game-cursor-plan-r1.md](2026-08-30-game-cursor-plan-r1.md)（31件中25件を修正、6件を #239〜#245 へ）

**所見ゼロではない。** HIGH 4件・MEDIUM 14件。うち2件はラウンド1の修正が持ち込んだ退行。

## 所見

### G1 [HIGH] `preventScroll: true` が、カーソルの動かない経路からスクロールを戻す手段を消した

- 場所: `src/widgets/kifu-stream/ui/KifuStreamList.tsx:68-77`、`:164-169`、`:180-194`
- reviewer: react（HIGH）/ robustness（MEDIUM）— 2本が独立に検出
- **ラウンド1の M20 修正（`7d61a02`）が持ち込んだ退行。**
- 根拠: 位置を戻すもう一方は `state.cursor?.tesuuPointer` を dep に持つ effect だけ。`closeForkMenu(true)` の呼び出し3つのうち**カーソルが動かない経路**では発火しない。
  - Escape（`:167`）— メニューは `createPortal` + capture 段階の `scroll` でアンカーに追従する（`KifuForkMenu.tsx:129-141`）ので、開いたままリストを流せばアンカーは画面外に出る。そこで Escape を押すとメニューだけ消え、**フォーカスは画面外のボタンに残る**
  - 選択済みの項目を押した場合（`:222` → `goToIndex`）— `provider.tsx:174-180` の no-op ガードで dispatch が起きない
  - `onRequestCloseForkMenu`（`:293`）
- 直し方: 閉じる側でも `scrollToRowSafeZone` を明示的に呼ぶ。セーフゾーン内なら即 return するので、カーソルが動く経路と二重に呼んでも無害。
- 結果: 対応済み

### G2 [HIGH] 新しい TSDoc が「`KifuCursor.forkPointers` は `te <= tesuu` に正規化済み」と型について断定している

- 場所: `src/entities/kifu/model/cursor.ts:49`、`:54-55`、`src/widgets/kifu-stream/lib/cursorSelection.ts:51-52`
- reviewer: comment
- 根拠: 同じファイルの `cursor.ts:29-31` は「forkPointers は…分岐計画も含みうる」と正反対を書いている。実際 `PositionNavigationModal.tsx:142-165` は `forkPointers` を据え置いたまま `tesuu` だけ減らした `KifuCursor` を作り `applyCursor` へ渡す。正規化されているのは型ではなく `state.cursor` という**値**だけ。
- なぜ問題か: 20行の距離に正反対の断定が並ぶ。型を「常に正規化済み」と信じた人は `mergeBranchPlan` の絞り込みを冗長と判断して外せてしまい、外すと不変条件1が壊れる。
- 結果: 対応済み

### G3 [HIGH] 新規テストの JSDoc に、このブランチで消したリンクの「かつての姿」が残っている

- 場所: `src/__tests__/stateTransitionIndex.test.ts:8-10`、`:39-42`
- reviewer: comment
- 根拠: `[game](#未作成の表)` は `cc9e5e5` で削除済み。`CONTRIBUTING.md:138`「「元は〜だった」も書きません」に当たる。**ラウンド1の F7（経緯の除去）を直した同じラウンドで再混入させている。**
- 結果: 対応済み

### G4 [HIGH] `G × P` の表に「棋譜を閉じる」の列が無く、いちばん重い喪失セルが落ちている

- 場所: `docs/state-transitions/game.md` の組の表
- reviewer: oss-hygiene
- 根拠: `GameFileTreeBridge.tsx:11-15` は `activeKifuPath` / `jkfData` / `kifuFormat` のどれかが落ちた瞬間に `resetGame()` を呼び、`reset_state` は保存を挟まない。`(G1/P2, E2)` =「保存に失敗した編集を抱えたまま棋譜を閉じる」で**編集が黙って永久に消える**。組の表を立てた理由にいちばん当てはまるのがこのセルなのに、表にも「埋まっていないセル」にも無い。
- 結果: 対応済み

### G5 [HIGH] 失敗イベントが E14 だけで、読み込みと編集の失敗が表から辿れない

- 場所: `docs/state-transitions/game.md` のイベント一覧
- reviewer: oss-hygiene
- 根拠: `set_error` 9箇所のうち表がイベントとして持つのは E14（保存）だけ。E1 の失敗（`provider.tsx:256`）と E11〜E13 の失敗（`:233` / `:366` / `:403`）が無い。`deleteBranchInKifu` に壊れた `BranchIndex` が来ると `assertBranchIndex` が throw → `set_error`（読み手0）→ **行メニューを押しても何も起きない**が、表から辿れない。SKILL 手順2 が「失敗を書かない、が最頻」と名指ししている漏れ方。
- 結果: 対応済み

## MEDIUM

| #   | 所見                                                                                                                               | reviewer                                          | 結果                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| N1  | `computeLeafTesuu` / `buildPlayer` が `KifuCursor` を要求するので、`plannedCursorOf` の戻り値を渡せない。R1 だけ型が分かれていない | architecture / comment / robustness               | 対応済み（provider は #247） |
| N2  | brand は `plannedCursorOf(cursor, cursor.forkPointers)` を塞げない。テスト自身がそれを実演している                                 | architecture                                      | 一部対応（TSDoc に明記）※    |
| N3  | 「未作成」検査の正規表現が README の2つの書き方（階層図・在庫表）を拾わない                                                        | architecture / robustness / comment / oss-hygiene | 対応済み                     |
| N4  | 見出しアンカーの slug が github-slugger と食い違い、正しいリンクを落とす（`—` を挟む見出しで `-` vs `--`）                         | robustness                                        | 対応済み                     |
| N5  | 「捨てない値」のテストが**到達不能な入力**を固定し、実際に起きる壊れ方（範囲外の正の整数 → 黙って本譜）が抜けている                | robustness                                        | 対応済み                     |
| N6  | `game.md` 冒頭の「型では止まらなかった」が過去形で、100行下の記述と食い違う                                                        | comment                                           | 対応済み                     |
| N7  | 「未作成」検査のテスト名が実装より広い範囲を約束している                                                                           | comment                                           | 対応済み（N3 と同じ修正）    |
| N8  | `describe("捨てない値")` の中に「落ちる」ことを検証するテストが入っている                                                          | comment                                           | 対応済み                     |
| N9  | 壊れた `forkIndex` の行き先を「TypeError」の1本道で断定。`forks` が無い te では `false` で黙って別の線へ着く                       | comment                                           | 対応済み                     |
| N10 | `plannedCursorOf` だけが `XFromY` の命名から外れている（既存9件に対して1件）                                                       | comment                                           | 対応済み                     |
| N11 | 書式の不揃いが4点残る（記号の太字 / 状態表の列構成 / 見出し名 / 節の順序）                                                         | oss-hygiene                                       | 対応済み                     |
| N12 | 「規則が6箇所に散る」と `branch-index.md` の「3箇所」が食い違う。数の出所が二重                                                    | oss-hygiene                                       | 対応済み                     |
| N13 | #245 / #227 に送った宿題が docs 側に番号として残っていない                                                                         | oss-hygiene                                       | 対応済み                     |
| N14 | `failure-surfacing.md:6` は実測コミットを固定しているのに、宣言を更新せず行だけ書き換えた                                          | oss-hygiene                                       | 対応済み                     |
| N15 | `openFork` が `rows` と同期しておらず、分岐を消すと開いたままの state が残る（この差分の退行ではない）                             | react                                             | 見送り → #248                |
| N16 | リンク検査がコードフェンスを除外していない（今は該当0件）                                                                          | robustness / oss-hygiene                          | 対応済み                     |
| N17 | リンク検査は `docs/` 全体へ広げてよい（実測で壊れ0件）                                                                             | oss-hygiene                                       | 対応済み                     |

### ※ N2 に反論する

`plannedCursorOf` を1引数（`Pick<GameContextState, "cursor" | "branchPlan">`）にしても穴は閉じない。
`{ cursor: state.cursor, branchPlan: state.cursor.forkPointers }` が同じように tsc を通るため、
「取り違えようのある引数を1つに減らす」は成立しない。移設のコストを払っても防げるものが増えないので、
reviewer 自身が代案として挙げた「TSDoc に残る穴を書く」を採った。

## 重複・矛盾した所見

- **N3 は4本すべてが検出した。** ラウンド1で入れた再発防止テストが、守りたかった README の2箇所を守れていなかった。
  oss-hygiene は scratchpad に `search.md` を置いて実際に回し、test1 は落ちるが test3 は素通りすることを実測している。
- **G1 は react が HIGH、robustness が MEDIUM。** 同じ経路を指しているので HIGH に寄せた。
- **矛盾**: architecture は N1 の直し方として「`provider.tsx:73-77` も `plannedCursorOf` に寄せる。この行は
  wt-227 が触る保存経路とは別の `useMemo` なので競合しない」と主張。ラウンド1で「競合するので見送る」と
  書いた判断への反論になっている。**型を広げるところまでは採り、`provider.tsx` の書き換えは #247 に送った。**
  同一ファイルへの変更を増やすほど wt-227 のマージが重くなるという判断は変えていない。
- **矛盾**: comment は `game.md` の R5 / R6 が両方 `KifuStreamList.tsx:48` を指す点を「実際の呼び出しは
  `:58` / `:127` / `:277`」としつつ所見にしていない。oss-hygiene は N12 で「数の出所を一本化せよ」と言う。
  両方を採り、R 表は「その値がどこへ流れるか」を書く形に統一した。

## 見ていない範囲

- **`src-tauri/`**: 4本とも未読（差分に無いため）。`game.md` が引く `index_builder.rs` の主張はラウンド1の
  architecture の読みをそのまま採用している
- **`KifuMoveCard.tsx` / `KifuForkMenu.tsx` / `KifuForkActions.tsx` / `KifuMoveActions.tsx` の本体**: 2ラウンド続けて未読
- **`KifuCommentNote` / `FloatingNote`**: 2ラウンド続けて未読。分岐メニュー → コメントのフォーカス遷移は未確認
- **`entities/kifu/lib/branchEdit.ts`**: `resolveLine` の中身は未読。G5 の `assertBranchIndex` 経路は
  呼び出し位置からの判断
- **`GamePersistenceGate` / `GameFileTreeBridge`**: oss-hygiene だけが読み（21行 / 27行）、G4 の根拠にした
- **実行時検証**: 5本とも静的な読みのみ。G1 のスクロール挙動は `focus()` の仕様とコードからの判断で、
  WKWebView での実測はしていない
- **変異テスト**: `.claude/skills/state-transition-table/SKILL.md` 手順7 を reviewer 側では実行していない

## lint / hook で強制できるもの

1. **「未作成」検査を行単位にする**（N3）。README の3形すべてを1本で拾える。**今回入れる**
2. **`slug()` の単体テスト**（N4）。いま `docs/state-transitions` にアンカー付きリンクが0本なので、
   この分岐は一度も実行されていない。**今回入れる**
3. **コードフェンスの読み飛ばし**（N16）。フェンス内にリンクや見出しを書いた瞬間に誤検知と見逃しが同時に出る。**今回入れる**
4. **リンク検査を `docs/` 全体へ**（N17）。oss-hygiene が19本の相対リンクを全解決して壊れ0件を確認済み。**今回入れる**
5. **`computeLeafTesuu` の引数を計画側に寄せる**（N1）。コメントの規約では止まらない。**今回入れる**
6. **L1 表の節構成の順序検査**（N11）。`stateTransitionIndex.test.ts` に見出し列の比較を1本足せば機械化できるが、
   除外リストの管理が要る。**今回は入れない。**書式を手で揃えるほうが安い段階
7. **機械では防げないもの**: G1（`preventScroll` の適用範囲）、G2・G4・G5（記述と実装の一致）、
   N5（テストが到達不能な入力を固定していること）、N8・N9（テスト名とコメントの正確さ）

## 次ラウンドの対象

- G1〜G5、N1〜N14、N16、N17 を直す
- N15 は #248 へ
- ラウンド3を回す
