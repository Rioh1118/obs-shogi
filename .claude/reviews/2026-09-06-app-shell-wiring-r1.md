# レビュー app-shell-wiring ラウンド1

- 日付: 2026-09-06
- 範囲: `git diff origin/main...HEAD`（13ファイル / `src/app` `src/pages` `src/widgets/sidebar` `src/features/board-orientation` `src/entities/search` `docs/spec` `docs/state-transitions`）
- 走らせた reviewer: architecture / react / robustness / comment / perf / ui / oss-hygiene（7）
- 対象コミット: `b88db640`（`origin/main` へ rebase 済み）

## 所見

### [HIGH] r1-01 `openInFlightRef` が根を見ないので、索引の張り直しが黙って捨てられる

- 場所: `src/entities/search/model/provider.tsx:92`、同 `:126-131`
- reviewer: architecture / react / robustness（3人が独立に到達）
- 根拠: `if (openInFlightRef.current) return openInFlightRef.current;` は `rd` を見ていない。
  新しい effect は根が変わった一度きりしか撃たないので、その一発が in-flight の Promise に吸われると二度目が無い。
- なぜ問題か: `/ws` の open が飛行中に根が `/other` へ変わると、`open_start` も `invoke` も起きないまま
  古い Promise が返る。以後 `rootDir` も `openProject` の同一性も変わらないので、そのセッション中ずっと
  `/other` は索引されない。検索は成功し、結果だけが実物と食い違う。
  飛行中の窓は実在する（`src-tauri/src/search/commands.rs:183` の `scan_kifu_files` は同期に全走査）。
  到達経路は2つ確認された——設定からワークスペースを選び直す、**ルートフォルダを改名する**
  （`src/entities/file-tree/model/provider.tsx:446-451` の `isRootRename` → `setRootDir`。こちらは reload しない）。
- 直し方（reviewer 提案）: `openInFlightRef` を `{ rootDir, promise } | null` にし、根が違うなら畳まない。

### [HIGH] r1-02 `activeKifuPath` は「盤に載っている棋譜」ではない。読み込みが落ちると盤の中身が変わらないまま向きが戻る

- 場所: `src/features/board-orientation/model/useBoardOrientation.ts:16,22-26`
- reviewer: robustness
- 根拠: `activeKifuPath` は file-tree が「開いた」と言っているパス。盤の中身は `entities/game` の
  `state.jkf` / `state.loadedAbsPath`。`GameFileTreeBridge` → `loadGame` → `buildPlayer` が投げると
  `set_error` だけが積まれ、`game_loaded` は出ない（`src/entities/game/model/provider.tsx:307-320`）。
  `state.error` の読み手は0。
- なぜ問題か: 構文としては読めるが盤に載せられない棋譜（`preset: "OTHER"` で `initial.data.board` が壊れている形）を
  クリックすると、`openKifuNode` は `Ok` を返すので選択も `activeKifuPath` も動くが、盤は前の棋譜のまま。
  そこで `pov` だけが落ちる。**この PR が潰したはずの症状（何も言われないのに盤が黙って回る）が、
  合図を1段先へ移しただけで残っている。** `docs/state-transitions/board-orientation.md:77` の不変条件1 がこの経路で破れる。
- 直し方（reviewer 提案）: 合図を `useGame().state.loadedAbsPath` にする。`game_loaded` でしか動かないので
  定義上「盤に載っている棋譜」そのもの。`features → entities` なので import 方向にも反しない。

### [HIGH] r1-03 `docs/spec/screens/app-layout.md` が現物とずれたまま残っている

- 場所: `docs/spec/screens/app-layout.md:3`, `:54-55`, `:82`
- reviewer: comment / ui / oss-hygiene（3人）
- 根拠: `:55` は「中身は `<Outlet />` で、いま入るのは `/app/panel/filetree` だけ」。現物の `Sidebar` は
  `children` を受け取るだけで、`Outlet` は `src/pages/AppLayout.tsx:59`。`Sidebar.tsx:7-9` の doc は
  「置き場は `AppLayout` の側」と**正反対**を書いている。
  `:82` の「別の棋譜を開く → `pov` を落とす」は、`navigation-map.md:130-132` だけが直っていて、
  同じ挙動について2つの spec が違うことを言っている。`:3` の対象ファイル一覧に `src/features/board-orientation/` が無い。
- なぜ問題か: `Outlet` の置き場を移したのがこの変更の主眼なのに、それを名指ししている spec が古い。
  CLAUDE.md の「触った画面の仕様が現物と違うようになったら、同じ PR で直す」に正面から反する。

### [HIGH] r1-04 状態遷移表の `(B0, E3)` は経路が無い

- 場所: `docs/state-transitions/board-orientation.md:60`, `:67-68`（※1）, `:89`, `:92`
- reviewer: comment / oss-hygiene / robustness（3人）
- 根拠: `pov` を書く口は `AnalysisPaneHeader` の `handleTogglePov` 1つだけで、その `AnalysisPane` は
  `AppLayout.tsx:28,63` の `hasFile`（`gameView.player?.shogi`）が真のときしか描かれない。
  `activeKifuPath === null` なら `GameFileTreeBridge.tsx:11-15` が必ず `resetGame()` するので `player` は消える。
  つまり B0 ではボタンが DOM に存在しない。
- なぜ問題か: 「埋まっていないセル」は実在する未検証経路の唯一の出所。偽物が混ざると一覧そのものの信用が落ちる。
  ※1 の「押せてしまうこと自体は直していない」を読んだ人は、存在しない不具合に `disabled` を足しに行く。

