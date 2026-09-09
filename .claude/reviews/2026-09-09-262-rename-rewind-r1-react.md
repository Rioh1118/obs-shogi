# #262 改名で棋譜が巻き戻る — React レビュー (r1)

対象: `git diff main`（基点 `3ee1551d`）。**当時の3コミットは畳み込み済み**——所見の位置は sha ではなくファイルと綴りで引くこと。
見た範囲は React のコンポーネントとフックのみ（SCSS・レイアウトは対象外）。

### [HIGH] `loadedAbsPath` の意味を変えたのに、読み手を1つしか直していない

- 場所: `src/entities/game/model/reducer.ts:516-523`（`path_renamed`）、
  `src/widgets/kifu-stream/ui/KifuStreamList.tsx:317-323`、
  `src/features/kifu-comment-note/ui/KifuCommentNote.tsx:113-124` と `:188-202`、
  `src/widgets/kifu-stream/ui/KifuStreamList.tsx:383-385`
- 根拠:

  ```tsx
  // KifuStreamList.tsx:317
  useEffect(() => {
    setOpenComment(null);
    setOpenFork(null);
    setOpenMoveMenu(null);
    setPendingDelete(null);
  }, [state.loadedAbsPath]);
  ```

  ```tsx
  // KifuCommentNote.tsx:117（save の中）
  if (target.absPath !== commitRef.current.loadedAbsPath) {
    const msg = "棋譜が切り替わったので保存できませんでした";
    if (showing()) setEditing(...);
    return "skipped";
  }
  ```

- なぜ問題か: この PR は `loadedAbsPath` を「`game_loaded` でしか動かない＝盤の中身が
  変わった合図」から「改名でも動く」へ変えた。**その曖昧さを解くために `loadedSeq` を
  足したのに、組で見るよう直したのは `useResetOrientationOnKifuChange` だけ。**
  他の読み手は今もパス1つを「別の棋譜が載った」として読む。
  1. 改名・移動のたびに `KifuStreamList.tsx:317` が発火し、**開いていたコメントノート・
     分岐メニュー・手のメニュー・削除の確認が全部閉じる。** PR 以前は同時に盤が
     載せ直されていたので閉じて正しかった。盤が据え置かれる今、閉じる理由は無い。
  2. 打った本文が消える経路が残る。ノートは面が外れるとき `KifuCommentNote.tsx:201` で
     `save(prev.face, prev.draft, prev.baseText)` を撃つが、`prev.face.absPath` は
     **ノートを開いた時点のパス**（`:21` の `Face`、`KifuStreamList.tsx:306` で捕まえる）。
     改名後は `commitRef.current.loadedAbsPath` が新しいパスなので `:117` の門番に当たり
     `"skipped"` で戻る。その時点で `showing()` は偽（面はもう外れている）なので、
     **本文も失敗の文言も1フレームも出ないまま消える**（`:184-186` のコメントが
     まさにこの状態を宣言している）。踏むのは 900ms の自動保存が撃つ前か、
     撃った保存が飛行中に改名が着地したとき。`FloatingNote` は外側クリックで
     閉じない（`src/shared/ui/floating-note/FloatingNote.tsx:116-129` は Escape のみ）ので、
     ノートを開いたままツリーで改名する操作は普通に届く。
  3. 出る文言も嘘になる。棋譜は切り替わっていない（同じ棋譜の名前が変わっただけ）。

- 直し方: 「盤の中身が変わったか」の判定を1箇所に寄せ、パス単独の読みを消す。
  `entities/game` に述語を置くのが素直（例: `state` から
  `{ path, seq }` を返す `useLoadedKifu()` と、`useResetOrientationOnKifuChange.ts:37-50`
  が持っている3分岐（same / renamed / それ以外）を写した比較関数）。
  そのうえで
  - `KifuStreamList.tsx:317` の依存を `loadedSeq` と「閉じた（`loadedAbsPath === null`）」の
    組に変える（`loadedSeq` だけにすると閉じた回で面が残るので、3分岐がそのまま要る）
  - `Face`（`KifuCommentNote.tsx:21`）と `openComment`（`KifuStreamList.tsx:306`）が
    掴むのをパスではなく `loadedSeq`（＋パス）にし、`:117` の門番も回数で見る

