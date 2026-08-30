# レビュー game-cursor-plan ラウンド1

- 日付: 2026-08-30
- 範囲: `ce9afb8..HEAD`（`docs/state-transitions/game.md` 新規、`README.md`、`src/widgets/kifu-stream/lib/cursorSelection.ts`、`src/widgets/kifu-stream/ui/KifuStreamList.tsx`、`src/widgets/kifu-stream/lib/__tests__/cursorSelection.test.ts`）
- 対象コミット: `ec05fdf`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
  - `.scss` と `src-tauri/` に変更が無いので ui / rust は外した。ループ・IO を足していないので perf も外した
- ワークツリー: `.claude/worktrees/game-state-transitions`、ブランチ `fix/225-fork-menu-main-line`

## 所見

### F1 [BLOCK] 状態×イベント表の分岐メニュー2行が、修正前の挙動を「現在の挙動」として書いている

- 場所: `docs/state-transitions/game.md:92`、`:93`（併せて `:7`）
- reviewer: comment（BLOCK）/ oss-hygiene（HIGH）/ robustness（HIGH）— 3本が独立に検出
- 根拠: G2 列に「**`goToIndex` に落ちて変化が確定する** → #225」「「別の選択」と誤判定して `applyCursor`」と書いてあるが、`cursorSelection.ts:51` の `selected` は `planned.forkPointers` から引くので、G2 の「本譜」は `selected=0 ≠ null` で `apply`、「変化 k」再選択は `selected === forkIndex` で `goto` になる。同じ行のテスト列は `✓` で、そのテストは表と**正反対**を assert している。
- 追加: G1 列の「`applyCursor` で本譜へ」も不正確。その te に選択が無ければ `selected === null === forkIndex` で `goto` になる（`cursorSelection.test.ts:79-81` が固定済み）。
- 結果: 対応済み（下記）

### F2 [HIGH] 読み手の表 R3 / R4 / R5 の ✓ と不変条件4が、実装と食い違う

- 場所: `docs/state-transitions/game.md:74-76`、`:158-160`
- reviewer: oss-hygiene / architecture / robustness — 3本が独立に検出
- 根拠: `forkAndForward` が `false` を返すのは `forks.length <= r` のときだけ。負・非整数は `forks[-1]` を掴んで `TypeError`（`branch-index.md:77-80` が既に書いている）。`provider.tsx:280`（`nextMove`）と `:315`（`goToEnd`）はどちらも検査していない。さらに両者とも `currentStream[nextTe]` の存在を見ないので、**線の末尾+1 に計画が残っていると `forkAndForward` が throw する**（「te=12 の変化を計画 → その枝を削除 → `goToEnd`」で盤が1手も動かず、`set_error` は読み手0）。
- 追加（robustness）: R5 も割る必要がある。`plannedCursor` の読み手は2つあり、`buildStreamRowsFromCursor` は捨てるが `buildCursorWithForkSelection` は捨てずに `goto` まで届ける。捨てているのは `computeLeafTesuu` と `buildStreamRowsFromCursor` の2箇所だけで、これは `branch-index.md:81-85` の記述と一致する。`game.md` 側だけが食い違っている。
- 結果: 対応済み（下記）

### F3 [HIGH] 「`state.cursor` を渡せなくした」は型では成立していない

- 場所: `src/widgets/kifu-stream/lib/cursorSelection.ts:46-50`、`src/widgets/kifu-stream/ui/KifuStreamList.tsx:48-54`、`src/entities/game/model/provider.tsx:73-77`
- reviewer: architecture（HIGH）/ comment（HIGH）/ react（MEDIUM）/ robustness（MEDIUM）— 4本
- 根拠: `resolveForkSelection(planned: KifuCursor, ...)` なので `if (state.cursor) resolveForkSelection(state.cursor, te, i)` は今でも tsc を通る。制限はコメントだけ。加えて `plannedCursor` は `{...state.cursor, forkPointers: state.branchPlan}` で組むため、`tesuuPointer` だけ「辿ったカーソル」由来のまま残る**不整合な `KifuCursor`**。`cursor.ts:19` の「この型を作ってよいのは `buildTesuuPointer` だけ」という規約も破っている。同じ組み立てが provider と widget に手書きで2つある。
- 結果: 対応済み（下記）。provider 側の重複は wt-227 との競合を避けて残した（F3-b）