### [HIGH] r1-05 索引を開くのに失敗すると「復元中」のまま固定され、検索は「一致: 0 / 完了」を返す

- 場所: `src/entities/search/model/reducer.ts:126-131`、`src-tauri/src/search/commands.rs:58-67,183,191`、
  `src/features/settings/ui/tabs/WorkspaceTab.tsx:66`、`src/features/position-search/ui/PositionSearchStatusBar.tsx:16-20`
- reviewer: robustness
- 根拠: `open_project` は入口で `IndexState::Restoring` を emit してから `scan_kifu_files` で落ちうる。
  `Building` の emit まで届かないので `state.index.state` は `"Restoring"` のまま二度と動かない。
  `open_error` は `index` を触らない。`openError` の読み手は0（数えて確認）。
- なぜ問題か: 設定画面はスピナー付きの「復元中」を永久に表示し、局面検索は「一致: 0 / 完了」と出す。
  利用者は「この局面は棋譜に無い」と読む。復帰経路が無い（`openProject` を呼ぶ UI は0件、effect の依存も動かない）。
- 直し方（reviewer 提案）: (a) reducer の `open_error` で `index` を `initialState.index` に戻す、
  (b) `WorkspaceTab` に `openError` の表示と「索引を作り直す」を置く。

### [MEDIUM] r1-06 購読が張り終わる前に `open_project` が飛ぶので、`index_state` の最初の1発を取りこぼしうる

- 場所: `src/entities/search/model/provider.tsx:51-84`（購読 effect）, `:126-131`（open effect）
- reviewer: react
- 根拠: `listenSearchEvents` は `await listen(...)` の連なりで、effect の宣言順は購読が「始まる」ことしか保証しない。
  一方 `open_project` は入口で即 `Restoring` を emit する（`src-tauri/src/search/commands.rs:58-67`）。
- なぜ問題か: 取りこぼすと `state.index.state` は `"Empty"` のままで、`PositionSearchModal.tsx:54-56` の
  `indexStale` が false になる。復元中に検索すると0件が「完了・最新」として出る。
- 直し方（reviewer 提案）: 購読の完了を state に出し、open をそれに掛ける（`isListening`）。

### [MEDIUM] r1-07 「唯一の再索引経路」と宣言した直後に、context と barrel が `openProject` を公開したまま残り、呼び出し元は0

- 場所: `src/entities/search/model/provider.tsx:225,238`、`src/entities/search/model/types.ts:87`、`src/entities/search/index.ts:43`
- reviewer: architecture / react / comment（3人）
- 根拠: `openProject` の呼び出し元は `entities/search` 配下のみ。スライス外は**0件**（この PR で `AppLayout` の1件が消えた）。
  それでも口は2つ開いている——`usePositionSearch().openProject` と、provider を通らず `invoke` を直接叩く
  barrel の再エクスポート。
- なぜ問題か: 後者を使うと `open_start` の dispatch も in-flight の重複排除も効かないまま Rust 側の索引だけが差し替わる。
  `entities/file-tree/index.ts` は「ここに並ぶのはスライスの外に呼び出し元があるものだけ」を規約として書いている。

### [MEDIUM] r1-08 `pov` を書く口が `features/board-orientation/` の外に残り、スライスが読み専用の半分しか持っていない

- 場所: `src/features/board-orientation/model/useBoardOrientation.ts:24,28`、`src/widgets/analysis-pane/ui/AnalysisPaneHeader.tsx:20,87-89`
- reviewer: architecture / react
- 根拠: `params.pov === "gote"` という同じ式が2箇所にある。既定を `undefined` で表す取り決めも2箇所に分かれた。
- なぜ問題か: スライス名は `board-orientation` なのに向きを**変える**責務が入っていない。符号化を変えたい人は
  grep で2箇所を見つけなければならず、片方だけ直すと「ボタンは回るがリセットが効かない」形で静かに壊れる。

### [MEDIUM] r1-09 entities のプロバイダが起動手順を持ち、`app/providers/gates` という既存の置き場を外している

- 場所: `src/entities/search/model/provider.tsx:4,39,89,112,125-131`（対比: `src/app/providers/gates/FileTreeRootGate.tsx`）
- reviewer: architecture
- 根拠: この repo はスライス間の配線を `app/providers/gates`（値を prop で流す）と `bridges`（effect で繋ぐ）に集めてある。
  `FileTreeRootGate` は `config?.root_dir` を読んで `FileTreeProvider` に prop で渡す形。今回の effect はそれと同型なのに
  entities の中にある。
- なぜ問題か: (a) `entities/search → entities/app-config` が「既定値の参照」から「起動シーケンスの所有」に格上げされた、
  (b) `PositionSearchProvider` を `AppConfigProvider` の下に置く制約が `RuntimeProviders.tsx` から読めない、
  (c) テストが `@/entities/app-config` を丸ごとモックしないとスライスを起動できない。
  コメントが挙げる「どの画面が描かれているかに乗るのを避ける」は gate でも同じく満たされる。

### [MEDIUM] r1-10 `widgets/sidebar` だけが `ui/` セグメントを持たず、`AppLayout` からの import 経路も1つだけ相対パス