### [MEDIUM] 不変条件を語っている2つのコメントが、この変更で嘘になった

- 場所: `src/entities/game/model/context.ts:14`、`src/entities/game/model/provider.tsx:75`
- 根拠:

  ```ts
  // context.ts:14
  * こちらの値はプリミティブで、動くのは `game_loaded` と `reset_state` のときだけ。
  ```

  ```ts
  // provider.tsx:75（persistIfPossible の門番の説明）
  // `activeKifuPath` だけが進み、`loadedAbsPath` は `game_loaded` でしか動かないので、
  // 次の棋譜が載るまでこの条件は真であり続ける。
  ```

- なぜ問題か: `loadedAbsPath` は `path_renamed` でも動くようになった。
  `types.ts:55` は同じ PR で直っているのに、この2つは残っている。
  とくに `provider.tsx:75` は**門番が効き続ける根拠**として書かれていて、結論
  （E16 のあと書き込みが止まり続ける）は今も正しいが、その理由はもう
  「`game_loaded` でしか動かない」ではなく「橋が載せられた回しか
  `renameLoadedPath` を撃たない」（`GameFileTreeBridge.tsx:51-58`）に変わっている。
  CLAUDE.md の「『〜だから』と書いたら、その条件式がコードのどの行かを指せること」に
  当たらなくなった行。
- 直し方: `context.ts:14` は `path_renamed` を並べる（値がプリミティブで滅多に動かない、
  という分離の根拠自体は変わらないと明記する）。`provider.tsx:75` は理由を差し替え、
  「載せられなかった回は `loadedJkfDataRef` が更新されないので `path_renamed` も来ない」と
  実際に効いている条件で書く。

### [MEDIUM] 「同じ参照＝改名」という前提を守る仕掛けが無い

- 場所: `src/app/providers/bridges/GameFileTreeBridge.tsx:29-37` と `:46-49`、
  前提の相手は `src/entities/file-tree/model/provider.tsx:320-329`
- 根拠:

  ```tsx
  // GameFileTreeBridge.tsx:34
  * 棋譜を開き直す経路（`openKifuNode`）は毎回ディスクから読み直して新しい
  * オブジェクトを作るので、**同じ参照で effect が走るのは改名・移動のときだけ**。
  ```

  ```tsx
  // GameFileTreeBridge.tsx:46
  if (loadedJkfDataRef.current === jkfData) {
    renameLoadedPath(activeKifuPath);
    return;
  }
  ```

- なぜ問題か: この分岐の正しさは、`entities/file-tree` の**別のファイルにある実装詳細**
  （`parseKifuContentToJKF`（`src/entities/kifu/api/parse.ts:104`）が純粋関数で、
  `kifu_opened` が毎回その戻り値を入れる）に丸ごと乗っている。パスごとに解析結果を
  キャッシュする、という自然な最適化を誰かが入れた瞬間、**同じ棋譜を開き直しても
  参照が同じになり、橋は改名だと読んで `loadGame` を撃たない**——盤はメモリの内容の
  まま、ディスクの変更を二度と拾わなくなる（この PR が塞いだ穴の裏返し）。
  file-tree 側にはこの前提を固定するテストが無く、tsc も lint も落ちない。
- 直し方: どちらかで前提を明示する。
  - 安い方: `entities/file-tree` に「同じ node を2回 `openKifuNode` したら
    `jkfData` の参照が変わる」を固定するテストを足す（前提が住んでいる層で守る）
  - 強い方: 参照の同一性をやめ、file-tree が `kifu_opened` で進める開いた回数
    （`active_kifu_reconciled` では据え置く番号）を state に持たせ、橋はその番号を
    控えて比べる。`loadedSeq` と同じ形になり、「参照が同じ」という暗黙の契約が消える

