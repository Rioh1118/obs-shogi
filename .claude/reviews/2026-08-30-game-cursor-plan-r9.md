# レビュー game-cursor-plan ラウンド9

- 日付: 2026-08-30
- 範囲: `main` のマージ（`44ede43`）の解決と、`git diff 44ede43..HEAD`（ラウンド8の修正）
- 対象コミット: `a51c8ef`
- 走らせた reviewer: react / comment / architecture
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) 〜 [r8](2026-08-30-game-cursor-plan-r8.md)

**BLOCK 0・HIGH 1・MEDIUM 3。4件すべて、このラウンドで自分が入れた変更が原因。**

`origin/main` に #261（202ファイル）が入ったので merge した。44コミットを rebase すると
同じ衝突を何度も解くことになるため、merge で1回に畳んでいる。衝突3件を手で解決した。

## 所見

| #   | 深刻度 | 所見                                                                                       | reviewer              | 結果                  |
| --- | ------ | ------------------------------------------------------------------------------------------ | --------------------- | --------------------- |
| V1  | HIGH   | U2 が「行のチェックの出どころ」を変えたのに、それを根拠にした不変条件2 と TSDoc が古いまま | react / comment — 2本 | 対応済み（`7b7bdc1`） |
| V2  | MEDIUM | U3 で書いた「組むのは `buildTesuuPointer` だけ」が偽（実際は3箇所）                        | comment               | 対応済み（`28423c8`） |
| V3  | MEDIUM | U2 で足したテストのコメントが挙げる例が、どの入力からも出ない                              | comment               | 対応済み（`de8b35c`） |
| V4  | MEDIUM | マージの解決が F-12 の分割に追随せず、#227 の参照を落とした                                | architecture          | 対応済み（`f670d70`） |

### V1 — 直したことで doc が嘘になった、を4回目

r8 の U2 で `selectedForkIndex` の出どころを「計画そのまま」から「実際に降りた分岐」に
変えた。ところが `resolveForkSelection` は今も `branchPlan` から引く。
`game.md` の不変条件2 と `cursorSelection.ts` の TSDoc は
**「行のチェックは `branchPlan` から出るので、一致判定も `branchPlan` から引く」**と
書いていて、その前提がこの変更で崩れた。

**実挙動は壊れていない。** 壊れない理由を react が辿った:

- `forkAndForward(num)` が `false` を返すのは `forks.length <= num` のときだけ
- メニューの選択肢は `getReadableForkKifu()` = 同じ `forks` から出る
- したがって**食い違う値は必ず押せる選択肢の外側にある**ので、`selected === forkIndex` が
  真になることがなく、`goToIndex` へは落ちない

**この「食い違いは押せない」が今の安全性の根拠で、それがどこにも書かれていなかった。**
次の読み手は不変条件2 を信じて、`buildStreamRows` を計画そのままに戻す（= U2 の退行）か、
`resolveForkSelection` を揃えにいくか、どちらにも動ける。

不変条件2 と TSDoc を実装に合わせ、押せる選択肢のどれとも一致しないことをテストで固定した。

**このループで「実装を直したあと docs を見直さない」は4回目**（r1 F1 / r3 H3 / r4 P1 / ここ）。
今回は自分が r8 で入れた修正が引き金で、しかも修正した側の doc（`game.md` の R5）は
確認していたのに、**同じファイルの別の節（不変条件2）を見ていなかった。**

### V2 — 腐りを直すコミットで、別の腐りを入れた

r8 の U3 で「`indexOf(",")` は0件」を根拠に `CLAUDE.md` を書き直したとき、
「**組むのは `buildTesuuPointer` だけ**」と断定した。実際の生成は3箇所:

- `entities/kifu/model/cursor.ts:157`（`cursorFromSource` — 移動のたびに通る主経路）
- `entities/search/lib/cursorAdapter.ts:11`（手書きの文字列）
- `features/position-navigation/ui/PositionNavigationModal.tsx:148`

後半（解く経路は無い）は正しい。前半だけが偽で、**grep した人が3件目でこの落とし穴の
記述全体を信用しなくなる**。U3 が問題にしたのがまさにその損失だった。
事実と規約を分けて書き直した。