### F4 [HIGH] `game.md` を書いたのに、他の表からの参照が「未作成」のまま。`app.md` のリンクは死んでいる

- 場所: `docs/state-transitions/app.md:48`、`file-tree.md:5`、`README.md:28`
- reviewer: oss-hygiene
- 根拠: `app.md:48` は `[game](#未作成の表)` だが `app.md` に `## 未作成の表` は無い（0件）。L0 から L1 game への唯一の導線がそこ。`stateTransitionIndex.test.ts:21` は README が `(game.md)` を含むかしか見ないので落ちない。
- 結果: 対応済み（下記）

### F5 [HIGH] テスト名「本譜と変化が入れ替わる」が、検証している事実と違う

- 場所: `src/widgets/kifu-stream/lib/__tests__/cursorSelection.test.ts:53-60`
- reviewer: comment
- 根拠: 「入れ替わる」なら逆方向も壊れるはずだが、`wrong` に `forkIndex = 0` を渡すと `selected === null` で不一致 → `apply` になり結果は正しい。壊れるのは「本譜」の一方向だけで、これは `cursorSelection.ts:43` の JSDoc とも一致する。
- 結果: 対応済み（下記）

### F6 [HIGH] テストヘルパの JSDoc が「実物と同じ組み方」と書いているが `tesuuPointer` が違う

- 場所: `src/widgets/kifu-stream/lib/__tests__/cursorSelection.test.ts:6-14`
- reviewer: comment / architecture
- 根拠: ヘルパは `buildTesuuPointer(tesuu, forkPointers)` で整合した値を作るが、実物（`KifuStreamList.tsx:48-54`）は `state.cursor` の `tesuuPointer` をそのまま持ち回る。本番の壊れた形をテストが再現していない。
- 結果: 対応済み（F3 の型変更で `tesuuPointer` 自体を持たせない形にして解消）

### F7 [HIGH] 変更の経緯がコメントと doc に残っている

- 場所: `docs/state-transitions/game.md:126`（「別ブランチで対応中」）、`:56`（「〜がまだ無かった名残」）、`cursorSelection.test.ts:18`、`:34`（`#225`）
- reviewer: comment
- 根拠: `CONTRIBUTING.md:135-139` が禁じている形。「別ブランチで対応中」はマージされた瞬間に嘘になる。
- 結果: 対応済み（下記）

### F8 [HIGH] 「本譜」の失敗が完全に沈黙する

- 場所: `src/widgets/kifu-stream/ui/KifuStreamList.tsx:219-223`、`src/entities/game/model/provider.tsx:622-625`
- reviewer: robustness
- 根拠: `applyCursor` は `catch` で `set_error` に落とすが読み手0（F-12）。`closeForkMenu(true)` を先に呼ぶので、失敗しても選択画面すら残らず「押しても何も起きない」だけになる。
- **退行ではない**（修正前の `goToIndex` 経路も同じ壊れた値を `goto` に渡していた。到達経路が `navigate` の catch から `applyCursor` の catch へ移っただけ）。
- 結果: 見送り。`applyCursor` の返り値を変えるには `entities/game/model/provider.tsx` を触る必要があり、そこは wt-227 が占有している。表への追記だけ行い、本体は #227 の側へ送る（下記）

## MEDIUM

