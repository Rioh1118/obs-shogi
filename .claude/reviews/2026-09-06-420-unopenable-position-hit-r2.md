# レビュー 420-unopenable-position-hit ラウンド2

- 日付: 2026-09-06
- 範囲: `git diff main...HEAD`（r1 の修正17件を含む。src 6ファイル / docs 3ファイル / `.claude/reviews/`）
- 走らせた reviewer: react / robustness / architecture / comment / oss-hygiene / perf / ui（7）
- 対象コミット: `3f691cf2`
- 前ラウンド: [`r1`](./2026-09-06-420-unopenable-position-hit-r1.md)。その「次ラウンドの焦点」8件を全員に渡した

**BLOCK 1 / HIGH 9 / MEDIUM 17。** うち **r1 の修正が作ったもの 6件**（B-1 / H-1 / H-6 / H-7 / H-8 / M-3）。

## 所見

### [BLOCK] B-1 「鍵を書くのは利用者が選んだときだけ」と書いた15行下で、クランプの effect が鍵を書いている

- reviewer: comment
- 場所: `src/features/position-search/ui/PositionSearchModal.tsx:187-188`（宣言のコメント）、`:191-198`（`selectIndex`）、`:200-205`（クランプ）
- 根拠: `selectIndex` は必ず `activeKeyRef.current` を書くので、クランプの effect（利用者が触っていない経路）も鍵を書き換える
- なぜ問題か: r1 の H-2 は「鍵を書く経路が多すぎて追従が働かない」だった。その不変条件を宣言したコメントが、**修正で残した例外を隠している**。次に触る人が「鍵は操作でしか動かない」を前提に `selectIndex` を別の effect から呼ぶと H-2 が静かに再発する（クランプ経路を踏むテストは無い）
- 直し方: (a) コメントを事実に合わせる（「選択が確定する経路＝利用者の操作と、範囲外に落ちたときのクランプ」）か、(b) クランプは `setActiveIndex` を直に呼び鍵を書かない形にして、コメントをそのまま成立させる。**どちらを選んだかがコードから読めるようにする**

### [HIGH] H-1 `gameState.isLoading` は「読み込み中」ではなく「利用者を待たせている**書き込み**があるか」

- reviewer: architecture（react も同じ節の未テストを指摘）
- 場所: `src/features/position-search/lib/usePositionHitNavigation.ts:46` `:91` `:99`。定義は `entities/game/model/types.ts:40-54`、書き手は `reducer.ts:17` `:86-93`
- 根拠: `isLoading` は `blockingWrites > 0` の射影で、`game_loaded` すら書き込み本数からしか決めていない。**棋譜の読み込み中に立つフラグはこの型に存在しない**（`file-tree` の `kifu_loading` も `kifuError` を消すだけ）
- なぜ問題か: r1 H-1 で足した門のうち、目的（読み込みの飛行中に前の棋譜へ当てる）を実際に止めているのは `loadedAbsPath === absPath` だけで、`!isLoading` は**その目的については恒真**。代わりに無関係な条件で効く——分岐の削除や保存が飛んでいる最中に、いま盤に載っている棋譜のヒットで Enter を押すと速い経路が外れ、ツリーの選択が動いてから当たる。**この節を消してもテストは1本も落ちない**（`stub.isLoading` は全テストで `false`）
- 直し方: `isLoading` の節と依存を落とし、コメントの「条件は下の effect と同じ」を `loadedAbsPath === absPath && player` の2つだと書き直す。読み込み中を本当に門にするなら、その状態を持つのは `entities/file-tree` 側なので先にそちらへ足す

### [HIGH] H-2 要求を捨てる門が `FsError.path` に依存しているが、io / 権限の失敗では Rust が `path` を積まない

- reviewer: architecture
- 場所: `src/features/position-search/lib/usePositionHitNavigation.ts:85-88`。`path` が落ちる経路は `entities/file-tree/api/service.ts:35-42` → `api/error.ts:92-99` → `src-tauri/src/workspace/record.rs:42` → `crates/fs/src/error.rs:77-86`
- 根拠: `FsError.path` は省略可（`error.ts:41`）で、`io::Error` 由来は `path: None` のまま。`readKifu` は `node.path` を補わない
- なぜ問題か: 権限が無い・ボリュームが外れた等で読めなかったとき `kifuError.path` は `undefined` なので要求は捨てられない。しかも `openKifuNode` は失敗時に `restoreSelection()` で選択を戻すので、`params.sfen` から開いた（＝ツリー未選択の）経路では `selectedNode` が `null` になり「別の棋譜を選んだ」門にも掛からない。**r1 H-3 が塞いだつもりの症状がそのまま残る**。テストは `path` 付きの形しか踏んでいない
- 直し方: (a) `readKifu` で `asFsError(e)` に `node.path` を必ず補う（`kifuError` を読む他の口も直る）、または (b) 「要求を出したあとに `kifuError` が新しく立ったか」で捨てる。どちらでも `path` 無しのテストを1本足す

