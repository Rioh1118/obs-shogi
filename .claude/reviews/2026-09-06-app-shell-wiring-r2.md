# レビュー app-shell-wiring ラウンド2

- 日付: 2026-09-06
- 範囲: `git diff origin/main...HEAD`（40ファイル）
- 走らせた reviewer: architecture / react / robustness / comment / perf / ui / oss-hygiene（7）
- 対象コミット: `0f803434`
- 前ラウンド: [r1](2026-09-06-app-shell-wiring-r1.md)（29件。対応済み20 / 解消済み2 / 見送り7）

## 所見

### [BLOCK] r2-01 開いている棋譜を改名・移動すると盤が開いた時点まで巻き戻り、次の1手でそれがディスクへ書かれる

- 場所: `src/app/providers/bridges/GameFileTreeBridge.tsx:10-19`、`src/entities/game/model/provider.tsx:303-320`、
  `src/entities/file-tree/model/reducer.ts:30,91`、`src/entities/game/model/reducer.ts:10-20`
- reviewer: react（comment / oss-hygiene / robustness が doc 側から同じ機構に到達）
- **自分で確かめた:** `loadGame` は `game_loaded` を `cursor: ROOT_CURSOR` と `cloneJkf(jkf)` で撃つ。
  file-tree の `jkfData` が書かれるのは `kifu_opened`（`reducer.ts:30`）と改名の持ち越し（`:91`）だけで、
  **指し手の `jkf_replaced` は file-tree に伝わらない。**
- なぜ問題か: A.kif を開いて3手指す（各手は `persistIfPossible` で A.kif へ書かれる）→ A.kif を改名する。
  `reconcilePathMutation` が `activeKifuPath` を張り替え、`GameFileTreeBridge` の effect
  （依存に `activeKifuPath`）が `loadGame(開いた時点の jkfData, 新パス)` を撃つ。
  **盤・棋譜一覧・カーソルが開いた時点まで戻る。** ここで1手指すと `state.jkf` は巻き戻った棋譜なので、
  `saveKifuToFile` が**その3手が無い棋譜を新パスへ書く**。ディスク上の3手が消える。
  `moveNode`（`file-tree/model/provider.tsx:508`）も同じ `reconcilePathMutation` を通るので、
  フォルダ移動でも起きる。
- **このブランチが持ち込んだものではない。** `GameFileTreeBridge` も `entities/file-tree` も
  この差分は1行も触っていない（`git diff --stat` で確認）。
- ただし**このブランチが書いた doc がこれを取り違えている**（r2-03）。そちらは同じ PR で直す。

### [HIGH] r2-02 `rotate` という消えた綴りが、表の不変条件とテストのモックに残っている

- 場所: `docs/state-transitions/board-orientation.md:100`、`src/app/providers/__tests__/runtimeProvidersBridges.test.tsx:32`
- reviewer: architecture / react / comment / oss-hygiene（**4人**）
- 根拠: `useBoardOrientation` が返すのは `{ isGotePov, toggle }`（r1-15 で改名）。
  `grep -rn "rotate" src` で当たる値は**この1行のモックだけ**（他は SCSS の `game-board--rotated`）。
- なぜ問題か: (a) 不変条件2 が実在しない識別子を主語にしているので、grep で確かめる手順が成立しない。
  (b) `vi.mock` のファクトリは型検査を受けないので、`RuntimeProviders` の部分木に向きの読み手を
  1つ足した瞬間 `isGotePov` が `undefined` になり、**盤が回らない状態が「緑」として固定される。**

### [HIGH] r2-03 表の注 ※2 が挙げる因果に、実際に効いている一段（`GameFileTreeBridge`）が無い。しかも「盤の中身は変わらない」は偽

- 場所: `docs/state-transitions/board-orientation.md:86-89`（※2）、`:76`、`:109`、`:114-116`
- reviewer: comment / oss-hygiene / robustness / architecture（**4人**）
- 根拠: ※2 は「`active_kifu_reconciled` は `activeKifuPath` だけを張り替える。この表の合図はパスなので
  向きが戻る」と書く。だが同じ表の `:23,:32` は合図を `loadedAbsPath`（`game_loaded` でしか動かない）と
  宣言している。**注の説明どおりに読むと向きは戻らないことになり、表本体の `(B2, E7) → B1` と矛盾する。**
  実際に効いているのは `GameFileTreeBridge` が `activeKifuPath` を依存に持つことで、そこから
  `loadGame` → `game_loaded` → `loadedAbsPath` が動く。
- さらに「盤の中身は変わっていないのに回る」（`:88`, `:109`）は**偽**。r2-01 のとおり盤は初手へ戻る。
- `:114-116` の「file-tree 側が区別を持つべきか」という直し先の誘導も、実際の locus
  （`GameFileTreeBridge`）を外している。**この誘導のまま着手すると局面の巻き戻りは残る。**