- 場所: `src/widgets/sidebar/Sidebar.tsx`, `Sidebar.scss`、`src/pages/AppLayout.tsx:3`
- reviewer: architecture
- 根拠: widgets 7スライスのうち `sidebar/` だけがスライス直下に `.tsx` を置いている。
  `AppLayout.tsx:3` だけが `../widgets/sidebar/Sidebar` の相対 import で、同じファイルの他の widget（12-14行）は
  全て `@/widgets/<slice>/ui/<X>`。
- なぜ問題か: セグメント名は公開境界と lint override の単位（`vite.config.ts:52-78`、`src/__tests__/sliceBarrels.test.ts:28`）。
  `Sidebar` は器へ役割が変わり `lib` を足す余地が出たが、置き場がスライス直下だと `ui` と区別できない。

### [MEDIUM] r1-11 テストの doc に消えたコードの説明（変更の経緯）が入っている

- 場所: `src/entities/search/model/__tests__/openOnRootChange.test.tsx:8-11`
- reviewer: comment
- 根拠: 「これを画面の `useEffect` に置いていたときは、張り直しが2つの偶然に乗っていた」。
- なぜ問題か: CONTRIBUTING.md の「消したコードの説明は履歴の仕事」に該当する。読み手はこの差分の当事者ではないので、
  「画面の `useEffect`」がどのファイルの何を指すのか辿れない。同じ差分でも `provider.tsx:118-120` と
  `useBoardOrientation.ts:10-13` は仮定形で書けている。

### [MEDIUM] r1-12 「ここが唯一の再索引経路」は字義では誤りで、かつ何も強制していない

- 場所: `src/entities/search/model/provider.tsx:116`
- reviewer: comment
- 根拠: 索引の更新は Rust 側の watcher も行う（`src-tauri/src/search/commands.rs:135-169` の
  `start_watcher_and_debounce`、`project_manager.rs:150-160` の `update_if_epoch`）。
  「唯一」を保っているものが何も無い（barrel も context もこの能力を配っている）。
- なぜ問題か: 「再索引」と書くと watcher の差分反映まで含んで読めるので主張が偽になる。
  強制のない「唯一」は、次の人が根拠として使えない。

### [MEDIUM] r1-13 `App.tsx` のコメントが挙げる理由は、そこにある境界（`BootstrapProviders`）では成り立たない

- 場所: `src/app/App.tsx:18-24`
- reviewer: comment
- 根拠: `<UpdaterScreen />` の直前にある provider は `BootstrapProviders` = `AppConfigProvider` だけで、
  これは状態にかかわらず必ず children を描く（`src/entities/app-config/model/provider.tsx:144`）。
  画面を畳んでいるのは `src/app/routing/guards/RequireRootDir.tsx:13-15` の `Navigate`。
  （「`useUpdater` は context も router も要らない」の部分は現物で確認され、正しい）
- なぜ問題か: コメントが名指しした境界と、その条件を実際に持つ境界が別。読んだ人は `BootstrapProviders` の中に
  分岐を探すが存在しない。逆に「provider の外」を守っても `RuntimeShell` の中へ移せば同じ事故が起きる。

### [MEDIUM] r1-14 effect の doc が「根が決まったら開く」と約束しているが、`openProject` は in-flight を短絡する

- 場所: `src/entities/search/model/provider.tsx:116-124`（doc）と `:92`（短絡）
- reviewer: comment
- 根拠: r1-01 の挙動が doc のどこにも書かれていない。読み手は「根が変われば必ず開き直す」と読む。
- 直し方: 挙動を直さないなら、doc に前提として明記する。

### [MEDIUM] r1-15 同じ概念に `rotate` / `isGotePov` / `pov` の3つの名前があり、`rotate` は真偽値なのに動詞形

- 場所: `src/features/board-orientation/model/useBoardOrientation.ts:28`、`src/pages/AppLayout.tsx:25`、
  `src/widgets/analysis-pane/ui/AnalysisPaneHeader.tsx:20`
- reviewer: comment
- 根拠: リポジトリの真偽値は `isSidebarOpen` / `hasFile` / `isActive` と `is` / `has` で揃っている。
  `const { rotate } = useBoardOrientation()` は「回す関数」に見える。

### [MEDIUM] r1-16 `shownKifuRef` が保持しているのはパスだが、名前が型を裏切っている

- 場所: `src/features/board-orientation/model/useBoardOrientation.ts:19-20`
- reviewer: comment
- 根拠: file-tree 側の同種の ref は全て `...PathRef` で揃っている（`activeKifuPathRef` /
  `pendingSelectedPathRef` / `pendingRevealPathRef`）。名前を直せば行末コメントの半分は要らなくなる。

### [MEDIUM] r1-17 同じ「なぜ」が3〜4箇所に複製されている

- 場所: 盤の向き = `useBoardOrientation.ts:10-13` / `useBoardOrientation.test.tsx:16-20` /
  `docs/state-transitions/board-orientation.md:15-21` / `docs/spec/navigation-map.md:130-132`。
  索引 = `provider.tsx:118-120` / `openOnRootChange.test.tsx:8-11`（ほぼ逐語）
- reviewer: comment
- なぜ問題か: 判断が変わったときに直す場所が3〜4つあり、1つ忘れると腐る。
  **この差分自体が `docs/spec/screens/app-layout.md:55` を直し忘れて r1-03 を生んでいる。**

### [MEDIUM] r1-18 `?pov=sente` が状態表にもフックの doc にも出てこない