### [HIGH] H-3 `no-path` を `warning`（再試行で直る）にしたが、同じ操作では絶対に直らない

- reviewer: robustness / comment（別々の根拠で同じ結論）
- 場所: `src/features/position-search/ui/PositionSearchModal.tsx:31-36`、`entities/search/model/provider.tsx:250-253`、`model/reducer.ts:47-61`、`src-tauri/src/search/query_service.rs:151`、`store/file_table.rs:50-53`
- 根拠: Rust は1回の検索のあいだ同じスナップショットを使い、`get_path` が `None` のときだけ空文字を入れる。`mergeFiles` は同じ値なら書き換えない。**同じ索引に同じ SFEN を投げれば必ず同じ空パスが返る**
- なぜ問題か: ADR-0004 決定1 の `warning` は「同じ操作をもう一度で直る見込みがある」。この枝は押すたびに同じ断りが出る。しかも本文が案内する「検索し直す」操作は画面に無い（再検索が走るのは `queryKey` が変わったときと開き直したときだけ）。**インライン通知の1件目がこの形で入ると、以降の断りの手本になる**
- 直し方: 段を `danger` にし、本文から「検索し直すと直ることがあります」を落として「索引が更新されるまでこの結果からは開けません。一覧から別のヒットを選んでください」にする。`warning` を維持するなら `actions` に実際に再検索を撃つ動作を渡す（ADR-0004 決定3）。コメント・spec・台帳の3箇所を同時に直す

### [HIGH] H-4 `followNonce` の追い直しは器が縮む**前**の高さで走るので、`align="auto"` では一度も動かない

- reviewer: ui / react（`react-window` の実装まで読んで同じ結論）
- 場所: `src/features/position-search/lib/virtual/VirtualList.tsx:23-30`、`node_modules/react-window/dist/react-window.js:20-30` `:54-62` `:145-178` `:308-317`
- 根拠: `style={{ height: "100%" }}` は `ce()` に捨てられるので `containerSize` は **ResizeObserver 由来の state だけ**。断りが出るコミットでは passive effect（`scrollToRow`）が先に走り、そのとき `containerSize` は縮む前の値。`align: "auto"` は「見えているなら現在値を返す」ので無操作になり、その後 RO が高さを更新しても依存は変わらず再発火しない
- なぜ問題か: r1 M-4 が塞いだつもりの「断りだけが見えていて、それが指す行は視界の外」がそのまま残る。しかも `followNonce` に渡しているのが真偽値なので、**同じ行のまま段が入れ替わって箱の高さが変わる筋**（`no-path` → `not-in-tree`）も拾えない
- 直し方: `List` の `onResize` で内部の合図を上げ、追従の依存に入れて `VirtualList` の中に閉じる（外部 prop の `followNonce` / `hasNotice` ごと落とせる）。回避だけなら nonce 由来の追い直しを `align: "center"` にする

### [HIGH] H-5 選択追従の `findIndex` が全件ぶんの `hitKey` を作り直す。2回目以降の検索では鍵が残るので毎チャンク**全件**走る

- reviewer: perf（node で同じ式を再現して実測）
- 場所: `src/features/position-search/ui/PositionSearchModal.tsx:208-213`、`:189`、`:126-139`（後始末で ref を消していない）、`lib/orderPositionHits.ts:11-12`
- 根拠: `hitKey` は `cursorFromLite` → `cursorKey` で `normalizeForkPointers` を2回通し `JSON.stringify` する。実測 0.5〜2.7µs/件。モーダルは常時マウントで、閉じるときの後始末は `activeIndex` を戻すのに `activeKeyRef` を消さない。**一度でも行を選んで閉じたら、次の検索では鍵が見つからず毎回最後まで走る**
- 実測（チャンク到着ぶんの合計）: n=3,000 → 4ms / n=10,000 → **436ms** / n=30,000 → **2.8s** / n=100,000 → **24s**
- なぜ問題か: 局面検索の n は「その局面を含む棋譜の数」で、序盤ほどワークスペースの本数に近づく。r1 H-2 の修正が鍵を残す形にしたことで、この経路が常態化した
- 直し方: 鍵の文字列でなく**ヒットの参照**で追う（`indexOf`）。要素の同一性はセッション中保たれる。実測で n=100,000 が 186ms → 0.04ms。あわせて閉じるとき／`queryKey` が変わったときに ref を落とす