### [HIGH] r2-04 盤に載せられない棋譜を開くと、ヘッダのファイル名と対局者名だけが入れ替わり、盤は前の棋譜のまま。何も出ない

- 場所: `src/widgets/app-layout-header/lib/useHeaderCenterInfo.ts:34,38-46`、
  `src/widgets/game-board/ui/GameBoard.tsx:15-19`、`src/pages/AppLayout.tsx:30,49`
- reviewer: robustness
- 根拠: ヘッダのファイル名は `useFileTree().selectedNode`、対局者名は `useFileTree().jkfData` から取る。
  盤の中身は `entities/game`。E16（`preset: "OTHER"` で `initial` が壊れている棋譜）では
  `kifu_opened` が出て file-tree 側だけが動き、`loadGame` は落ちる。
- なぜ問題か: **ヘッダのファイル名は新しい棋譜、盤の対局者名も新しい棋譜、盤面と棋譜一覧は前の棋譜**という
  混合画面になる。エラー表示は無い（`game.state.error` の読み手は0）。
- **このブランチが静かにした側面がある。** `origin/main` は `selectedNode?.id` を合図に `pov` を
  落としていたので、E16 でも「盤の向きが戻る」という目に見える変化が1つあった。合図を
  `loadedAbsPath` へ移した（それ自体は正しい）結果、E16 では game 側が一切動かなくなり、
  **差し替わるのは file-tree 由来の見出しだけ**になった。

### [MEDIUM] r2-05 `hasKifu` を「唯一の綴り」と宣言した直後に、prop 境界で `hasFile` へ改名されている

- 場所: `src/pages/AppLayout.tsx:49`、`src/widgets/app-layout-header/ui/AppLayoutHeader.tsx:12,15`、
  `src/widgets/app-layout-header/lib/useHeaderCenterInfo.ts:33-34,57`
- reviewer: architecture / react / comment（**3人**）
- 根拠: `useHeaderCenterInfo` は `useGame()` を自分で呼んでいるのに、値だけ prop で受け取り、
  受け取った側で `hasFile && !!view.player` と AND を取り直している。`hasKifu = !!player?.shogi` なので
  後半は恒真。
- なぜ問題か: 同じ問いに `hasKifu` / `hasFile` / `!!view.player` の3綴りがある。
  `hasFile` は意味も違う——ファイルは開いているが盤に載せられない棋譜では、ファイルは在るのに偽になる。
  この PR は「ファイル（`activeKifuPath`）と盤の中身（`loadedAbsPath`）は別物」を軸に据えたのに、
  ヘッダへ渡す口だけファイル側の語彙が残った。
- 同じ差分の `GameBoard` は `rotate` prop を落として「自分でスライスから取る」形にしたので、隣で逆をしている。

### [MEDIUM] r2-06 `gameBoardOrientation.test.tsx` の3件目が、名乗る条件を一度も作っていない

- 場所: `src/widgets/game-board/ui/__tests__/gameBoardOrientation.test.tsx:51-59`（doc は `:14`）
- reviewer: react / comment（2人）
- 根拠: テスト名は「盤に載っている棋譜が変わっても」だが、動かしているのは `tree.activeKifuPath`。
  `GameBoard` が `useFileTree()` から取るのは `jkfData` だけで `activeKifuPath` は読まない。
  さらにこの PR の語彙では「盤に載っている棋譜」＝ `loadedAbsPath` で、`@/entities/game` は
  モックすらしていない。
- なぜ問題か: 実質「同じ URL で2回描くと `.game-board--rotated` が残る」しか見ていない。
  `GameBoard` の中に `useResetOrientationOnKifuChange()` を書き足しても緑のまま通る——
  doc（`:14`）が名乗っている保証が1つも掛かっていない。
  **r1-24 で「名前が実装より強い」を弱めた直後に、同じ形が新しいテストで入っている。**

### [MEDIUM] r2-07 E4 / E5 / E9 を名乗るテストが、その3つのどれも組み立てていない

- 場所: `src/features/board-orientation/model/__tests__/useBoardOrientation.test.tsx:110-124`、
  `docs/state-transitions/board-orientation.md:76`（`(B2,E4)` `(B2,E5)` `(B2,E9)` の ✓）
- reviewer: comment / oss-hygiene / robustness（3人）
- 根拠: このファイルのモックは `game = { state: { loadedAbsPath } }` 1つで、`activeKifuPath` も
  `selectedNode` も `loadGame` も存在しない。テスト本体は「何も変えずに2回描き直す」。
- なぜ問題か: 3つのイベントはどれも「ツリー側が動いたのに盤が動かない」でしか区別できないのに、
  テストにツリー側が無い。**表の3セルの ✓ が同じ1つの再描画に寄りかかっている。**
  還元してよいという判断自体は成り立つが、doc にも表にも書かれていない。