- 場所: `docs/state-transitions/board-orientation.md:28-29`、`src/shared/lib/router/useURLParams.ts:13,37`
- reviewer: comment
- 根拠: `PovType = "sente" | "gote"` はパーサが3値を受けるが、`"sente"` を書く生産者はリポジトリに1つも無い。
  表の判定は `params.pov === undefined`（B1）と `=== "gote"`（B2）だけで、`"sente"` はどちらにも当たらない。
- なぜ問題か: 同じ状態に2つの表現がある型が `shared/` に残っている。表を根拠に条件を写す人が
  `params.pov === undefined` を「先手が手前」の判定にすると、`sente` が来たとき盤と判定がずれる。

### [MEDIUM] r1-19 「埋まっていないセル」の `(B1, E1)` は、実装上そもそも起きない経路を指している

- 場所: `docs/state-transitions/board-orientation.md:90`
- reviewer: oss-hygiene
- 根拠: 同じパスを開き直しても `activeKifuPath` は変わらないので `useBoardOrientation.ts:23` の ref 比較で抜ける。
  「検索結果からの遷移は別経路」も誤り——`usePositionHitNavigation` は `selectNodeByAbsPath` を呼び、
  その中に `isAlreadyActive` の関門がある（`src/entities/file-tree/model/provider.tsx:676-683`）。
- なぜ問題か: 表本体の `(B1, E1)` は別の棋譜を開いた場合の話で、同じラベルで2つの違う事象を指している。

### [MEDIUM] r1-20 B3 の行が表の列数に足りず、6セルが空欄のまま残っている

- 場所: `docs/state-transitions/board-orientation.md:58-63`
- reviewer: oss-hygiene
- 根拠: 見出し行は9セル（行ラベル＋E1〜E8）だが B3 の行は8セル。凡例は `—` を定義しているのに B3 の E2〜E7 は空欄。
- なぜ問題か: 空欄（判断を書いていない）と `—`（起きない）と ✓ 無し（未検証）が同じ見た目になっている。

### [MEDIUM] r1-21 ✓ の根拠として挙げたテストのパスがリポジトリ起点でないため、`docsSourcePaths` の検査を素通りする

- 場所: `docs/state-transitions/board-orientation.md:56`
- reviewer: oss-hygiene
- 根拠: `src/__tests__/docsSourcePaths.ts:25-54` は `ROOTS = ["", "src/", "src-tauri/src/"]` を前置して実在を探し、
  解決しない綴りは `LAYER`（`^(app|pages|widgets|features|entities|shared)/`）に当たらないので追跡対象から外れる。
  `model/__tests__/useBoardOrientation.test.tsx` はここに該当しない。
  同じ役の `docs/state-transitions/engine-position-sync.md:40` はフルパスで書かれていて検査に載っている。
- なぜ問題か: 表の ✓ の意味はすべてこの1ファイルに依存している。テストを移動・改名しても verify は緑のまま。

### [MEDIUM] r1-22 サイドバーの開閉が「いま満たしていないこと」と「意匠」の両方に書かれている

- 場所: `docs/spec/screens/app-layout.md:103`、`src/pages/AppLayout.tsx:21-23`
- reviewer: oss-hygiene
- 根拠: spec は「**サイドバーの開閉が保存されない。** リロードで必ず開く」を未達の欠陥として挙げ、
  コードは同じ事実を「これは意匠」と書いた。`docs/spec/README.md:72` は「いま満たしていないこと — issue 番号つき」と
  定めているが、この行に issue 番号は無い。
- なぜ問題か: コメントで意匠だと宣言した目的（同じ提案が繰り返し出るのを止める）が spec 側から打ち消される。

### [MEDIUM] r1-23 `if (!rootDir) return;` に変異を当てても、足したテストは落ちない

- 場所: `src/entities/search/model/provider.tsx:127`、`src/entities/search/model/__tests__/openOnRootChange.test.tsx:47-51`
- reviewer: react（変異を実際に当てて確認）
- 根拠: このガードを消しても `openProject` が `:90` の `if (!rd) throw` で先に投げ、`.catch` が飲むので API は呼ばれない。
  ガード1行が無検査のまま。
- なぜ問題か: 「根が無いうちは開かない」は別の理由で通っている。

### [MEDIUM] r1-24 「ワークスペースを変えたら開き直す」テストは、実装が何であっても通る

- 場所: `src/entities/search/model/__tests__/openOnRootChange.test.tsx:63-77`
- reviewer: architecture / robustness（2人）
- 根拠: `mockResolvedValue` が即時 resolve し `await act` が挟まるので、根を変える時点で in-flight は必ず空。
  r1-01 の窓を踏まない。**テスト名だけが保証を主張している状態。**

### [MEDIUM] r1-25（範囲外・SCSS）`--kifu-w` が2ファイルで別の意味で定義され、棋譜ペインの内側だけ古い幅で描かれる

- 場所: `src/pages/AppLayout.scss:76,104,145-149`、`src/widgets/kifu-stream/ui/KifuStreamList.scss:4-9,80`
- reviewer: ui
- 根拠: `.kifu` が自分の上で `--kifu-w: 29rem` を再定義するので、`.workspace` の `clamp(...)` は内側では見えない。
  1280px 幅で約4rem ずれる。

### [MEDIUM] r1-26（範囲外・SCSS）`AppLayout.scss` が widget のルートクラスを名指しで上書きし、その宣言がどれも重複か空振り

- 場所: `src/pages/AppLayout.scss:162-177`
- reviewer: ui
- 根拠: `border` / `box-shadow` / `background` は `.analysis-pane` に元の宣言が1つも無いので打ち消していない。
  `height` / `min-height` / `width` は widget 側の重複。