### [HIGH] H-6 台帳 F-32 のセルに同じ一文が2回入り、存在しない脚注 `※6` を指している

- reviewer: robustness / comment / oss-hygiene / architecture（4人）
- 場所: `docs/state-transitions/failure-surfacing.md:130`
- 根拠: 「…着いた局面が要求どおりかも見ていない（下の ※6）**着いた局面が要求どおりかも見ていない**（`reachedCursor` の本番の呼び手は0件 → #443）」。`※6` はこのファイルに存在しない
- なぜ問題か: r1 の順12（H-4）が「下の ※6」を書き、順13（H-5）が脚注を書く代わりに同じ文を後ろに足したので両方残った。**私の消し残し。** 台帳は他の doc からの唯一の参照先で、行き先の無い脚注は読み手に探させる
- 直し方: 前半を削り、太字の1文だけ残す

### [HIGH] H-7 遷移表の `enter` が「同上」になり、直前の行（`arrow`）を指してしまう

- reviewer: robustness / comment / oss-hygiene（3人）
- 場所: `docs/state-transitions/position-search-view.md:61-63`
- 根拠: 並びは `dblclick` → `arrow` → `enter`。このリポジトリの表で「同上」は直前の行を指す用法（`position-search.md:101` がその例）
- なぜ問題か: **r1 の H-7 が直そうとした「唯一の網羅表が実装と反対を言う」が、書き方を変えただけで戻っている。** 素直に読むと「Enter で選択が動く（開かない）」
- 直し方: `dblclick` と同じ本文を書く（表は縦に長くならない）。「同上」は使わない

### [HIGH] H-8 #445 の本文が走査の範囲を事実と逆に書いている

- reviewer: oss-hygiene
- 場所: `gh issue view 445` の事実表と第2段落。出所は r1 報告書の「lint / hook で強制できるもの」
- 根拠: `src/__tests__/docsIdentifiers.ts:50-57` の corpus は **`src/` と `rustRoots()`（`src-tauri/src`）の両方**。対象は `state-transitions/` 配下**全部**。つまり F-32 が名乗る `run_rescan_diff_apply` は、Rust 側を改名すれば `npm run verify` が落ちる
- なぜ問題か: #445 は「`docs/state-transitions/**` も無防備」という誤った前提で「決めること」を出している。無防備なのは `docs/spec/screens/**` だけ
- 直し方: `gh issue edit 445` で本文とタイトルを直す。r1 報告書の該当行にも追記して、次のラウンドで再利用されないようにする

### [HIGH] H-9 選択のたびに `read_file` を1回 invoke して棋譜を全文読み直し、全文パースして再生している

- reviewer: perf（実測つき。**`main` から在る。この差分が作ったものではない**）
- 場所: `src/features/position-search/ui/PositionSearchContinuation.tsx:78-125` `:55-61` `:67`
- 根拠: effect の入力が `activeHit` なので矢印1打鍵につき1回走る。デバウンスも in-flight の合流も無い。LRU は abs パスで16件だが、**局面検索のヒットは1ファイル1件になりやすい**のでほぼ全打鍵がミス
- 実測: `buildPlayer` は 60手 0.13ms / 300手 2.54ms。押しっぱなし（25〜30/s）で `read_file` が秒間25〜30回、100KB の棋譜なら 2.5〜3MB/s を IPC 越しに運び続ける
- 直し方: `activeHit` に 150〜200ms のデバウンス、LRU の値を `Promise` にして重複 invoke を畳む、`seqRef` の照合を `await` の直後にも置く

### [MEDIUM] M-1 選択の真実の源が `activeIndex` と `activeKeyRef` の2つあり、鍵の後片付けがクランプの副作用に**偶然**乗っている

- reviewer: react
- 場所: `PositionSearchModal.tsx:186-213` `:126-139` `:230`
- 根拠: 閉じる枝は `setActiveIndex(0)` と `setRefusedHit(null)` を戻すが `activeKeyRef` を戻さない。鍵が実際に消えるのは、開き直した最初のレンダ（ヒット0件）でクランプが `selectIndex(0)` を通り `orderedHits[0]` が `undefined` になるからだけ
- なぜ問題か: `if (n === 0) return;` のような自然な整理を入れた瞬間、前の検索の鍵が生き残り、同じ局面で開き直したときに選択が先頭でない行へ飛ぶ。H-5 の実測もこの取り残しに乗っている
- 直し方: 鍵を単一の真実の源にする（`activeKey` を state にし `activeIndex` を導出）か、最低限 `:136` / `:154` で ref を明示的に落とす

### [MEDIUM] M-2 `not-in-tree` が「ツリーがまだ無い／読み込みに失敗した」場合まで飲み込み、移動・削除を断定する