### [MEDIUM] r2-08 購読の登録が落ちると索引が一度も作られなくなり、復帰の口も無い

- 場所: `src/entities/search/model/provider.tsx:104-107`、`:158-159`
- reviewer: robustness
- 根拠: `listenSearchEvents` が reject する枝は `catch` で `console.error` するだけで
  `setIsListening(true)` に届かない。購読 effect の依存は `[]` なので `isListening` は
  そのセッション中ずっと偽。**`open_project` は一度も飛ばない。**
- なぜ問題か: 前は購読が落ちても `open_project` は飛んでいたので、Rust 側の索引・watcher・
  ディスクのチェックポイントは作られ、**次回起動は正常だった。** いまは購読の失敗が索引の構築まで
  巻き添えにする。しかも r1-07 で `openProject` を context と barrel の両方から外したので、
  **アプリ内から索引を作り直す口が0件。** 残るのはワークスペースの選び直し（reload）か再起動だけ。
- **r1-06 の修正が持ち込んだ退行。** 順序（購読 → open）を守る目的自体は正しい。

### [MEDIUM] r2-09 effect の doc「合図は `rootDir` prop だけ」「撃つのは根が変わった一度きり」が、同じ effect の依存配列と食い違う

- 場所: `src/entities/search/model/provider.tsx:142`, `:151-152`, `:157-162`
- reviewer: comment
- 根拠: 起動時に open を撃っているのは `isListening` が false→true になる回。
  `SearchRootGate` は根が確定していても流すので、最初の実行は `isListening === false` で return する。
  テストもそれを踏んでいる（`openOnRootChange.test.tsx` の「購読が張り終わるまで開かない」は
  `rootDir` を一切動かさずに open が起きることを見ている）。
- なぜ問題か: 「合図は `rootDir` だけ」と読んだ人は、`isListening` を依存から外す判断を
  「合図を変えていない」と扱う。外すと r1-06 で潰した取りこぼしが戻る。

### [MEDIUM] r2-10 `hasKifu` を「唯一の綴り」と書いたが、盤の内側は `player?.shogi` を直に見ている

- 場所: `src/entities/game/model/types.ts:62-67`、`src/widgets/game-board/ui/Board.tsx:14,49-50`、
  `src/widgets/game-board/ui/Hand.tsx:15`、`docs/spec/screens/board.md:40,44`
- reviewer: comment / ui（2人）
- 根拠: 同じ問いが少なくとも3箇所で別々に綴られている。`docs/spec/screens/board.md:44` は
  `view.player?.shogi` を**仕様として**書いている。
- なぜ問題か: r1-12 で潰した「唯一」の主張と同じ形が、別の場所に新しく入った。
  doc が仮定形で「2つの答えが出る」と書いているが、その状態は**もう存在している**。
- 付随（ui）: `Board.tsx:49-50` の `board-loading` は **到達しない**（`AppLayout` の `hasKifu` が
  同じ `view` を見て門番している）。しかも `.board-loading` の CSS 規則はリポジトリに1つも無い
  （ビルド後の CSS に出現0）。`docs/spec/screens/board.md:40` は実在する状態のように書いている。

### [MEDIUM] r2-11 注 ※3 が根拠にしている React の挙動が違う

- 場所: `docs/state-transitions/board-orientation.md:91-94`
- reviewer: comment
- 根拠: 「保留されているエフェクトは合図の**現在値**を読んで走る」と書いてあるが、effect が読む
  `shownKifuPath` はそのエフェクトを登録したレンダのクロージャに閉じ込めた値。
- なぜ問題か: この注1つで表の最下行9セルを `—` にしている。「現在値を読む」というモデルを持った人は
  `shownKifuPathRef.current === shownKifuPath` の比較を「常に最新どうしなので要らない」と読んで落としうる。
  落とすと不変条件1が破れ、E8 のたびに `pov` が消える。**結論（結末は必ず B0 か B1）は正しいので、
  消すのではなく根拠を直す対象。**

### [MEDIUM] r2-12 README の索引が、書き直す前の軸を指したまま

- 場所: `docs/state-transitions/README.md:27,53`、`docs/state-transitions/board-orientation.md:3-4`
- reviewer: comment / oss-hygiene（2人）
- 根拠: `:53` は「`selectedNode` と `activeKifuPath` のずれが軸」。表が**選ばなかった2つ**を軸として
  挙げていて、選んだ `loadedAbsPath` が出てこない。表の冒頭 `:3-4` も「合図の出どころは file-tree.md」で、
  `loadedAbsPath` の持ち主（game）へのリンクが1本も無い。
- なぜ問題か: 索引から入る人は「file-tree の2フィールドを突き合わせる表」として読み始める。
  **r1 で潰した誤り（合図をツリー側のパスに取る）を、索引がそのまま再生産する。**

