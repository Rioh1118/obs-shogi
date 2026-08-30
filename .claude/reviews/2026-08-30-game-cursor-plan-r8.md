# レビュー game-cursor-plan ラウンド8

- 日付: 2026-08-30
- 範囲: `git diff ce9afb8..HEAD -- src/widgets src/features src/entities src/shared`（ブランチの実ロジック全体）
- 対象コミット: `0c7d39c`
- 走らせた reviewer: architecture / react / robustness / comment（oss-hygiene は外した）
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) 〜 [r7](2026-08-30-game-cursor-plan-r7.md)

**観点を変えたラウンド。** 直近3ラウンドは所見が `src/__tests__/stateTransitionIndex.*`
（docs 検査の道具立て）に集中していた。ユーザーの指示で `src/__tests__/` を対象外にし、
reviewer には**7ラウンド誰も読んでいなかった** `KifuForkMenu` / `KifuForkActions` /
`KifuMoveActions` / `branchEdit.ts` の `resolveLine` を読ませた。

**結果、8ラウンドで最大の収穫になった。BLOCK 1・HIGH 3・MEDIUM 6。**
**ただし9件中6件はこのブランチの差分外の既存問題**で、issue に送った。
architecture は「無し」。

## 所見

| #   | 深刻度 | 所見                                                                     | reviewer                        | 結果                  |
| --- | ------ | ------------------------------------------------------------------------ | ------------------------------- | --------------------- |
| U1  | MEDIUM | dep のコメントの「同じパスを読み直したときは発火しない」が偽             | comment                         | 対応済み（`f345e90`） |
| U2  | MEDIUM | 行が言う分岐の選択に、検査を通っていない計画がそのまま載る               | comment                         | 対応済み（`59e18cf`） |
| U3  | MEDIUM | `CLAUDE.md` の「既知の落とし穴」が、実在しない手書きパースを指す         | robustness / architecture — 2本 | 対応済み（`c3bf53c`） |
| U4  | BLOCK  | 開いている棋譜をリネーム／移動すると編集が巻き戻り、次の保存で消える     | react                           | issue へ（#262）      |
| U5  | HIGH   | 操作ポップオーバーがスクロールで別の行へ滑り、表示と削除対象がずれる     | react                           | issue へ（#263）      |
| U6  | HIGH   | 棋譜の保存が直列化されておらず、古い内容が新しい内容を上書きしうる       | robustness                      | issue へ（#264）      |
| U7  | HIGH   | `isLoading` が `true` で commit されず、`busy` ガードが全部死んでいる    | robustness                      | issue へ（#265）      |
| U8  | MEDIUM | `moveMenuRef` が未接続で、手の操作メニューの外側クリック判定が死んでいる | react                           | issue へ（#266）      |
| U9  | MEDIUM | 分岐メニュー周りの命名のずれと、片方にしか無い「なぜ」                   | comment                         | issue へ（#268）      |

### U2 — doc の「捨てる ✓」が実装では走査にしか掛かっていなかった

`game.md` の R5 は `buildStreamRowsFromCursor` を「壊れた計画を**捨てる** ✓」の側に数え、
用途欄に「行の並び・チェック・分岐メニューの表示」と書いている。実装は

```ts
if (plannedForkIndex != null && Number.isInteger(plannedForkIndex) && plannedForkIndex >= 0) {
  ok = player.forkAndForward(plannedForkIndex);
  if (!ok) ok = player.forward();
}
...
selectedForkIndex: plannedForkIndex,   // ← 検査を通っていない値をそのまま載せる
```

で、検査は `forkAndForward` の呼び出しを守るだけ。`forkAndForward` が `false` を返して
本譜へ落ちた場合も、行は「変化を選んでいる」と言い続ける。帰結:

- `KifuMoveCard` は `row.selectedForkIndex + 1` をバッジに出すので **`変化0`** のような表示になる
- 同じ値を `KifuForkMenu` の `normalizeSelected` は `null` に丸めるので、
  **バッジは「変化0」・メニューの ✓ は「本譜」** という食い違った画面になる
- `branchIndexFromRow` が `-1` を `BranchIndex` に直そうとして throw する。
  この throw は JSX のコールバックの中なので `deleteBranch` の try/catch に入らない

**実装を doc に合わせた**（実際に降りたときだけ載せる）。doc は直していない。
計画をそのまま載せる形に戻すと落ちるテストを足し、落ちることを実測した。

### U4 — 8ラウンドで初めて出た BLOCK