- reviewer: robustness
- 場所: `usePositionHitNavigation.ts:55-58`、`entities/file-tree/model/provider.tsx:229-238`（`findNodeByPath` は `fileTree` が `null` なら `null`）
- 根拠: 索引は cache から復元されるので、ツリーの取得が落ちた回でも検索結果は並ぶ。その状態でどのヒットを Enter しても「移動・削除されたか」と出る
- なぜ問題か: **ファイルは1つも動いていないのに、利用者は消えた棋譜を探しに行く。** 段も合わない（ツリーが読めれば同じ操作で開けるので `danger` ではない）
- 直し方: `fileTree == null` を3つ目の理由（`tree-unavailable` / `warning`）として返す

### [MEDIUM] M-3 `followNonce` が拾うのは親の断りだけで、同じ器を縮めるもう1つの断り（`pos-search__notice`）を拾っていない

- reviewer: architecture / comment
- 場所: `PositionSearchHitList.tsx:103-107` と `:123`
- 根拠: 一覧自身が出す「途中で失敗したので…」も `.pos-search__results` の中で器を縮めるが、`hasNotice` には入らない
- なぜ問題か: `L-strm × fail`（行は残す）の経路で M-4 が塞いだはずの症状が残る。器を縮めているのはこのコンポーネント自身なので、外から教えてもらう形が噛み合っていない。`hasNotice` という名前もこのファイルの中では `pos-search__notice` と読める
- 直し方: H-4 の直し（`onResize` で `VirtualList` の中に閉じる）を採れば、この prop ごと消える

### [MEDIUM] M-4 `REFUSALS` の段と文言が、`entities/file-tree` の `fsErrorTier` / `describeFsError` と二重になり、段が食い違う

- reviewer: architecture
- 場所: `PositionSearchModal.tsx:24-42`、`entities/file-tree/api/error.ts:164-204` `:241-284`
- 根拠: 同じ事実（棋譜がその場所に無い）に `fsErrorTier("not_found")` は `warning`、`REFUSALS["not-in-tree"]` は `danger`。文言もほぼ同じ日本語が2つ
- 直し方: 出典を決める。`describeFsError` から取って画面固有の補足だけ足すか、`REFUSALS` を残すなら段が割れる理由（索引を作り直す口が UI に無い）をその場に1行書く

### [MEDIUM] M-5 `danger` の断りが「次に何をすればよいか」を1文字も言っていない

- reviewer: robustness
- 場所: `PositionSearchModal.tsx:37-41`、台帳の復帰導線の欄
- 根拠: 本文は原因の説明だけで、`actions` も無い。台帳だけが「別のヒットを選ぶ」を知っている
- なぜ問題か: r1 H-6 の直し方は「欄を実態に直す」と「本文にも導線を足す」の2つだったが、入ったのは前者だけ
- 直し方: `not-in-tree` の本文に「一覧から別のヒットを選んでください。」を足す

### [MEDIUM] M-6 フックと仕様書の見出しが「同一ファイルなら即 applyCursor」のままで、実装の3条件を落としている

- reviewer: comment / robustness
- 場所: `usePositionHitNavigation.ts:13-24`（見出し）と `:42-53`（実際の門）、`docs/spec/screens/position-search.md:82`
- なぜ問題か: 同じ doc コメントの中で冒頭の箇条書きと本文（「`selectedNode` だけで判定しない」）が食い違う。見出しだけ読んだ人は門を「冗長」と見て外す
- 直し方: 「その棋譜が**盤に載り終わっていれば**即 `applyCursor`」に直す。仕様書の1も同じ語にそろえる

### [MEDIUM] M-7 `L-strm` 行に付けた ✓ を踏むテストが無い。支えに挙げたテストの説明も違う

- reviewer: comment / oss-hygiene / react
- 場所: `docs/state-transitions/position-search-view.md:74` `:80` `:116-120`
- 根拠: モーダルのモックは `isSearchingRequest: () => false` / `isDone: true` なので、テストは常に `L-hits`。`L-strm` で `enter` / `arrow` を撃つテストは無い。`PositionSearchHitList.test.tsx` に `rerender` は無いので「chunk での選択」も踏んでいない。さらに `:114` の「踏んでいるのは上の `✓` だけ。残りは1つも見ていない」の直後に、踏んでいる項目が並んでいて自己矛盾
- 直し方: `L-strm` の ✓ を落として「埋まっていないセル」に `(L-strm, enter)` `(L-strm, arrow)` を足すか、モックに `isSearchingRequest` を切り替える口を作って実際に踏む。`:114` は `main` の1文の形に戻す

### [MEDIUM] M-8 仕様書の出入口表が「必ず開いて閉じる」のまま