### [MEDIUM] r2-13 状態 B0〜B3 の判定が排他でなく、同じ観測に表が2つの結末を言う

- 場所: `docs/state-transitions/board-orientation.md:39-42`, `:44-46`, `:75-77`
- reviewer: oss-hygiene
- 根拠: B0 だけが ref の条件を持ち、B1 / B2 は持たない。棋譜が載った直後のレンダ
  （`loadedAbsPath` あり・`pov` 未設定・ref は前の値）は **B1 と B3 の両方を満たす**。
  そこで表は違うことを言う——`(B1, E3)` は「→ B2（✓）」、B3 の行は「—※3」。

### [MEDIUM] r2-14 `failure-surfacing.md` の F-17 が「まだ issue になっていない」側に残っている

- 場所: `docs/state-transitions/failure-surfacing.md:166-171`, `:174`、
  `src/entities/search/model/provider.tsx:154`（この差分が `F-17 / #403` と書いた）
- reviewer: oss-hygiene
- なぜ問題か: 台帳は F 番号の採番元。出口の無い失敗に issue を立てる人は `:172-175` を根拠にするので、
  既に #403 が扱っている F-17 に**重複 issue を立てる**。

### [MEDIUM] r2-15 `gates` と `bridges` を分ける基準が、この差分でも読み取れないまま

- 場所: `src/app/providers/gates/SearchRootGate.tsx`、`src/app/providers/bridges/AnalysisBridge.tsx`、
  `src/app/providers/bridges/EngineRuntimeBridge.tsx`、`docs/IDEAS.md:54`
- reviewer: architecture
- 根拠: `SearchRootGate` は「上位のフックから値を取り、下位の provider に prop で渡す」形。
  `AnalysisBridge` と `EngineRuntimeBridge` は**同じ3行の形**なのに `bridges/` にある。
  `BoardOrientationBridge` と `GameFileTreeBridge` は `null` を返して effect だけを持つ。
- なぜ問題か: この差分は基準そのものは**供給している**（7ファイル中5つが一致）。残る2つが反対側に
  居るせいで基準がコードから導けない。**`docs/IDEAS.md:54` の「単独で着手する価値がまだ判断できて
  いない」はこの差分で古くなった**——判断材料は揃い、直しはファイル2つの移動で済む。

### [MEDIUM] r2-16 `entities/game` の context に読み手0の述語が2つ残り、片方は `hasKifu` と別の規則で同じ問いに答える

- 場所: `src/entities/game/model/provider.tsx:639`, `:665-667`、`src/entities/game/model/types.ts:256`
- reviewer: react
- 根拠: `isGameLoaded()` は `state.jkf !== null`、`hasKifu` は `!!player?.shogi`。
  `jkf_replaced` で `buildPlayer` が投げる棋譜が入ると両者は食い違う。
  `grep` の結果、`isGameLoaded` も `hasSelection` も呼び出し元は0。
- なぜ問題か: r1-07 で `openProject` に対して下したのと同じ判断（呼び出し元0の公開面）が、
  同じ差分の中で新しく作った doc の反例として2件残っている。

### [MEDIUM] r2-17 `?pov` が付いていないときも `navigate` を撃ち、ファイルツリー全行がもう一度描き直される

- 場所: `src/features/board-orientation/model/useResetOrientationOnKifuChange.ts:28-32`、
  `src/shared/lib/router/useURLParams.ts:59-78`
- reviewer: perf
- 根拠: effect は `params.pov` を一切見ずに `updateParams({ pov: undefined })` を呼ぶ。
  `updateParams` は削除が空振りでも無条件に `navigate` する。`history.replace` は URL が同一でも
  listener を叩き、新しい `key` を持つ location を作る → `useLocation` の読み手が全部再レンダ。
- なぜ問題か: `?pov=gote` が付いているのはトグルを押した後だけなので、**通常は毎回が空振り**。
  それでも棋譜を1本開くたびに `FileTree`（`memo` なし・各ノードが dnd-kit のフック2つ）が
  **同じ操作に対する2回目の全行描画**をする。展開ノード数 n が 300 で1フレーム分、
  1,000 で 20〜50ms（見積り。実測ではない）。
- **回帰ではない。** `origin/main` の `AppLayout` にも同じ無条件の `updateParams` があり、
  この差分は撃つ頻度を**減らしている**（ディレクトリの開閉・選択では撃たなくなった）。

### [MEDIUM] r2-18 `docs/spec/screens/app-layout.md` の「失敗の見せ方」が、この画面で唯一起きる失敗を書いていない