| #   | 所見                                                                                       | reviewer             | 結果                     |
| --- | ------------------------------------------------------------------------------------------ | -------------------- | ------------------------ |
| M1  | `ForkSelection` の名が既存語彙の「selection」（= `forkIndex \| null`）と衝突               | comment              | 対応済み                 |
| M2  | `buildCursorWithForkSelection` に TSDoc が無く、`te` 以降を捨てる契約が書かれていない      | comment              | 対応済み                 |
| M3  | `planned` が同一リポジトリで3つの別物を指す                                                | comment              | 対応済み（範囲内のみ）   |
| M4  | 「両方が同じ内容」の describe が同一入力を2回回し、アサーションが実装の写し                | comment              | 対応済み                 |
| M5  | 新規テストが壊れた計画（負・非整数）と `te` より深い計画のセルを落としている               | robustness           | 対応済み                 |
| M6  | `game.md` D0 の判定条件が実装と違う（`loadedAbsPath` は保存判定に関与しない）              | comment / robustness | 対応済み                 |
| M7  | `clear_error` は7箇所（`applyCursor` を含む）。表は2箇所しか挙げていない                   | robustness           | 対応済み                 |
| M8  | 書き込みの表に `reset_state` が抜け、経路は7つ                                             | architecture         | 対応済み                 |
| M9  | `overridePlan` の記述が「唯一の経路」と「未検証」で自己矛盾。Rust 側が構造的に保証している | architecture         | 対応済み                 |
| M10 | 状態×イベント表の3セルが条件付き遷移を無条件に書いている                                   | architecture         | 対応済み                 |
| M11 | G1 列が「計画なし」を「本譜にいる」と取り違えている                                        | robustness           | 対応済み                 |
| M12 | `—` の凡例が1つなのに3通りの意味で使われている                                             | oss-hygiene          | 対応済み                 |
| M13 | 既存8本とタイトル・「対象」行・上位リンク・記号（P vs D）が揃っていない                    | oss-hygiene          | 対応済み                 |
| M14 | 外部状態を別表に切ったのに相互に相手側の列を持たせていない                                 | oss-hygiene          | 対応済み                 |
| M15 | README 階層図で L2 が `study-positions.md` の子に見える                                    | oss-hygiene          | 対応済み                 |
| M16 | `app.md` ※2 が game.md に投げた宿題（ワークスペース変更）が埋まっていない                  | oss-hygiene          | 対応済み                 |
| M17 | `te` より深い計画が乗り換えた別の線に黙って適用される                                      | robustness           | 対応済み（判断を明記）   |
| M18 | `applyCursor` に `navigate` の no-op ガードが無く、空撃ちで全消費者が再レンダ              | react                | 見送り → issue           |
| M19 | `RowModel.selectedForkIndex` の丸めを消費者3箇所が別々に解釈                               | react                | 見送り → issue           |
| M20 | `focus()` がスクロールを起こし `scrollToRowSafeZone` と競合                                | react                | 対応済み（独立コミット） |
| M21 | 1回の選択で `closeForkMenu(true)` が2回呼ばれる                                            | react                | 見送り → issue           |
| M22 | widget の `lib` が `ui` の型（`RowModel`）に依存                                           | architecture         | 見送り → issue           |
| M23 | `cursorAdapter.ts:11` が `as TesuuPointer` を直書きし、規約を破っている                    | architecture         | 見送り → issue           |

## 重複・矛盾した所見