## 見ていない範囲

- SCSS・レイアウト・見た目（担当外）
- Rust 側（`src-tauri/`）と、実際のファイル操作（`renameFile` / `renameDir` / `moveFile`）の
  戻り値。改名が実際にどのパスを返すかは `res.data` を信頼して読んだ
- `docs/` の表（`game.md` の E18 / ※9、`board-orientation.md` の全セル）は
  コードとの整合だけ確認した。表そのものの網羅性は検算していない
- ルートフォルダ自体の改名（`file-tree/model/provider.tsx:494-519`）。
  `setRootDir` → `reconcilePathMutation` の順で、間に `rootDir` を見る effect
  （`:198-212`）が挟まると `kifu_closed` が先に出うるが、これは PR 以前と同じ経路なので
  この差分の所見にはしていない
- 実機での確認はしていない。走らせたのは
  `gameFileTreeBridgeRename.test.tsx` / `reducer.test.ts` / `useBoardOrientation.test.tsx` と
  `gameFileTreeBridge.test.tsx`（4ファイル・49件、緑）。`npm run verify` 全体は未実行

## 依頼された観点への回答（所見にしなかったもの）

- **await を跨ぐ競合**: 今は無い。`loadGame`（`provider.tsx:311-346`）は `async` だが
  中に await が1つも無く、`game_loaded` は `run()` を呼んだ同期の時点で撃たれる。
  ref を書く継続は microtask で、React が次の passive effect を流すのは Scheduler の
  macrotask なので、2回目の effect が割り込む隙が無い。なお `loadGame` が本当に
  await するようになっても、dispatch 順と継続の解決順が一致する限り ref と state は
  同じ順で動く。
- **成功時にだけ控える判断**: 正しい。落ちた回に控えると、`loadedAbsPath` が前の棋譜を
  指したまま `path_renamed` が通り、`persistIfPossible` の突き合わせが成立して
  前の棋譜が改名先へ書ける。テスト「盤に載らなかった棋譜を改名しても…」がその形を
  押さえている。
- **3分岐の穴**: 見つからなかった。`loadedAbsPath` が動く口は `game_loaded`（`loadedSeq` +1）／
  `reset_state`（null・回数据え置き）／`path_renamed`（回数据え置き）の3つだけなので、
  「回数が同じでパスが動いた」は改名にしかならず、閉じる回は片側が null で外れる。
  複数の遷移が1コミットに畳まれても、載せ直しが混ざれば必ず回数が動くので誤判定にならない。
- **再レンダ**: 増えない。改名では `state.jkf` / `state.cursor` / `state.branchPlan` の参照が
  据え置かれるので `cursorView`（`provider.tsx:103`）も `view` も再計算されない。
  以前は `game_loaded` で JKFPlayer ごと作り直していたぶん、むしろ減る。
- **StrictMode**: 壊れないが、重複は防げない。ref を書くのが await の後なので、
  二重実行では2回とも `loadedJkfDataRef.current === null` を見て `loadGame` が2回走り、
  `loadedSeq` が2進む。同じ `jkfData` を2回載せるだけなので状態は壊れず、
  `loadedSeq` は等値でしか比べていないので向きの判定にも影響しない。

## lint / hook で強制できるもの

- **`state.loadedAbsPath` を effect の依存に単独で入れている箇所**（HIGH の1件目）は
  oxlint の `no-restricted-syntax` で機械化できる。合図として使ってよいのは
  `loadedSeq` と組にしたときだけ、という規則にして、例外は述語フック経由に寄せる。
  ただし `FileNode.tsx:41` や `useHeaderCenterInfo.ts:48` のように**パスそのものが要る**
  読み手があるので、規則を当てるのは「依存配列に載っている」形に限ること。
- **参照の同一性への依存**（MEDIUM の3件目）は lint では無理。テストで固定する側。
- 2件目のコメント腐りは機械化しない。同じ穴を2回踏んでから考える。