- reviewer: oss-hygiene
- 場所: `docs/spec/screens/position-search.md:20` `:67` `:69`
- なぜ問題か: 3枚のうち仕様書の入口の表だけが無条件の「開いて閉じる」を主張したまま。`position-search-view.md` は既に条件付きに直っている
- 直し方: 「移動を始められたら開いて閉じる（始められなければ断って残る）」に直す

### [MEDIUM] M-9 仕様書が挙げた2つの理由が、どちらも指した先で裏付けられない

- reviewer: comment / oss-hygiene
- 場所: `docs/spec/screens/position-search.md:91-94`、`docs/state-transitions/search.md:78-93` `:50`
- 根拠: (a)「ツリーは即座に読み直される」が成り立つのはアプリ内の操作だけ。`entities/file-tree` にファイル監視の購読は1つも無く、**Finder で消した場合は遅れているのはツリーのほう**。(b)「watcher の起動に失敗した回」は `search.md` のどこにも書かれていない。(c) 「静穏 800ms」は `search.md:50` にもあり写しになっている
- 直し方: (a) を「アプリ内で消したときはツリーだけが即座に読み直される」に限定し、(b) を `search.md` の watcher の節へ移してから指す。(c) の数値は spec から落とす

### [MEDIUM] M-10 §4「まだ出口が無いもの」に F-32 / #443 が無い

- reviewer: oss-hygiene
- 場所: `docs/state-transitions/failure-surfacing.md:189-207`
- 根拠: §4 の抽出条件（「何も出ない」を含む）に、F-32 が残した3枝（#434 / ディレクトリ / #443）が該当する
- 直し方: §4 の表に `| F-32 | #443 | …（塞いでいない枝）|` を足す

### [MEDIUM] M-11 §2 の凡例が「F-19〜F-31 の段はどこにも無い」と断言するが、F-19 のセルは「段が違う」と書いている

- reviewer: oss-hygiene
- 場所: `failure-surfacing.md:91-94`（r1 で足した凡例）と `:117`
- 根拠: F-19 の言う `error` / `warn` は tracing のレベルで、ADR-0004 の段ではない。同じ表で「段」が2つの意味になった
- 直し方: F-19 を「種別で**ログの重さ**が違う」に直すか、凡例に1行添える

### [MEDIUM] M-12 仕様書の「いま満たしていないこと」に #443 / #444 が無い

- reviewer: oss-hygiene
- 場所: `docs/spec/screens/position-search.md:113-122`。比較対象は `app-layout.md`（#434 を本文と節の両方に置いている）
- 直し方: 2行足す

### [MEDIUM] M-13 `write-issue` の SKILL が「まだ作られていない」と書くラベルを、今回の3本が実際に使っている

- reviewer: oss-hygiene
- 場所: `.claude/skills/write-issue/SKILL.md:107-110`
- 根拠: `area:kifu` / `area:game` / `area:search` / `area:build` は実在する（#443 / #444 / #445 が使用）
- 直し方: 一覧の写しを消して「`gh label list` で見る」に置き換える（`CLAUDE.md` の「件数をここに書かない」と同じ扱い）

### [MEDIUM] M-14 `accept` の中に `REFUSALS` の doc と同じ理由がもう一度書かれている

- reviewer: comment
- 場所: `PositionSearchModal.tsx:221-226`
- 直し方: 1行に縮める（「断りの文言と段は `REFUSALS`」）。理由の持ち主を1箇所にする

### [MEDIUM] M-15 テストのコメントが、その fixture では起きない並び替えを根拠にしている

- reviewer: comment
- 場所: `PositionSearchModal.test.tsx:81-82` `:166-178`
- 根拠: `loadedAbsPath` が `/root/a.kif`、`resolveHitAbsPath` が `/root/{fileId}.kif` なので一致する行が無く、`orderPositionHits` は入力をそのまま返す。実際に踏んでいるのは「先頭への差し込みで添字がずれる」経路だけ
- 直し方: コメントを実際の仕掛けに合わせるか、`loadedAbsPath` を合わせて並び替えを実際に起こす

### [MEDIUM] M-16 「続き」の effect が `resolveAbsPath` を依存に持つため、選択が動いていないのにチャンクごとに再実行される

- reviewer: perf（**`main` から在る**）
- 場所: `PositionSearchContinuation.tsx:125`、`entities/search/model/reducer.ts:163`
- 実測: n=3,000 で10回、n=30,000 で100回、n=100,000 で334回。そのたびに「取得中…」へ差し替わる
- 直し方: 依存を `key`（`abs::cursorKey`）だけにする

### [MEDIUM] M-17 `getHitsByRequestId` の「償却 O(n)」の注釈が現物と食い違う