### [MEDIUM] r1-27（範囲外・SCSS）解析ペインのツールバーで `--active` が実際には何も変えず、向きのトグルにはオン状態の見た目が無い

- 場所: `src/widgets/analysis-pane/ui/AnalysisPaneHeader.scss:131-140`、同 `.tsx:124-131,162-172`
- reviewer: ui
- 根拠: `.analysis-header__icon` が svg に直接 `color` を宣言しているので親の `--active` の `color` は継承に負ける。
  向きのトグルは `aria-pressed` しか持たず、`?pov=gote` が付いていても見た目が素の状態と同一。

### [MEDIUM] r1-28（範囲外・SCSS）閉じたサイドバーの `transition` は一度も走らず、仕切り線が2本引かれている

- 場所: `src/pages/AppLayout.scss:26,29-31,33-38`、`src/widgets/sidebar/Sidebar.scss:21`
- reviewer: ui
- 根拠: `.app-layout__sidebar-slot` の `width` は指定されておらず、実際に変わるのは親の `grid-template-columns` と
  登録されていないカスタムプロパティ。どちらも遷移しない。仕切りはスロットと `.sidebar` の2箇所で別々の直値。

### [LOW] r1-29（範囲外・SCSS）メディアクエリの breakpoint が13種類の直値で散っていて、そのすべてが対象幅（1280px 以上）では発火しない

- 場所: 13ファイル（`EngineTab.scss:54,234` ほか。報告書冒頭の ui reviewer 出力を参照）
- reviewer: ui
- 根拠: `src/__tests__/scssScale.ts:156` が `@media` の条件部を意図的に対象外にしているので、増えても機械では止まらない。

## 重複・矛盾した所見

- **r1-01 は3人（architecture / react / robustness）が独立に到達した。** 深刻度も一致。
  ただし「フロントだけで直せるか」で判断が割れる——robustness は
  「Rust 側は `store.restart` と epoch で古い代を弾くので並走してよい」と書き、
  architecture も同じ方向。この PR の作者は「Rust の `open_project` を2本走らせてよいかの判断が要る」として
  issue へ送る判断をしている。**両論を残す**。issue 本文に reviewer 側の根拠を写す。
- **r1-03 / r1-04 も3人が独立に到達。** 事実としての確度は高い。
- **r1-02 と r1-04 は同じ事実の裏表。** 「向きの合図として何を見るべきか」と
  「ボタンが描かれる条件は `hasFile`（`state.jkf`）であって `activeKifuPath` ではない」。
  r1-02 を直すと r1-04 の表の書き換えも同時に決まる。
- **r1-01 と r1-06 は同じ effect に集まっているが、根が違う。** 前者は重複排除の鍵、後者は購読との順序。
  独立に直せる。
- **矛盾: r1-07（`openProject` を公開面から外す）と r1-05 の直し方(b)（`WorkspaceTab` に再索引ボタンを置く）。**
  後者は context の `openProject` を必要とする。r1-05 は範囲外（issue）なので、
  いま口を閉じ、issue 側で必要になったら開き直す——という順で矛盾しない。issue 本文にこの経緯を書く。
- perf-reviewer は**所見なし**。数えた結果として「起動時の `open_project` は1回」
  「`AppLayout` の購読は1本減って増えていない」「`Sidebar` の unmount は差分では変わっていない」を報告している。
  これは r1-01 の「二重発火はしない」とも整合する（問題は発火回数ではなく重複排除の鍵）。

## 見ていない範囲

- Rust 側の索引・watcher の実装（`search/build.rs`、`store/`、epoch 制御）。読んだのは `search/commands.rs` の
  `open_project` のみ。根を切り替えたとき古い watcher がどう畳まれるかは追っていない
- `AppModalLayer` 配下の各モーダルの中身。`updateParams` が `pov` 以外を触らないことは確認したが、
  モーダル側から `pov` を触る経路が無いことは grep の範囲でしか見ていない
- `docs/state-transitions/` の他の表（`app.md` `file-tree.md` `game.md`）の内容の正しさ。
  `file-tree.md` は E10 / E11 の番号が実在することだけ確認
- `docs/spec/screens/` は `app-layout.md` と `analysis-pane.md` の前半のみ通読。他は grep で当たった行だけ
- 実ブラウザでの描画確認（E2E は無い）。閉じたときの 1px と `transition` が走らないことは CSS の解釈から
- ウィンドウ高さ 800px 相当での縦方向の詰まり（既知の #32 と重なる）
- `AnalysisBridge` / `EngineRuntimeBridge` / `GamePersistenceGate` / `StudyPositionsProvider` の内部

## lint / hook で強制できるもの

- **r1-21 は既存の `src/__tests__/docsSourcePaths.ts` がそのまま拾う。** フルパスで書くだけで機械が守る側に入る。
  さらに `docs/state-transitions/` 内に限って「`.ts` / `.tsx` で終わる綴りは必ず解決できること」を要求すれば同種の抜けは塞げる
- **r1-20（表の列数不一致・空欄）は機械で防げる。** `src-tauri/tests/state_transition_cells.rs` の `row_cells` / `section` が
  既に表を割っているが、`table_source()` が `game-session.md` 決め打ちなので走査に変えるのが前提
- **r1-07（呼び出し元の無い barrel export）** は `src/__tests__/sliceBarrels.test.ts` と同じ形の走査で落とせる。
  `entities/file-tree/index.ts` が規約として書いているのに機械が見ていない