- 場所: `docs/spec/screens/app-layout.md:99-107`, `:66-70`
- reviewer: robustness
- 根拠: 「シェル自体は失敗しない」と書いてあるが、起動直後に E16 の棋譜を選ぶと `hasKifu` は偽のまま、
  本体は `WelcomeScreen` のまま、ヘッダも「ファイル未選択」のまま。理由はどこにも出ない。
  しかもそのファイルは `activeKifuPath` になっているので**もう一度クリックしても何も起きない**
  （`FileNode.tsx:99` の `if (!isActive)`）。

### [MEDIUM] r2-19 E7 の名前が「改名で」だが、`moveNode` でも同じことが起きる

- 場所: `docs/state-transitions/board-orientation.md:58`（E7 の行）、`src/entities/file-tree/model/provider.tsx:474,508`
- reviewer: oss-hygiene
- 根拠: `reconcilePathMutation` は `renameNode` だけでなく `moveNode` からも呼ばれる。
  開いている棋譜を別フォルダへ移しても同じ経路に入る。

### [LOW] r2-20 レイヤをまたぐ1段相対 import が5箇所残り、うち3つは今回書き換えた import ブロックの中にある

- 場所: `src/pages/AppLayout.tsx:4-6`、`src/pages/WelcomeScreen.tsx:1`、`src/pages/FolderSelect.tsx:2`
- reviewer: architecture
- 根拠: `AppLayout.tsx:3` は r1-10 で `@/widgets/sidebar/ui/Sidebar` に直したが、直下の `:4-6` は
  `../widgets/game-board/ui/*` のまま。層違反そのものは起きない（`upperLayers` が `../${upper}/**` も
  禁じている）が、同じ役割の import が1ファイル内で2通りに書かれている。

## 重複・矛盾した所見

- **r2-02（`rotate` の残骸）は4人が独立に到達。** r1-15 の改名の取り残し。確度は最高
- **r2-03（※2 の因果）も4人。** うち2人（react / robustness）は同じ機構から
  r2-01（データ喪失）まで到達している。**doc の誤りと実挙動の欠陥が同じ根**
- **r2-01 と r2-03 は同じ根だが行き先が違う。** 挙動（r2-01）は範囲外＝issue、
  doc（r2-03）はこのブランチが書いた行なので同じ PR で直す
- **r2-05 と r2-10 は同じ「唯一の綴り」の主張に対する別方向の反例。**
  r2-05 は prop 境界での改名、r2-10 は盤の内側が直に見ていること。
  **どちらも「`hasKifu` の doc が現物より強い」ことを言っている**ので、doc を弱めるか現物を寄せるかの
  判断は1回で足りる
- **r2-06 と r2-07 は同じ形**（テストが名乗る条件を作っていない）。r2-07 は表の ✓ にも波及する
- **矛盾: r2-08（購読が落ちたら索引が作られない）と r1-06（購読を待ってから開く）。**
  r1-06 の目的（順序）は正しく、r2-08 が指すのは失敗時の巻き添え。
  `isListening` を「購読の**試行が決着したか**」に変えれば両立する
- perf は r1 の4つの数を再確認し、**3つは改善、1つは不変**と報告している
  （`AppLayout` の context 購読は 4本 → 1本。索引構築中の全画面再レンダが最大 20/s から 0 へ）。
  唯一の所見が r2-17

## 見ていない範囲

- Rust 側は `search/commands.rs` の `open_project` 前半のみ。watcher の差分反映と epoch 制御は未読
- `docs/state-transitions/` の他の表（`app.md` / `file-tree.md` / `game.md` / `search.md`）の内容
- `docs/spec/screens/` は `app-layout.md` 全文・`board.md` 前半・`navigation-map.md` 周辺のみ。
  `file-tree.md` / `kifu-stream.md` は未読
- `KifuStreamList` の描画コスト（仮想化の有無を確認していない）。r2-17 の n の見積りは
  ファイルツリー側だけで立てたもので、**実測ではない**
- 改名・移動を実機で踏んでいない。r2-01 は4ファイルの読みと `provider.test.tsx` の既存の固定から
- `docs/IDEAS.md` に送った SCSS 5件の記述内容の正しさ（SCSS を読み直していない）
- レビュアーは変異を当てていない（ファイルを書き換えないため）。「このテストは落ちない」は読解による

## lint / hook で強制できるもの

- **`docs/` のバッククォート識別子が `src/` に実在すること**（r2-02 / r2-12）。
  `src/__tests__/docsSourcePaths.ts` は既に同じファイル群を歩いていて、いまはパスしか見ていない。
  識別子へ広げれば `board-orientation.md:100` の `rotate` は落ちる
- **`vi.mock` のファクトリが返すキーが、そのバレルの export に実在すること**（r2-02）。
  `src/__tests__/sliceBarrels.test.ts` の `publicModules()` を再利用して走査できる。
  **この差分で新設した6つのテストのモックはどれも型に守られていない**