- reviewer: perf（**`main` から在る**）
- 場所: `entities/search/model/provider.tsx:61-66` `:215-231`、`model/reducer.ts:168`
- 根拠: キャッシュの条件は `cache.chunksRef === session.chunks` だが、reducer は毎回 `chunks` を差し替えるので**増分追記は一度も起きない**。実測で n=100,000 の合計 836ms（並べ替えは 2,357ms）
- 直し方: 判定を「消費済みチャンク数＋直前チャンクの参照」にするか、**注釈を現物に直す**（この注釈があるせいで、速さを疑う人がここを容疑者から外す）

## 重複・矛盾した所見

- **H-6（※6 の重複）は4人、H-7（`enter | 同上`）は3人、M-7（`L-strm` の ✓）は3人**が独立に挙げた。いずれも r1 の修正が作ったもの
- **H-4 と M-3 は同じ直しで消える。** `VirtualList` が `onResize` で自分の高さの変化を拾えば、`followNonce` / `hasNotice` の prop 経路ごと不要になる
- **H-3（`no-path` の段）と M-4（`fsErrorTier` との二重）は互いに反対方向を向きうる。** H-3 は `danger` へ寄せろと言い、M-4 は `fsErrorTier`（`not_found` は `warning`）を出典にせよと言う。**決めること: 段の出典を `fsErrorTier` にするか、この画面の復帰可能性で決めるか**
- **H-5 と M-1 は同じ根**（`activeKeyRef` の後片付けが無い）。M-1 を直すと H-5 の (a) の踏み方が消える
- **H-9 / M-16 / M-17 は `main` から在る**もので、この差分が作ったものではない。ただし H-5 は r1 の修正が常態化させた

## 見ていない範囲

- 実描画・実機は誰も確認していない。ui / react / perf の数値はいずれも机上か node での再現で、ブラウザ上の計測は無い
- `PositionSearchContinuation` / `PositionSearchDestinationCard` / `PositionSearchStatusBar` / `PositionHitItem` の中身（perf が H-9 / M-16 のために読んだ範囲を除く）
- `parseKifuStringToJKF` の実コスト（測ったのは `buildPlayer` + `goto` だけ）
- Rust 側は `query_service.rs` / `store/file_table.rs` / `commands.rs` / `crates/fs/src/error.rs` の該当箇所のみ
- ADR-0004 の決定本文（読んだのは段の定義と割り当て表）
- `docs/state-transitions/README.md` を今回の変更が更新すべきかは未確認
- `npm run verify` / `verify:rust` は reviewer の誰も通していない（**この差分自体は各コミットで gate を通してある**）

## lint / hook で強制できるもの

- **`docs/**/\*.md`の`※\d+` に同じファイル内の定義があるか**（H-6 を機械で止められる。`docsIdentifiers.test.ts` と同じ枠）
- **表のセルに `同上` だけを書かせない**（H-7）
- **`hitKey` の呼び出し回数と `read_file` の invoke 回数を数えるテスト**（H-5 / H-9 の再発はこれでしか止まらない）
- **`entities/game` の `isLoading` を「読み込み中」の意味で読ませない走査**（H-1）。ただし `CLAUDE.md` の two-strikes に照らすと、いまは**テスト**（`stub.isLoading = true` の1本）で守るほうが先
- **`FsError.path` を等値比較している箇所の禁止**、または `asFsError` に `path` を補わせる走査（H-2）
- **`position-search-view.md` を `stateTransitionCells` の `SCANNED` に入れる**（M-7）。ただし #435 の棚卸しとセット。**いまの「埋まっていないセル」節は散文なので、載せても未踏セルが機械に見えない**（`(状態, 事象)` の対で書く必要がある）
- **隣接する段どうしの見分けを測るラチェット**（`$color-warning` と `$color-danger-text` の帯は明度比 1.05:1。`Notice.scss:10-11` の「段は帯と記号が持つ」は隣接段では成り立っていない）→ #444 に追記
- 機械では止まらないもの: B-1（コメントと経路の食い違い）、H-3 / M-4（段の判断）、H-4（effect と ResizeObserver の順序。jsdom に RO も版組も無い）

## 修正計画（r2 → r3）

**ユーザーが決めた2点。**

1. **段の出典はこの画面の復帰可能性で決める**（`fsErrorTier` に寄せない）。理由は、この断りは fs を1回も叩いていない——`startNavigationToHit` が見るのは索引とツリーの食い違いだけなので `FsError` の語彙ではない。分かれる理由は `REFUSALS` のその場に書く（M-4）
2. **perf の3件（H-9 / M-16 / M-17）は issue にする。** 実測と直し方を本文に入れる。**H-5 と M-1 は別**——r1 の修正が常態化させたので、この PR で取る