### V4 — マージの解決で issue 参照が1つ消えた

main が F-12 を F-12a（保存）/ F-12b（操作）に割った。解決でブランチ側の記述
（分岐メニューが閉じるだけで盤が動かない）は F-12b に移したが、
**`直すのは #227` を落とし**、`game.md` から F-12 を指している参照も直さなかった。
`rg -n "227" docs/` が0件になっていた。台帳は自分が採番元だと宣言しているので、
番号のずれは索引の切れと同じ。

## 重複・矛盾した所見

- **V1 は react と comment が独立に検出。** 深刻度の見立てだけ割れた（HIGH / MEDIUM）。
  重い方を採った
- comment は V1 の直し方として (a) 出どころを本当に1つに戻す（`onSelectFork` に
  現在の選択を渡す）も挙げた。**採らない。** 実挙動が壊れていない以上、
  `KifuMoveCard` → `KifuForkMenu` の props を増やす価値が無く、
  このブランチの範囲でもない。理由を書く側で閉じる
- **矛盾なし**

## マージの解決について（所見にならなかった確認）

3本とも「両側の意図が残っているか」を別々の reviewer が確かめた。

- **`KifuStreamList.tsx`（自動マージ）** — main の `useOverlayLayer` / `isTop` /
  `Escape && isTop()` / dep への `isTop` 追加の4点と、ブランチの `revealRow` /
  `closeForkMenu` / `loadedAbsPath` dep が**両方載っている**。消えた意図は無い。
  `isTop` は `useCallback(..., [])` の安定参照なので dep に足しても発火は増えず、
  push は `[open]` の effect（hook 順で先）、Escape 登録は後の effect なので順序も正しい
- **`docs/` 2本** — main 側の成果（F-3 の `FileTreeErrorNotice`、F-14 の
  `InlineNameEditor`、F-12 の分割、在庫表の `inline-name-editor.md`）と
  ブランチ側（`game.md` の行）が両方残っている。落ちたのは V4 の1点だけ
- **`stateTransitionIndex.test.ts`** — main の `REPO_ROOT`（`walk.ts`）を
  `stateTransitionIndex.ts` 側で使う形にした。architecture が
  「`walk.ts` は `.md` の走査手段を公開していない（`tsFiles` / `scssFiles` / `sourceFiles` のみ）」
  「main 自身も `commentHistory.test.ts` で根を手元で組んでいる」ことを確かめ、
  **`DOCS` を `walk.ts` へ上げないのは規約違反ではない**と結論
- main が増やした横断検査12本に `docs/**/*.md` を読むものは無く、重複無し
- 層をまたぐ上向き import は全レイヤで0件

## 見ていない範囲

- **`src-tauri/`** — 9ラウンド続けて誰も読んでいない
- **#261 の本体**（157ファイル）。`overlayStack` の実装と `useOverlayLayer` の
  呼び出し4箇所だけ読んだ
- **実行時検証** — 9ラウンドすべて静的な読みと vitest のみ
- `entities/kifu/lib/comment.ts` / `sanitizeJkf`

## lint / hook で強制できるもの

1. **`failure-surfacing.md` の F 番号の集合を作り、`docs/**/\*.md`の`F-<数字>`が
その集合に含まれることを見る検査**（V4）→`staleUncreatedInBody` と同じ形で20行程度。
   **入れる価値がある。** 番号の分割・統合に追随していない参照が機械で落ちる
2. **`as TesuuPointer` の出現箇所を数える検査**（V2）→ #243 で既に挙がっている
3. **V1 / V3 は機械で防げない**
4. `docs/**/*.md` を verify-gate に（#251）/ `vp lint --deny-warnings`（r5 から）→ 持ち越し

## ラウンド10の対象

- V1〜V4 を直した状態で回す。**まだ所見ゼロのラウンドは出ていない**
- 直近2ラウンドの所見は**すべて自分の直近の変更が原因**で、範囲外の既存問題は
  r8 で issue に出し切った（#262〜#268）。収束に向かってはいる