- **読み手0の context メソッド**（r2-16）。r1 の「lint / hook」欄に挙がった `sliceBarrels` 型の走査を
  `model/types.ts` の context インターフェースまで広げれば拾える
- **`gates/` と `bridges/` の形の違反**（r2-15）。`bridges/*.tsx` が `children` を prop に取ったら失敗、
  `gates/*.tsx` が `return null` したら失敗、という走査で固定できる
- **CSS 規則を持たないクラス名**（r2-10 の付随）。`scssScale.ts` と同じく postcss で全 SCSS を舐め、
  `className` に現れて SCSS のどのセレクタにも無い綴りを数える。`board-loading` が1件目
- **`docs/state-transitions/` の表を Rust のラチェットが見ていない。**
  `src-tauri/tests/state_transition_cells.rs` の `table_source()` は `game-session.md` 決め打ちで、
  `board-orientation.md` は対象外。この表の ✓ と `—` の正しさは**現状すべて人の目に依存している**
- r2-01 / r2-03 / r2-04 / r2-05 / r2-17 は機械では防げない

## 修正計画（r2 → r3）

### 束（同じ根から出ている所見）

- **改名の機構**: r2-01（挙動）と r2-03（doc）は同じ根。**行き先が違う**——挙動は範囲外で issue、
  doc はこのブランチが書いた行なので同じ PR。r2-03 を直すと r2-19（E7 の名前）も同じ節で決まる
- **「唯一の綴り」の主張**: r2-05（prop 境界での改名）と r2-10（盤の内側が直に見ている）は、
  どちらも「`hasKifu` の doc が現物より強い」の別方向の反例。**doc を弱めるか現物を寄せるかの
  判断は1回**。r2-05 は寄せられる（ヘッダは既に `useGame()` を呼んでいる）、r2-10 の
  `Board` / `Hand` は盤の内側の描画ガードで別の問い。**寄せる／弱めるを混ぜる**
- **テストが名乗る条件を作っていない**: r2-06 と r2-07 は同じ形。r2-07 は表の ✓ にも波及するので、
  表の凡例を触る r2-07 を先に置く
- **購読と索引**: r2-08（挙動）→ r2-09（doc）。挙動を直すと doc が指す条件が変わる

### このラウンドで直すもの

| 順  | 所見                          | なぜこの順か                                                     | この直し方で壊しうるもの                                                                                                                                                        |
| --- | ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | r2-08 購読の失敗の巻き添え    | 失敗経路と門番。修正が積み上がる前に                             | `isListening` を「試行が決着したか」に変えると、**購読が落ちた状態でも open が飛ぶ**。r1-06 が守った順序は成功時だけになる——成功時に順序が保たれることをテストで確かめ直す      |
| 2   | r2-09 effect の doc           | 1 の後。挙動が変われば doc の条件も変わる                        | 「2回撃つ」と書くと、`openInFlightRef` の畳み（#430）と読み合わせて誤読される。#430 との関係を1行で切る                                                                         |
| 3   | r2-02 `rotate` の残骸         | 4人が到達。機械的で他と干渉しない                                | モックを実物の形にすると、**`RuntimeProviders` の部分木に向きの読み手が居ないことに依存**する。居ないことを確かめてから直す                                                     |
| 4   | r2-03 ※2 の因果               | 束の先頭。表の他の節がこの結論を参照している                     | 因果に `GameFileTreeBridge` を足すと、**表の対象（`src/features/board-orientation/`）の外の話が表に入る。** 参照として書き、表の軸は動かさない                                  |
| 5   | r2-19 E7 の名前に移動も含める | 4 と同じ節                                                       | 名前を変えると `file-tree.md` 側の E 番号との対応が読めなくなる。発生源の欄に両方書く                                                                                           |
| 6   | r2-11 ※3 の根拠               | 同じ表の注。4/5 の後                                             | 根拠を直すと**結論（`—`）が変わって見える**。結論は変わらないことを明記する                                                                                                     |
| 7   | r2-13 B0〜B3 の排他           | 同じ表の状態の節                                                 | B1 / B2 に ref の条件を足すと、**表の全セルが「エフェクト後の状態」の話になる。** B3 の意味が変わらないことを確かめる                                                           |
| 8   | r2-07 E4/E5/E9 の還元         | 表の凡例を触るので、セルを触る 4〜7 の後                         | 「還元している」と書くと、**還元が壊れたとき（feature が file-tree を読み直したとき）に表が嘘になる。** 還元の前提を書く                                                        |
| 9   | r2-12 README の索引           | 表本体が固まってから索引を直す                                   | 索引の軸を変えると `app.md` からの参照とずれる可能性。`app.md` 側の記述を確かめる                                                                                               |
| 10  | r2-14 F-17 の台帳             | 独立                                                             | 台帳の issue 表に足すと、**#403 が閉じたときに F-17 も閉じたことになる。** #403 の範囲が F-17 を含むことを確かめてから                                                          |
| 11  | r2-18 spec の失敗の見せ方     | 独立                                                             | 「シェル自体は失敗しない」を弱めると、**エラー境界の節との関係が読めなくなる。** 別の段落にする                                                                                 |
| 12  | r2-05 `hasFile` → `hasKifu`   | 束の先頭。13 の判断材料                                          | `useHeaderCenterInfo` が prop を取らなくなるので、**引数で差し替えていたテストがあれば壊れる**（`grep` で確かめる）                                                             |
| 13  | r2-10 「唯一」を弱める        | 12 の後。寄せた結果を見てから文言を決める                        | 弱めすぎると `hasKifu` を足した理由が消える。「画面を切り替える側の唯一の綴り」に絞る                                                                                           |
| 14  | r2-16 読み手0の述語           | 独立。r1-07 と同じ判断                                           | `isGameLoaded` / `hasSelection` を外すと、**将来 context 越しに使いたくなった人が同じものを作り直す。** 消した理由を doc に残さない（コードに残すと経緯になる）→ 消すだけにする |
| 15  | r2-06 盤のテストの3件目       | 独立                                                             | `@/entities/game` をモックすると、`GameBoard` が `useGame` を呼んでいないので**モックが空振りする。** 名前を弱める側を選ぶ                                                      |
| 16  | r2-17 空振りの navigate       | 独立。挙動を1行変える                                            | `params.pov` を依存に足すと、**`pov` が変わるたびに effect が走る。** ref 比較で先に抜けることを確かめる                                                                        |
| 17  | r2-15 gates / bridges の基準  | 最後。他の修正で `RuntimeProviders` が動かないことを確認してから | 基準を doc に書くだけで**2つの例外は残る。** 例外である理由を書かないと、次の人が基準を無視する根拠になる                                                                       |
| 18  | r2-20 相対 import             | 最後。機械的                                                     | `@/` に変えると `sliceBarrels` の走査に載る。載って落ちないことを確かめる                                                                                                       |