- **r1-10（スライス直下に `.tsx` を置かない）** は `vite.config.ts` の override か横断テストで固定できる。現状 7分の1 の逸脱
- **r1-09（同一層の横断 import）** は `upperLayers()` が上位層しか禁じないので素通りする。
  スライス別 override で「同層の他スライスは allowlist」に寄せれば差分として見える
- **r1-11（経緯の混入）** は `src/__tests__/commentHistory.test.ts` の `HISTORY_WORDS` に `"ていたときは"` を足せば止まる
- **r1-25（カスタムプロパティの多重定義）** は SCSS を舐めて `--name:` の宣言ファイル数を数えれば落とせる
- r1-01 / r1-02 / r1-05 / r1-24 は機械では防げない。r1-01 と r1-24 は**テストの形**（deferred で in-flight 窓を作る）でのみ固定できる

## 修正計画（r1 → r2）

> **前提の変化。** r1 を書いた後、同じブランチに `AppLayout` の所有権を整理する
> 3件（＋仕様書の追随1件）が積まれた（`664b7efd` `baa2cbde` `29e324aa` `6678845a`）。
> r1 の reviewer はこれらを見ていない。**r2 の範囲は差分全体**にする。

### 束（同じ根から出ている所見）

- **向きの合図**: r1-02 → r1-16（合図を変えると ref ごと名前が決まる）、r1-02 → r1-04
  （どちらも「ボタンが描かれる条件は棋譜の有無であって `activeKifuPath` ではない」の裏表）
- **索引の公開面**: r1-07 → r1-12（口を閉じると「唯一」の主張の半分が消え、残る半分＝watcher の
  件だけ書き直しになる）
- **索引の置き場**: r1-09 → r1-23（`rootDir` を prop にすると `openProject` の
  `if (!rd) throw` が消え、ガードの変異が初めてテストに届く）
- **向きの語彙**: r1-08 → r1-15（書く口を寄せると、戻り値の名前をその場で決めることになる）
- **spec の腐り**: r1-03 の一部（L0 の判定・盤の外の判定）は `6678845a` と `29e324aa` で
  既に解消済み。**残っているのは `:54-55` の `Outlet` と `:82` の `pov` の2行**

### このラウンドで直すもの

| 順  | 所見                       | なぜこの順か                                           | この直し方で壊しうるもの                                                                                                                                   |
| --- | -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | r1-21 表のテストのパス     | 機械（`docsSourcePaths`）が守る側に入れるのが最初      | パスを間違えるとラチェットが赤くなる。**赤くなること自体が期待**なので緑を確認する                                                                         |
| 2   | r1-02 合図を盤の中身へ     | 束の先頭。門番の向きを変えるので積み上がる前に         | `loadedAbsPath` は `game_loaded` でしか動かない。**改名（E7）でも `loadGame` が走り直す**ので (B2,E7) は変わらない見込み——変わるなら表の既知セルが嘘になる |
| 3   | r1-16 ref の名前           | r1-02 の後。合図が変われば ref ごと書き直す            | 表の B0 / B3 の判定に綴りが出ている。doc を落とすと表が実装を指さなくなる                                                                                  |
| 4   | r1-04 `(B0, E3)` を落とす  | r1-02 と同じ事実。表の嘘を先に潰す                     | `—` にすると「埋まっていないセル」が2件になる。`:92` の「いずれも実装上は経路がある」も直さないと矛盾する                                                  |
| 5   | r1-19 `(B1, E1)` の説明    | 同じ表の同じ節。4 の直後                               | 説明を変えるだけ。E6 の行と食い違わせない                                                                                                                  |
| 6   | r1-20 B3 行のセル数        | 同じ表。列を揃えてから他が読む                         | `—` を埋めると「起きない」と宣言することになる。B3 は次のエフェクトで必ず解消するので成立するが、根拠を注に残す                                            |
| 7   | r1-03 spec の残り2行       | 画面の仕様。CLAUDE.md が同じ PR で直せと言っている     | `:82` をリンクに置き換えると spec 単体で読めなくなる。1行の要約は残す                                                                                      |
| 8   | r1-22 開閉の spec と code  | 同じファイル。7 の直後                                 | 「いま満たしていないこと」から外すと、**本当に直したくなったときに issue の起点が無くなる**。意匠だと書く以上それでよい                                    |
| 9   | r1-06 購読を待ってから開く | 失敗経路と門番。修正が積み上がる前に                   | `isListening` を足すと provider のレンダが1回増える。**開く回数が変わっていない**ことを数える                                                              |
| 10  | r1-07 公開面から外す       | 束の先頭。11 の前提                                    | barrel の再エクスポートを落とすと、**外から `invoke` を直接叩く経路が消える**。呼び出し元は0なので影響は無いはずだが tsc で確かめる                        |
| 11  | r1-12 「唯一」の文言       | r1-07 の後で書き直してから取る                         | watcher の件を書き足すとコメントが長くなる。**doc の複製（r1-17）と衝突させない**                                                                          |
| 12  | r1-09 gate へ出す          | 束の先頭。13 を消す                                    | `PositionSearchProvider` の signature が変わる。`RuntimeProviders` の入れ子順を間違えると `useAppConfig` が throw する                                     |
| 13  | r1-23 ガードの無検査       | r1-09 の後。prop になって初めて変異が届く              | 届かないままなら、テストではなく**型**で塞ぐ（`rootDir: string`）                                                                                          |
| 14  | r1-14 in-flight を doc へ  | 挙動は issue へ送るので doc で埋める                   | issue 番号を伴わせる。番号が無いと `TODO` のラチェットに掛かる                                                                                             |
| 15  | r1-24 テスト名の過大主張   | 14 と同じ根。名前だけ現物に合わせる                    | 名前を弱めると、**issue が直ったときに強い名前へ戻す手掛かりが消える**。issue 番号をテストの doc に書く                                                    |
| 16  | r1-08 書く口を寄せる       | 束の先頭。17 を決める                                  | `AnalysisPaneHeader` が feature を読む（widgets → features、下向き）。トグルの挙動は `undefined` ⇄ `"gote"` のまま                                         |
| 17  | r1-15 `rotate` の名前      | r1-08 の後                                             | `GameBoard` の中の綴りが変わる。SCSS のクラス名（`game-board--rotated`）は**変えない**                                                                     |
| 18  | r1-18 `?pov=sente`         | 型を狭めるので 16/17 の後                              | `PovType` から `"sente"` を落とすと、**URL に `?pov=sente` を打った人は既定に落ちる**。書き手は0なので実害は無い                                           |
| 19  | r1-13 `App.tsx` の境界     | 独立                                                   | 名指しを `RequireRootDir` に変えると、**その guard を動かした人がこのコメントを直す責任を負う**                                                            |
| 20  | r1-11 経緯の混入           | 独立                                                   | 仮定形に直すだけ                                                                                                                                           |
| 21  | r1-17 「なぜ」の複製       | 最後。他の修正で本文が動くので、動き終わってから寄せる | 本体を1箇所に寄せると、**テストだけ読む人が理由に辿り着けなくなる**。指す先を必ず書く                                                                      |
| 22  | r1-10 `sidebar/ui/`        | 独立。ファイル移動なので他と混ぜない                   | `AppLayout.tsx:3` の相対 import が `@/` になる                                                                                                             |