`active_kifu_reconciled` は**パスだけ**を差し替え、`file-tree.state.jkfData` は
`kifu_opened` で入れた**開いた瞬間の内容**のまま残る。保存はディスクにしか書かないので
ここは古くなる一方。そこへ `GameFileTreeBridge` が `activeKifuPath` を dep に持つので、
リネーム／移動で `loadGame(古い jkfData, 新しいパス)` が走り、盤が編集前に巻き戻る。
**そのあと1手指すと、巻き戻った内容が新しいパスへ保存される。**

利用者から見ると「保存したはずの手が消えている」なので、やり直そうとする。
その操作自体が上書き保存の引き金になる。

**#261 のマージ後も成立することを確認した**（`reconcilePathMutation` も bridge も
そのまま）。この差分の範囲外なので #262 へ。

### U7 — `busy` を渡している4コンポーネントのガードが全部死んでいる

`edit` は `set_loading(true)` → `jkf_replaced` を同一の同期ブロックで撃ち、
React 18 が1バッチにまとめる。そして `jkf_replaced` は `isLoading: false` を含む。
robustness が `GameProvider` を立てて毎レンダを記録し、`save` が飛んでいる最中を含めて
**`true` の commit が0回**であることを実測した。

**`GameProvider` はレンダリングテストが組めることが分かった**（`happy-dom` +
`@testing-library/react` で動く）。`KifuStreamList` が組めないのとは別の話で、
8ラウンド「実行時検証ができない」と書き続けてきた範囲は、実は provider 側なら崩せる。

## 重複・矛盾した所見

- **U3 は robustness と architecture が独立に検出。** どちらも `indexOf(",")` が
  リポジトリに0件であることを grep で確かめている。**このラウンドの依頼文にも
  引き写されていた**ので、腐った CLAUDE.md が reviewer の時間を実際に奪った
- **矛盾なし**
- **U1 の直しは r7 の T1 の書き直しの続き。** 同じ4行が8ラウンドで5回書き換わっている

## reviewer の提案を採らなかったもの

- **`loadedAbsPath` を dep にした判断（r7 T1）への反論は、react も robustness も
  出せなかった。** どちらも独立に「`loadGame` の呼び出しは1箇所」「`jkfData` を書くのは
  `kifu_opened` だけ」を辿り、**同じパスで `game_loaded` が2回撃たれる経路は現状無い**
  ことまで確かめている（`isActive` / `isAlreadyActive` が両方で塞ぐ）。r7 で「取りこぼす」と
  書いた限定すら、実際には起きない
- architecture は brand 型の置き場・`tesuuPointer` の重複・`widgets/kifu-stream/lib/` の
  置き場のいずれも「下げるべきものは無い」と結論。**8ラウンドで初めての「無し」**

## 見ていない範囲

- **`src-tauri/`** — 8ラウンド続けて誰も読んでいない。U6 で `atomic_write` の tmp 名が
  固定であることだけ読んだが、実行はしていない
- **実行時検証** — U4 / U5 / U8 はいずれも静的な読み。U6 / U7 は vitest で実測した
- `entities/kifu/lib/comment.ts` / `applyMoveWithBranch.ts` / `sanitizeJkf`
- `entities/search/lib/cursorAdapter.ts`（#243 で既出）

今回初めて読まれたもの: `KifuForkMenu.tsx` / `KifuForkActions.tsx` / `KifuMoveActions.tsx`、
`branchEdit.ts` の `resolveLine`、`file-tree/model/provider.tsx` の `reconcilePathMutation`。

## 調べて所見にしなかったもの（robustness）

- **`resolveLine` に欠陥は見つからなかった。** 添字の座標系は両方向とも整合し、
  負・非整数・範囲外の `forkIndex` は `isUsableFork` で throw に落ちる（黙って別の枝へは行かない）
- `patchForkPointersForDeleteNonReloc` の1分岐が到達不能。害は無く、コメントが誤解を招くだけ
- `swapBranchesInKifu` は `tesuu` より先の `forkPointer` を持つカーソルを返すが、
  唯一の呼び出し元が `buildPlayer` で組み直すので state には届かない

## lint / hook で強制できるもの

1. **U7 / U6 は `GameProvider` のレンダリングテストで固定できる**（実測済み）。
   このループが8ラウンド「組めない」と書いてきたのは `KifuStreamList` の話で、provider は別
2. **U8 は「宣言した ref が同じファイルで一度も使われない」検査**で拾える。20行程度
3. **U5 は `oxlint-disable-next-line react-hooks/exhaustive-deps` の抑止6件を外せば lint が拾う**
4. **U4 / U9 は機械で防げない**
5. `docs/**/*.md` を verify-gate に（#251）/ `vp lint --deny-warnings`（r5 から）→ 持ち越し

## ラウンド9の対象

- U1〜U3 を直した状態で回す。**まだ所見ゼロのラウンドは出ていない**
- U4〜U9 は範囲外なので、このブランチでは直さない（#262〜#268）