### 直さないもの

| 所見                             | 行き先          | 理由                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r2-01 改名でディスクの手が消える | **issue**       | `GameFileTreeBridge` も `entities/file-tree` もこの差分は1行も触っていない（確認済み）。直すには「同じ棋譜のパスだけが変わった」を game か file-tree の語彙に足す判断が要る。**データ喪失なので6週間以内に着手する**                                            |
| r2-04 E16 で見出しだけ入れ替わる | **issue**       | ヘッダのファイル名（`selectedNode`）と対局者名（file-tree の `jkfData`）の出どころは変更前から file-tree。この差分は**偶発的な兆候（向きが戻る）を消しただけ**で、混合画面そのものは持ち込んでいない。直すには2つの widget の出どころを game に寄せる判断が要る |
| r2-10 の付随 `board-loading`     | `docs/IDEAS.md` | 到達不能な分岐と CSS 規則の無いクラス名。変更前から同じ。SCSS の負債5件と同じ節に足す                                                                                                                                                                           |

### 対象そのものを疑ったか

**所見が `docs/state-transitions/board-orientation.md` に集まっている。** 20件中7件
（r2-02 / r2-03 / r2-07 / r2-11 / r2-12 / r2-13 / r2-19）が同じ1ファイル。r1 でも5件だった。
**2ラウンド続けて同じファイルが最多。**

理由は「表が実装より先に書かれ、実装が2回動いた」こと——r1-02 で合図が `activeKifuPath` から
`loadedAbsPath` に変わり、r1-15 で `rotate` が `isGotePov` になった。表はそのたびに手で追随しており、
**追随を確かめる機械が1つも無い**（`state_transition_cells.rs` の `table_source()` は
`game-session.md` 決め打ちで、この表は対象外。oss-hygiene が確認）。

**落とす案:** この表を Rust のラチェットの対象に入れる。ただし `game-session.md` と同じ列形式
（テスト列を独立させる）への作り直しが前提で、この PR の範囲を超える。
**r3 でまた同じファイルに所見が集まったら、表を作り直すか落とすかを判断する。**

### 次ラウンドの焦点

1. **`isListening` を「試行が決着したか」に変えたことで、成功時の順序（購読 → open）が
   保たれているか。** 失敗時に open が飛ぶようになったことで新しく開いた穴は無いか
2. **表の注（※1 / ※2 / ※3）を書き直した結果、表本体のセルと食い違っていないか。**
   特に ※2 に `GameFileTreeBridge` を足したことで、表の対象（`features/board-orientation/`）の
   外の話が入り込んでいないか
3. **B1 / B2 の判定に ref の条件を足したことで、B3 との関係が変わっていないか**
4. **`hasFile` prop を落としたことで、`useHeaderCenterInfo` の他の読み手や
   `AppLayoutHeader` の描画条件が変わっていないか**