### 直さないもの

| 所見                                     | 行き先                      | 理由                                                                                                                                                                              |
| ---------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1-01 in-flight が根を見ない             | **issue**（`/write-issue`） | 作者が「フロントだけでは直せない（Rust の `open_project` を2本走らせてよいかの判断が要る）」として送り先を決めている。reviewer 3人の「並走してよい」という根拠は issue 本文へ写す |
| r1-05 開くのに失敗すると「復元中」で固定 | **issue**                   | 範囲外。F-17（`openError` の読み手0）とは別の事実——`index.state` が嘘をつく。reducer と `WorkspaceTab` に跨る                                                                     |
| r1-25 `--kifu-w` の二重定義              | `docs/IDEAS.md`             | 範囲外。この PR は SCSS を1行も触っていない                                                                                                                                       |
| r1-26 page が widget を上書き            | `docs/IDEAS.md`             | 同上                                                                                                                                                                              |
| r1-27 `--active` が効かない              | `docs/IDEAS.md`             | 同上。ただし r1-08 で向きのトグルを触るので、**r2 で再指摘されたら範囲内へ引き上げる**                                                                                            |
| r1-28 `transition` が走らない            | `docs/IDEAS.md`             | 同上                                                                                                                                                                              |
| r1-29 breakpoint の直値                  | `docs/IDEAS.md`             | 同上。LOW                                                                                                                                                                         |

### 対象そのものを疑ったか

**所見が `entities/search/model/provider.tsx` に集まっている。** 24件中7件
（r1-01 / r1-06 / r1-07 / r1-09 / r1-12 / r1-14 / r1-23）が同じ100行に出た。
`docs/state-transitions/board-orientation.md` にも5件（r1-04 / r1-18 / r1-19 / r1-20 / r1-21）。

provider に集まっている理由は**1つの機構に3つの役が乗っている**こと——
「根を知る」「開く」「開いている最中を1本に畳む」。落とす案として、
r1-09（根は prop で受け取る）＋ r1-07（開く口を公開しない）を先に入れると、
残るのは「畳む」だけになり、r1-01 の issue はその1点に絞れる。
**この2件を順の10・12に置いたのはそのため。**

表に集まっているのは、表が実装より先に書かれて現物と1度も突き合わされていないから。
4〜6で列と嘘を潰した後、**r2 で表そのものを reviewer に読ませ直す**。

### 次ラウンドの焦点

1. **`loadedAbsPath` へ合図を変えたことで、改名（E7）と「同じ棋譜の開き直し」の
   挙動が変わっていないか。** 既知セル `(B2, E7)` が嘘になっていないか
2. **`isListening` を足したことで、索引を開く回数が変わっていないか**
3. **`PositionSearchProvider` を prop 受け取りにしたことで、`RuntimeProviders` の
   入れ子順に新しい制約が入っていないか**
4. **`openProject` を公開面から外したことで、barrel を読んでいた他の経路が壊れていないか**
5. **`PovType` から `"sente"` を落としたことで、`useURLParams` の他の読み手への影響**
6. **新しく積んだ4コミット**（`AppLayout` の所有権整理）— r1 の reviewer は見ていない。
   `BoardOrientationBridge` の置き場と `RuntimeProviders` の入れ子順、
   `GameView.hasKifu` を entities に足したこと、
   `features/clear-board-selection` が盤の DOM 語彙を持つこと、
   足したテスト6ファイルがモックを見ているだけになっていないか
7. **21 で「なぜ」を寄せた結果、指す先を失った説明が無いか**