### 束（同じ根から出ている所見）

- **段と文言**: H-3 → M-2 → M-5 → M-4。H-3（`no-path` を `danger` へ）を先に入れると、`warning` の使い道が「ツリーがまだ読めていない」（M-2）だけになり、段が意味を取り戻す。M-4 はその結論を書き残す役
- **追い直し**: H-4 → M-3。`VirtualList` の中に閉じると `followNonce` / `hasNotice` の prop ごと消えるので、M-3 は自動的に無くなる
- **選択の同一性**: H-5 → M-1 → B-1。参照で追う形にすると鍵の文字列が消え、後片付けの置き場も1つになる。B-1 のコメントはその後で書き直す
- **doc の3枚**: H-6 / H-7 / M-7 / M-10 / M-11 / M-8 / M-9 / M-12。**互いに矛盾を作らないよう同じラウンドで入れる**
- **issue の訂正**: H-8（#445 の事実誤り）と M-13（SKILL のラベル一覧）は独立

### このラウンドで直すもの

| 順  | 所見 | なぜこの順か                                                                            | この直し方で壊しうるもの                                                                                                                                                                                                                      |
| --- | ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | H-8  | 誤った前提の issue が残っていると、次の人がそれを根拠に着手する。**最も早く消す**       | #445 のタイトルと本文が変わるので、r1 報告書の該当行への追記を忘れると出所が食い違う                                                                                                                                                          |
| 2   | H-1  | 門を1つ落とす。以降の修正がこの門の上に積まれる前に                                     | `isLoading` を落とすと、**保存が飛んでいる最中に速い経路へ入る**ようになる。当てる先は `loadedAbsPath` が一致する棋譜なので当たり先は正しいが、書き込み中に `applyCursor` が走る組み合わせが新しくできる                                      |
| 3   | H-2  | 失敗経路の門。`path` を補う側（`entities/file-tree`）を直すので、他の読み手にも波及する | `readKifu` の失敗に `path` が必ず入るので、`KifuReadErrorDialog` の表示が「パス無し」から「パスあり」に変わる（改善だが見た目が変わる）                                                                                                       |
| 4   | H-3  | 段の束の先頭。`warning` の使い道がここで空く                                            | 断りが2つとも `danger` になるので、**段で見分ける情報が一時的に消える**（M-2 で `warning` が戻るまでの1コミットのあいだ）                                                                                                                     |
| 5   | M-2  | H-3 の直後。`warning` をここへ移す                                                      | `fileTree == null` を読むためにフックが `useFileTree()` の項目を1つ増やす。ツリーが空（ワークスペースが空）の場合と読めていない場合の区別は `fileTree` の有無だけなので、**空のワークスペースで「まだ読み込めていません」と出る**可能性がある |
| 6   | M-5  | 文言。段が確定してから                                                                  | 無し                                                                                                                                                                                                                                          |
| 7   | M-4  | 上の結論を書き残す。コメントのみ                                                        | 無し                                                                                                                                                                                                                                          |
| 8   | H-4  | 追い直しを `VirtualList` の中へ。M-3 がここで消える                                     | `onResize` は器の高さが変わるたびに発火するので、**ウィンドウのリサイズ中にも選択行へ引き戻す**。追い直しの条件を「高さが縮んだとき」に絞らないと、拡大中も走る                                                                               |
| 9   | M-3  | H-4 で prop を落としたことの後片付け（`hasNotice` の削除）                              | 無し（8 と同じ形なら消えるだけ）                                                                                                                                                                                                              |
| 10  | H-5  | 選択の同一性を参照へ                                                                    | **ヒットの参照が保たれる前提に乗る**。`getHitsByRequestId` のキャッシュが将来「毎回新しいオブジェクトを作る」形になると、追従が黙って効かなくなる。前提をコメントに書き、参照が変わったら追えないことをテストで固定する                       |
| 11  | M-1  | 10 の後片付け。閉じるとき／再検索のときに落とす                                         | 無し                                                                                                                                                                                                                                          |
| 12  | B-1  | コメントを事実に合わせる。10・11 で経路が変わってから書く                               | 無し                                                                                                                                                                                                                                          |
| 13  | M-6  | フックと仕様書の見出し                                                                  | 無し                                                                                                                                                                                                                                          |
| 14  | M-14 | `accept` の重複コメント                                                                 | 無し                                                                                                                                                                                                                                          |
| 15  | M-15 | テストのコメント                                                                        | 無し                                                                                                                                                                                                                                          |
| 16  | H-6  | doc。台帳から。**私の消し残し**                                                         | 無し                                                                                                                                                                                                                                          |
| 17  | H-7  | 遷移表                                                                                  | 無し                                                                                                                                                                                                                                          |
| 18  | M-7  | 遷移表の ✓ と「埋まっていないセル」                                                     | ✓ を落とすと、この表は「踏んでいるセルが1つも無い」に近づく。**それが事実**なので隠さない                                                                                                                                                     |
| 19  | M-10 | §4 に F-32 / #443                                                                       | 無し                                                                                                                                                                                                                                          |
| 20  | M-11 | F-19 の「段」＝ログの重さ                                                               | 無し                                                                                                                                                                                                                                          |
| 21  | M-8  | 仕様書の出入口表                                                                        | 無し                                                                                                                                                                                                                                          |
| 22  | M-9  | 仕様書の理由と `search.md` の分担                                                       | watcher の起動失敗を `search.md` へ移すので、**`search.md` の状態表に新しい節が増える**。表そのものは変えない                                                                                                                                 |
| 23  | M-12 | 仕様書の「いま満たしていないこと」                                                      | 無し                                                                                                                                                                                                                                          |
| 24  | M-13 | `write-issue` の SKILL からラベルの写しを落とす                                         | 無し                                                                                                                                                                                                                                          |