5. **`isGameLoaded` / `hasSelection` を context から外したことで、壊れた呼び出し元が無いか**
6. **`params.pov` を effect の依存に足したことで、`pov` を落とす回数が変わっていないか**
7. **r1 と r2 で2回ずつ「テストが名乗る条件を作っていない」が出た**（r1-24 / r2-06 / r2-07）。
   **この差分の全テストについて、名前が実装より強くないかをもう一度見ること**

### 検証の見積り

直すもの18件。`docs/state-transitions/` を触るのは 3〜9 の7件（`verify:rust` 約2分15秒 → 約16分）。
残り11件は `verify` のみ（約8秒）。**合計およそ18分。** 20分を超えないので次ラウンドへ送らない。

## 修正の結果（r2）

| 所見         | 結果     | コミット   | 一行                                                                                                      |
| ------------ | -------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| r2-01        | 見送り   | —          | **issue #433**。データ喪失まで至る。`GameFileTreeBridge` も `entities/file-tree` もこの差分は触っていない |
| r2-02        | 対応済み | `64b7f651` | 表の不変条件2 を `isGotePov` に。使っていないモックの行を落とした                                         |
| r2-03        | 対応済み | `bd24ff2e` | ※2 を4段の経路で書き直し、「盤の中身は変わらない」を撤回。直し先も `GameFileTreeBridge` に                |
| r2-04        | 見送り   | —          | **issue #434**。見出しの出どころは変更前から file-tree。偶発的な兆候を消したことは issue に書いた         |
| r2-05        | 対応済み | `73dcbcd9` | `hasFile` prop を落とし、ヘッダが `view.hasKifu` を自分で読む形にした                                     |
| r2-06        | 対応済み | `65a2296e` | `GameBoard` が読むものだけを動かす形にし、名前も合わせた                                                  |
| r2-07        | 対応済み | `894bee2e` | 表の凡例とテストの doc の両方に「還元している」ことと、成り立つ条件を書いた                               |
| r2-08        | 対応済み | `b0c606f7` | `isListenSettled`（試行が決着したか）にし、失敗でも真にする                                               |
| r2-09        | 対応済み | `3df4d60d` | 撃つ機会が2回であることと、どちらの依存を外すと何が壊れるかを書いた                                       |
| r2-10        | 対応済み | `d4a24565` | 「唯一」を落とし、盤の内側を寄せていないことを書いた                                                      |
| r2-11        | 対応済み | `88f2f2ed` | ※3 の根拠をクロージャの値に直し、比較を落とすなという1文を足した                                          |
| r2-12        | 対応済み | `b1570f95` | 索引の軸を合図（`loadedAbsPath`）に。表の冒頭も game と file-tree の2本に分けた                           |
| r2-13        | 対応済み | `fff58b38` | B1 / B2 にも記録の条件を足して4状態を排他にした                                                           |
| r2-14        | 対応済み | `d6bbd3ab` | F-17 を issue 表（#403）へ移した                                                                          |
| r2-15        | 対応済み | `7e636341` | 基準を `RuntimeProviders` の doc に書き、合っていない2つを名指し。`IDEAS.md` も更新                       |
| r2-16        | 対応済み | `42de9600` | `isGameLoaded` / `hasSelection` を context 型と value から外した                                          |
| r2-17        | 対応済み | `ecb1a2b9` | 消す `pov` が無ければ `navigate` しない。location の鍵を数えるテストを足した                              |
| r2-18        | 対応済み | `add7d43f` | 「棋譜を開いたが盤に載せられなかったとき」の節を足し、L0 に注を付けた                                     |
| r2-19        | 対応済み | `bd24ff2e` | E7 を「改名・移動で」にし、発生源に `renameNode` / `moveNode` を書いた                                    |
| r2-20        | 対応済み | `c83d1939` | `pages/` の1段相対 import 5箇所を `@/` に揃えた                                                           |
| r2-10 の付随 | 見送り   | —          | `board-loading` が到達不能で CSS 規則も無い件は `docs/IDEAS.md` へ                                        |

### reviewer の主張のうち、確かめて違っていたもの

- **r2-16 で react reviewer は `hasSelection` の呼び出し元を0と書いた。** 最初の `grep` では
  3件当たったが、**全部 `features/clear-board-selection` の同名のローカル変数**だった。
  context のメソッドとしては reviewer の言うとおり0件。**数え直して初めて分かった**ので記録する

### 計画からの逸脱

- **r2-03 と r2-19 を1コミットにした**（`bd24ff2e`）。同じ注1つの書き直しで、E7 の名前は
  その経路の起点を数えた結果として決まる。1所見1コミットを破っている
- r2-15 は計画どおり「基準を doc に書く」に留め、**2ファイルの移動はしていない**。
  r3 で再指摘されたら `docs/IDEAS.md` が行き先