- **F1 は3本が独立に検出**（comment=BLOCK / oss-hygiene=HIGH / robustness=HIGH）。3本とも同じ2行を指し、同じ理由（テストが表と逆を固定している）を挙げている。最優先。
- **F2 も3本**（oss-hygiene / architecture / robustness）。architecture だけが `json-kifu-format` の実体（`return !(!e||e.length<=r)`）まで下りて `false` を返す条件を確定させ、robustness は R5 の分割まで踏み込んだ。両方採る。
- **F3 は4本**。修正案が分かれた: architecture は `PlannedCursor` を `entities/kifu/model/cursor.ts` に置いて `GameView` に載せる、react は `entities/game/lib/cursor.ts` に `plannedCursor(cursor, plan)` を置く、robustness は「`tesuuPointer` を持たない型にする」。**`GameView` に載せる案は `entities/game/model/provider.tsx` を触るので wt-227 と競合する。** `entities/kifu/model/cursor.ts` に brand 付きの型と構築関数を置き、widget 側だけ差し替える案を採る（provider 側の重複は残るので issue に送る）。
- **矛盾**: architecture は「`cursorFromLite` は Rust 側が `te <= tesuu` を構造的に保証しているので `PositionNavigationModal` が唯一で正しい」（`index_builder.rs:107-124` / `node_table.rs:19-37` を読んだ上での断定）、robustness は「Rust を読んでいないので未検証」と申告。**architecture が実際に Rust を読んでいるので、そちらを採る。**
- **矛盾**: react は「F8 の経路は今回の変更で悪化していない」、robustness は「「本譜」という最も押される項目がこの経路に載った」。どちらも「退行ではない」点では一致しているので、退行なしとして扱い、doc への追記だけ行う。

## 見ていない範囲

- **Rust 側**: architecture が `search/index_builder.rs` / `node_table.rs` の `fork_path` 生成部だけを読んだ。`lib.rs` のコマンド登録と他のモジュールは誰も見ていない（差分に Rust が無いため）
- **`KifuMoveCard.tsx` / `KifuForkMenu.tsx` / `KifuForkActions.tsx` / `KifuMoveActions.tsx` の本体**: react が props と `onSelect` 周りだけ、comment は未読
- **`KifuCommentNote` / `FloatingNote`**: 誰も読んでいない。分岐メニューから開く子ポップオーバーのフォーカス順序は未確認
- **`entities/kifu/lib/branchEdit.ts` / `applyMoveWithBranch.ts`**: 未読。W5 / W6 が `nextCursor` をどう作るかは provider 側の呼び出しからしか判断していない
- **`file-tree` provider の `kifu_loading` / `kifu_closed`**: 未読。`activeKifuPath` と `state.jkf` が食い違う窓が本当に無いかは断定できていない
- **実行時検証**: 5本とも静的な読みのみ。`KifuStreamList` を実際にレンダリングした確認はしていない
- **SCSS / セキュリティ**: 差分に該当箇所が無いため見ていない
- **前提の訂正**: `docs/state-transitions/inline-name-editor.md` は**このワークツリーに存在しない**（別ブランチ `5a20185` でのみ追加）。私が起動プロンプトで既存として挙げたのは誤り。そのブランチがマージされる際に README の在庫表と階層図の更新が要る

## lint / hook で強制できるもの

1. **`PlannedCursor` を brand 付きの別型にする** → F3 が tsc で止まる。コメントでは止まらない。**今回入れる**
2. **`docs/**/\*.md` のリンク先ファイルと見出しアンカーの解決検査** → F4 が機械で落ちる。`stateTransitionIndex.test.ts`が既に`docs/state-transitions`を`readdirSync` しているので、同じファイルにテストを1つ足すだけ。**今回入れる**
3. **「`X.md`（未作成）」と実ファイルの存在の矛盾検査** → F4 の残り半分（`file-tree.md:5` / `README.md:28`）。同上。**今回入れる**
4. `src/*/*/lib/**` から `../ui/*` への import 禁止（`vite.config.ts` の override を1つ追加）→ M22。**issue へ**
5. `branch.ts` 以外での `as TesuuPointer` の禁止 → M23。**issue へ**
6. **機械では防げないもの**: 表のセルが実装の現在の挙動と合っているか（F1 / F2）、テスト名と本文の食い違い（F5）、実装の写しになったアサーション（M4）、`focus()` の `preventScroll` 漏れ（M20）。運用で見るしかない

## 次ラウンドの対象

- F1〜F7、M1〜M17、M20 を直す（1所見1コミット）
- F8 / M18 / M19 / M21 / M22 / M23 は範囲外または競合のため issue へ
- 修正で新しい問題が入っていないかを見るため、ラウンド2を回す