### 直さないもの

| 所見                                                              | 行き先                       | 理由                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| H-9 選択のたびに `read_file` + 全文パース                         | **issue**（perf 3件を1本に） | `main` から在る。デバウンス・`Promise` の LRU・`seqRef` の照合位置と、直し方が3つに分かれる。実測を本文に入れる |
| M-16 「続き」の effect が `resolveAbsPath` 依存で毎チャンク再実行 | **同じ issue**               | 同上。依存を `key` だけにする案を本文へ                                                                         |
| M-17 `getHitsByRequestId` の「償却 O(n)」が現物と違う             | **同じ issue**               | 同上。**注釈を直すだけでも価値がある**ので、その旨を本文に書く                                                  |
| ui V-3（`warning` と `danger` の帯が明度比 1.05:1）               | **#444 に追記**              | 面と帯の対の話で、#444 の範囲。段が両方 `danger` になる本ラウンドの修正で、この PR の中では並ばなくなる         |
| ui V-2（`$surface-warning` の対が2つ）                            | **#444 に追記**              | 同上                                                                                                            |

### 対象そのものを疑ったか

**`PositionSearchModal` に所見が集まっている**——B-1 / H-3 / H-5 / M-1 / M-4 / M-5 / M-14 の7件。react が「353行に検索の起動・選択の同一性・断り・描画の4つが同居している」と名指しした。

**今回は割らない。** 割る（`usePositionSearchQuery` / `useKeyedSelection` に抜く）と #420 の差分が読めなくなる。ただし**次に誰かがこのファイルを触るときの最初の作業として**、r3 の報告書に1行残す。

`VirtualList` の `followNonce` は**呼び手1つの抽象**だった（architecture が指摘）。順8 で prop ごと落とすので、この機構は消える。

### 次ラウンドの焦点

1. `isLoading` を落としたことで、**保存が飛んでいる最中に `applyCursor` が走る**組み合わせが問題にならないか（順2）
2. `readKifu` に `path` を補ったことで、`kifuError` の他の読み手（`KifuReadErrorDialog`）の見え方が壊れていないか（順3）
3. 断りが3つ（`no-path` / `not-in-tree` / `tree-unavailable`）になり、段が `danger` 2 + `warning` 1 に割れた。**枝と段と文言が1対1で対応しているか**（順4〜7）
4. `onResize` 由来の追い直しが、**ウィンドウのリサイズや行の実測（`useDynamicRowHeight`）で暴発していないか**（順8）
5. 選択を参照で追う形が、**ヒットの参照が変わる経路（再検索・`requestId` の切り替え）で黙って効かなくなっていないか**（順10・11）
6. doc 3枚（仕様書・遷移表・台帳）と `search.md` が、**互いに矛盾せず、同じことを2箇所で言っていないか**（順16〜23）
7. r2 で挙がった perf の3件を issue へ送ったが、**この PR の変更がその3件を悪化させていないか**（H-5 の修正で `hitKey` の呼び出しが本当に減ったか）

### 検証の見積り

- 順1・24（`.claude/` 配下と GitHub）: gate は `.claude/reviews` を素通し、`skills` は `verify` のみ ≒ **2分**
- 順2〜15（TS）: 14件 × `npm run verify`（約40秒）≒ **10分**
- 順16〜23（`docs/state-transitions/` を含む6件 ＋ spec のみ2件）: 6 × 3分 ＋ 2 × 40秒 ≒ **19分**

合計 **約31分**。r1 と同じく doc は分割せず同じラウンドで入れる（片方だけ直すと3枚が別のことを言う）。