### 検証の見積り

直すもの22件。`docs/state-transitions/` を触るのは 1〜6 の6件
（`verify:rust` 約2分15秒 → 約13分30秒）。残り16件は `verify` のみ（約8秒）。
**合計およそ16分。** 20分を超えないので次ラウンドへ送らない。

## 修正の結果（r1）

| 所見  | 結果     | コミット   | 一行                                                                                                                     |
| ----- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| r1-01 | 見送り   | —          | issue #430 を立てた。判断（`open_project` を2本並走させてよいか）が Rust 側に掛かるため                                  |
| r1-02 | 対応済み | `32b8cfbf` | 合図を `loadedAbsPath` にした。表の軸を3フィールドに直し、E9 を足した                                                    |
| r1-03 | 対応済み | `6f87d903` | `Outlet` の置き場・`pov` の合図・対象ファイルの3点。L0 の判定と盤の外の節は `6678845a` / `29e324aa` で先に解消していた   |
| r1-04 | 対応済み | `3266c136` | `(B0, E3)` を `—` にし、注を「なぜ起きないか」に書き換えた                                                               |
| r1-05 | 見送り   | —          | **既存の issue #403 が同じ事実を扱っている。** 新しく立てず、provider の doc から番号で指した                            |
| r1-06 | 対応済み | `85904620` | `isListening` を足し、購読の完了を待ってから開く。保留できるモックで固定                                                 |
| r1-07 | 対応済み | `2f0ac311` | context 型・value・barrel の3箇所から `openProject` を外した                                                             |
| r1-08 | 対応済み | `66855710` | `toggle` をフックに足し、`AnalysisPaneHeader` はそれを呼ぶだけにした                                                     |
| r1-09 | 対応済み | `4fc5cfba` | `SearchRootGate` を新設し、根を prop で流す形にした                                                                      |
| r1-10 | 対応済み | `9643743a` | `widgets/sidebar/ui/` へ移し、相対 import を `@/` にした                                                                 |
| r1-11 | 解消済み | `4fc5cfba` | テストを prop 受け取りに書き直した際に、doc も仮定形になった                                                             |
| r1-12 | 対応済み | `7a2878ff` | 「唯一の再索引経路」を watcher の存在まで含めて絞った                                                                    |
| r1-13 | 対応済み | `322e713b` | 名指しを `BootstrapProviders` から `RequireRootDir` に直した                                                             |
| r1-14 | 対応済み | `7a2878ff` | in-flight の短絡を doc に書き、`TODO(#430)` を伴わせた                                                                   |
| r1-15 | 対応済み | `66855710` | `rotate` を `isGotePov` に寄せた。SCSS のクラス名は変えていない                                                          |
| r1-16 | 対応済み | `c7d783b9` | `shownKifuPathRef` に改名。行末コメントは初期値を揃える理由だけに絞った                                                  |
| r1-17 | 対応済み | `ccdd8e0b` | 本体をコード側の doc に置き、テストは指すだけにした                                                                      |
| r1-18 | 対応済み | `39805e46` | `PovType` を `"gote"` だけに絞った                                                                                       |
| r1-19 | 対応済み | `108cac7e` | `(B1, E1)` の説明を書き直し、E6 の発生源を2箇所に直した                                                                  |
| r1-20 | 対応済み | `4ecfec4f` | B3 の空欄を `—` で埋め、根拠を注（※3）に置いた                                                                           |
| r1-21 | 対応済み | `8aeb0623` | リポジトリ起点のパスにして `docsSourcePaths` の追跡対象に入れた                                                          |
| r1-22 | 対応済み | `4780a817` | 「いま満たしていないこと」から外し、状態の説明へ移した                                                                   |
| r1-23 | 解消済み | `4fc5cfba` | `rootDir` が prop になり `if (!rd) throw` が消えたので、ガードの変異がテストに届くようになった（実際に落ちることを確認） |
| r1-24 | 対応済み | `76986319` | テスト名を実際に見ている範囲まで弱め、踏めていない経路に #430 を添えた                                                   |
| r1-25 | 見送り   | —          | `docs/IDEAS.md` へ1行（SCSS の既存の負債5件としてまとめた）                                                              |
| r1-26 | 見送り   | —          | 同上                                                                                                                     |
| r1-27 | 見送り   | —          | 同上。**r2 で再指摘されたら範囲内へ引き上げる**（r1-08 で向きのトグルを触ったため）                                      |
| r1-28 | 見送り   | —          | 同上                                                                                                                     |
| r1-29 | 見送り   | —          | 同上                                                                                                                     |

### 計画からの逸脱（隠さずに書く）

- **r1-08 と r1-15 を1コミットにした**（`66855710`）。1所見1コミットの規約に反する。
  書く口を寄せると戻り値の名前をその場で決めることになり、同じ数行を2回書き換える形に
  なるため。計画の束でもこの順を前提にしていたが、**分けられなかったのは事実**なので記録する
- **r1-12 と r1-14 を1コミットにした**（`7a2878ff`）。どちらも同じ doc ブロック1つの
  書き直しで、別々に取ると中間状態が2回できる
- 順序は計画どおりではない。**r1-09（gate）を r1-12（doc）より先に**入れた。
  gate を入れると effect の doc が丸ごと変わるので、先に doc を直すと2回書くことになる
- r1-05 は計画では「新しく issue を立てる」としていたが、**既存の #403 が同じ事実を
  扱っていた**ので立てなかった（`gh issue list --search` で確認）
