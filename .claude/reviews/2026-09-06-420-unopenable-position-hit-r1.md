# レビュー 420-unopenable-position-hit ラウンド1

- 日付: 2026-09-06
- 範囲: `git diff main...HEAD`（6ファイル）
  - `src/features/position-search/ui/PositionSearchModal.tsx`
  - `src/features/position-search/lib/usePositionHitNavigation.ts`
  - `src/features/position-search/ui/__tests__/PositionSearchModal.test.tsx`
  - `src/features/position-search/lib/__tests__/usePositionHitNavigation.test.tsx`
  - `docs/spec/screens/position-search.md`
  - `docs/state-transitions/failure-surfacing.md`
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene（6）
- 対象コミット: `3e74ed04`
- 変更の意図: #420。ツリーに無い棋譜のヒットを開こうとしたときに、モーダルが黙って閉じて盤が前の棋譜のまま残るのを止める。`navigateToHit` に成否を返させ、失敗時は `InlineNotice`（`danger`）を一覧の上に出して閉じない。

**BLOCK 0 / HIGH 7 / MEDIUM 12。**

## 所見

### [HIGH] H-1 即時経路が「盤に載っている棋譜」を見ないので、別の棋譜へカーソルを当てて `true` を返す

- reviewer: react / robustness（別々のシナリオで同じ根に到達）
- 場所: `src/features/position-search/lib/usePositionHitNavigation.ts:36-45`（判定は `selectedNode.path` のみ）。対する effect は `:62-70` で `gameState.loadedAbsPath !== p.absPath` を要求している
- 根拠: `gameView.player` は `buildPlayer(state.jkf, state.cursor)`（`entities/game/model/provider.tsx:109`）＝**いま盤に載っている棋譜**の再生器。`selectedNode` はツリーの選択でしかない。速い経路にだけ `loadedAbsPath` の門が無い
- なぜ問題か: 踏み方が2つある
  1. ツリーで b.kif をクリックした直後（`openKifuNode` の飛行中）に検索を開いて b.kif のヒットで Enter すると、`selectedNode.path === b` かつ `player`（a.kif のもの）で速い経路に入り、**a.kif に b.kif のカーソルを当てて** `true` を返す。呼び手は閉じる
  2. 盤に載せられない棋譜（台帳 F-31）のヒットを2回開くと、2回目は `isAlreadyActive`（`entities/file-tree/model/provider.tsx:676-679`）で再オープンもされず、同じく前の棋譜へ当たる
     どちらも**この PR が消したかった「静かに嘘をつく」状態**が別の入口で残る。しかも `pendingRef` は落ちているので当て直しも起きない
- さらに: **新しいフックテストの3本目**（`usePositionHitNavigation.test.tsx:66-75`）が `loadedAbsPath: null` のまま `true` と `applyCursor` 1回を期待しているので、**この門を足す正しい修正はテストを赤にする**。テストが誤った契約を固定している
- 直し方: 速い経路の条件に `!gameState.isLoading && gameState.loadedAbsPath === absPath` を足し、`useCallback` の依存にも入れる。外れたときは遅い経路へ落とす。テスト3本目は `loadedAbsPath` を与える形に直し、「選択済みだがまだ読み込み中」で `applyCursor` が呼ばれない1本を足す

- 結果: 対応済み（`0490389e` 速い経路に `!isLoading && loadedAbsPath === absPath` を足し、フックテストの誤った期待も直した。門を外すと新しいテストが落ちることを確認）

### [HIGH] H-2 選択追従の effect が自分で先に上書きしているので効いておらず、断りがひとりでに消える

- reviewer: react（同じ形の probe を書いて実測。`hits: ["X","Y"]` で X を選択 → `["Z","X","Y"]` に差し替えると選択が Z へ滑ることを確認）
- 場所: `src/features/position-search/ui/PositionSearchModal.tsx:157-176`。この上に `:221` の `isUnopenable` が乗っている
- 根拠: 2つの effect は宣言順に走るので、並び替えが起きたレンダでは先に走る `activeKeyRef` の更新が「滑った先の鍵」を書き、後ろの追従 effect は自分が書いた鍵を引いて何もしない
- なぜ問題か: `orderPositionHits` は開いている棋譜のヒットを先頭へ寄せるので、`chunkSize: 300` の2つ目以降のチャンクに同一ファイルのヒットが1件混じるだけで選択行が動く。この差分にとっては、**断りを出した直後にチャンクが届くと `activeHit` が変わり、再試行も選び直しもしていないのに断りが黙って消える**。`isUnopenable` を鍵で導出した狙い（H-3 の下の M-9 も参照）が、この既存の壊れで成立していない
- 直し方: `activeKeyRef` を「利用者の操作で選択が変わったときだけ」書く。`setActiveIndex` を包む `selectByIndex(i)` を作ってその中で鍵を更新し、`activeHit` に依存する effect（`:160-162`）を消す。追従 effect の依存は `[orderedHits]` だけにする
- 注: これは `main` から在る壊れで、この PR が作ったものではない。ただし**この PR の断りの寿命がこの壊れに乗っている**

- 結果: 対応済み（`60389659` 鍵を書くのは利用者が選んだときだけにし、矢印・行の選択・Enter を `selectIndex` に集約。並び替えで断りが消えないことをテストで固定し、元の形に戻すと落ちることを確認）

### [HIGH] H-3 失敗した移動の `pendingRef` が残り続け、後日その棋譜を開いた瞬間に盤が飛ぶ

- reviewer: architecture / robustness
- 場所: `src/features/position-search/lib/usePositionHitNavigation.ts:33`（入口で必ず立てる）、`:47-50`（`false` の枝だけ落とす）、`:58-70`（成功時に落ちる）
- 根拠: 落ちるのは「同一ファイルで即当てた」「`selectNodeByAbsPath` が false」「effect が当て終えた」の3つだけ。`openKifuNode` の失敗・`loadGame` の失敗・モーダルを閉じたことでは落ちない。`PositionSearchModal` は `pages/AppModalLayer.tsx` から常時マウントなので、フックも `pendingRef` も**アプリが動いている間ずっと生きる**
- なぜ問題か: 文字コードで開けない棋譜（#325）のヒットを開く → 失敗 → 利用者は別の作業へ。後日その棋譜を直してツリーから開くと、読み込み完了の瞬間に effect が発火して**盤が 0 手目でなく当時のヒットの手数へ飛ぶ**。理由はどこにも出ない
- 直し方: `pendingRef` に世代（`navigateToHit` ごとに増やす番号）を持たせ、effect は世代が一致するときだけ当てる。加えて「別のファイルが載り終わった」時点（`!isLoading && loadedAbsPath !== null && loadedAbsPath !== p.absPath`）で落とす。モーダルが閉じたときに落とす口をフックから公開する

- 結果: 対応済み（`cba3328a` 別の棋譜を選んだときと `kifuError` がその棋譜を指したときに要求を捨てる。世代番号は入れていない——要求は常に1件で、上書きされる側が無いため）

### [HIGH] H-4 `true` を返しても着かない経路が3つ残り、うち2つは何も出ないまま閉じる。doc はそれを書いていない

- reviewer: robustness
- 場所: `src/entities/file-tree/model/provider.tsx:662-686`、`docs/spec/screens/position-search.md:97`、`docs/state-transitions/failure-surfacing.md:127`
- 根拠: `selectNodeByAbsPath` の `true` は「ツリーにノードがあった」しか意味しない（`void openKifuNode(node); // async-result-ignored`）
- なぜ問題か: 残る3経路は
  1. `openKifuNode` の失敗（文字コード #325 ほか）→ 閉じたあとに `KifuReadErrorDialog`。**ここだけ届く**
  2. `loadGame` の失敗（F-31）→ 読み手0。モーダルは閉じ、盤は前の棋譜のまま。**何も出ない**
  3. パスにディレクトリが居る → `true` が返り `pendingRef` は `!isDirectory` の門で永久に消化されない。**何も出ない**
     仕様書と台帳は「ヒットの棋譜を開けない → 閉じない」と条件を付けずに書いているので、読み手は 2 も 3 も塞がったと読む
- 直し方: doc を現物に合わせる（「**ツリーにノードが無い場合だけ**」と限定し、F-31 とディレクトリの枝は塞いでいないと書く）。コードで塞ぐなら `selectNodeByAbsPath` を `AsyncResult` にして `openKifuNode` の結末まで返し、`accept` を `await` にする

- 結果: 対応済み（`a2317b73` doc のみ。塞いだのは2枝だけで、F-31（#434）とディレクトリの枝は黙って閉じると書いた。コードでは塞いでいない）

### [HIGH] H-5 要求した局面に着いたかを `reachedCursor` で確かめないまま閉じる

- reviewer: robustness
- 場所: `src/features/position-search/lib/usePositionHitNavigation.ts:42-44` / `:68`、`src/entities/kifu/lib/playerCursor.ts:51-52`
- 根拠: `playerCursor.ts` 自身が「**いま本番でこれを呼ぶ側は無い。** 検索ヒットからの移動（`usePositionHitNavigation`）で突き合わせる作業は → #296」と書いている。`applyCursor` は戻り値が無く、失敗は `set_error`（読み手0）。`buildPlayer` の doc は「届かなければ黙って止まる」「実在しない変化は黙って捨て、要求した `tesuu` ちょうどで別の線に着く」
- なぜ問題か: 索引を張った後に棋譜が**編集**され再走査が追いついていない状態——この PR が前提に置いている状態そのもの——では、ヒットのカーソルが現物に無い。ファイルはツリーに在るので `navigateToHit` は `true`、盤は別の線へ着き、モーダルは閉じ、断りは出ない。**削除（今回塞いだ側）より編集のほうが日常的に起きる**
- 直し方: `reachedCursor` を通してから `applyCursor` し、着かなければ `false` を返して別の文言を出す。ここまでやらないなら、F-32 行と仕様書に「着いたかは見ていない（→ #296）」を明記する

- 結果: 見送り＋issue（`d1cd6214`。`applyCursor` の署名に触るので #288 の範囲。現在地を doc に書き、**#443** を立てた。#296 が COMPLETED で閉じているのに症状が残っていることも issue に書いた）

### [HIGH] H-6 台帳の復帰導線「索引の作り直しは設定タブ」に対応する操作が存在しない

- reviewer: robustness / comment / oss-hygiene（3人が独立に現物を確認）
- 場所: `docs/state-transitions/failure-surfacing.md:127` の復帰導線の欄。現物は `src/features/settings/ui/tabs/WorkspaceTab.tsx`
- 根拠: `WorkspaceTab` にあるのは状態表示・警告のクリア・パスのコピー・「ワークスペースを変更…」だけ。`openProject` を撃つのは `entities/search/model/provider.tsx` の起動時と `rootDir` 変更時のみで、索引を作り直す口は UI に1つも無い
- なぜ問題か: `danger` は ADR-0004 で「**別の操作が要る**」段。その別の操作が存在しないのに台帳が「ある」と書くと、次に読む人は復帰を済んだものとして扱う。`InlineNotice` の本文も次の一手を1文字も言っていない
- 直し方: (a) 索引を作り直す口を作って `actions` に載せる、(b) 作らないなら欄を「索引を作り直す口は無い（消えた棋譜が索引から消えるのは次の `run_rescan_diff_apply` が成功したときだけ）」に直し、本文にも「一覧から別のヒットを選んでください」を足して行き止まりを隠さない。ADR-0004 が F-17 に置いた「作り直す」ボタンも未実装なので、まとめて参照させる

- 結果: 対応済み（`43d0e07c` 「索引を作り直す口は UI に無い」に直した。指摘のとおり私の書き間違い）

### [HIGH] H-7 `position-search-view.md` の遷移表が「開いて閉じる」のままで、実装と反対を言っている

- reviewer: comment / oss-hygiene
- 場所: `docs/state-transitions/position-search-view.md:61` `:63` `:77` `:78`（`dblclick` / `enter` のセル）。実装は `PositionSearchModal.tsx:178-188`
- 根拠: `docs/spec/screens/position-search.md:8` が「この仕様書に状態の表を置かない」と宣言して網羅をこの表に委ねているのに、この PR は spec と台帳だけを直した
- なぜ問題か: 「Enter で閉じるか」を確かめに来た人が辿り着く唯一の網羅表が、実装と反対を言う。さらにこの PR で `PositionSearchModal.test.tsx` が `enter` の分岐を実際に踏むようになったので、表の「埋まっていないセル」の記述（「一覧だけを描くテストでは踏めない」）も古い
- 直し方: `dblclick` / `enter` のセルを「開けたら閉じる／開けなければ断りを出して残る」に割り、断りが出ている状態を列か状態として立てる。`click` / `arrow` で断りが消えること（`:221` の判定）も載せ、新しいテストに名乗らせる

- 結果: 対応済み（`9090fcc8` 事象表と表本体の `dblclick / enter` を割り、踏むようになったセルに ✓ を付けた。テスト側の「（表の …）」の名乗りは付けていない——この表を見るラチェットが無いので、名乗りだけ入れても機械では守られない）

### [MEDIUM] M-1 原因の違う2つの失敗を同じ文言に潰しており、`!absPath` の枝では文面が事実と逆

- reviewer: architecture / react / comment / oss-hygiene（4人）
- 場所: `PositionSearchModal.tsx:181-185` と `:249-255`、`entities/search/model/provider.tsx:250-253`、`src-tauri/src/search/query_service.rs:151`
- 根拠: `resolveHitAbsPath` が null / 空文字になるのは**索引がそのヒットのパスを送ってこなかった**とき（Rust が `unwrap_or_default()` で空文字を返し、`reducer.ts` の `mergeFiles` がそのまま格納する）。ツリーの有無とは無関係で、この枝では `navigateToHit` すら呼ばない
- なぜ問題か: 出す文面は「ワークスペースに見つかりませんでした。移動または削除された可能性があります（**索引にはまだ残っています**）」。索引側が欠けている場合に「索引には残っている」と断言し、動かしていないファイルを探しに行かせる。テスト（`PositionSearchModal.test.tsx:106-115`「索引にパスが無いヒットも同じ扱い」）がこの潰し方を固定している。台帳 F-32 と spec もこの枝を書いていない
- 直し方: 理由を値として持つ（`{ key, reason: "no-path" | "not-in-tree" }`、または `navigateToHit` の戻りを判別可能な型にする）。文言を2つに割り、台帳と spec の条件も2つに割る

- 結果: 対応済み（`9311bf80` 理由を値で持ち、`no-path` は `warning`、`not-in-tree` は `danger` に分けた。`startNavigationToHit` の戻りは `boolean` のまま——理由が増えるのは呼び手側の分岐で、フックが返せる失敗はいまも1つだけ）

### [MEDIUM] M-2 同じ左ペインに手書きの断りと `InlineNotice` が同居し、同じ面の上の文字トークンが2つに割れた

- reviewer: architecture / ui
- 場所: `PositionSearchModal.tsx:249-255`、`PositionSearchHitList.tsx:100-104`、`PositionSearchHitList.scss:23-39`、`Notice.scss:146-171`、`PositionSearchStatusBar.scss:16-18`
- 根拠: 検索が途中で落ちた状態で開けないヒットを Enter すると、状況バーの一行 ＋ `InlineNotice`（`role="alert"`・記号・`$font-body` の題・左帯）＋ `.pos-search__notice`（`role="status"`・記号なし・`$font-hint`・枠なし）が縦に3つ並ぶ。間隔の持ち主も割れる（親の `gap: $space-5` と自前の `margin-bottom: $space-3`）
- さらに: `$surface-danger` という同一の面の上に `.pos-search__empty--error` は `$color-danger-text`、`.notice--danger` は `$color-text-primary` と別トークンが載っている。危険色の文字を動かすと片方が漏れる
- 直し方: `PositionSearchHitList` の2箇所を `InlineNotice` へ寄せ（`.pos-search__notice` → `warning`、`.pos-search__empty--error` → `danger`）、`PositionSearchHitList.scss:23-39` を消す。寄せないなら、少なくとも `$surface-danger` の上の前景トークンを1つに決める
- **判断が要る**: 寄せるのは `/implement` 手順7 の「範囲の外」に当たりうる。同じ PR で寄せるか、issue へ送るかは計画側で決めること

- 結果: 見送り＋issue（**#444**。`PositionSearchHitList` の既存の2つの箱を寄せる作業で、#420 の差分が読めなくなる）

### [MEDIUM] M-3 左ペインに縦スクロールが無く、縮まない子が3つになった

- reviewer: ui
- 場所: `PositionSearchModal.scss:30-44`、`PositionSearchHitList.scss:3-9`
- 根拠: `.pos-search__left` は `overflow: hidden` で縦スクロールを持たない。`min-height: 0` を持つ子は `.pos-search__results` だけなので、状況バーと断りが伸びると一覧が身代わりに潰れ、潰し切ったあとは**はみ出した断りの末尾が切られて読めない**。実際に伸びるのは長い `error` 文字列で、同じ `error` が状況バーと `.pos-search__notice` に二重に出る
- 断り自体が潰れないこと（＝「SCSS を足さずに置いた」判断そのもの）は成り立っている。増えたのは「縮まない3つ目の子」で一覧が潰れ始める境が下がったこと
- 直し方: 断りを載せる器（`div.pos-search__notices`）を `PositionSearchModal.tsx` 側に置き、そこだけ `flex: 0 1 auto; min-height: 0; overflow-y: auto;` にする。あわせて `error` の出し先を1つに決める

- 結果: 見送り＋issue（**#444** に同梱。断り自体は潰れず、いま出している文言は固定の2行）

### [MEDIUM] M-4 断りが出て一覧の器が縮んでも、選択行を追い直さない

- reviewer: react
- 場所: `src/features/position-search/lib/virtual/VirtualList.tsx:22-29`
- 根拠: 再スクロールの effect は `[followIndex, followAlign, followBehavior]` にしか依存しない。`InlineNotice` は一覧の上に差し込まれ、`VirtualList` は `height: 100%` なので器が縮むが、`activeIndex` は変わらないので追い直しが走らない
- なぜ問題か: 選択行が下端付近にあると、**断りだけが見えていて、それが指している行は視界の外**になる。行が仮想化で外れると焦点も listbox へ退避する
- 直し方: `VirtualListBaseProps` に再追従の合図（`followNonce?: unknown`）を足して effect の依存に入れ、モーダルから `isUnopenable` を渡す

- 結果: 対応済み（`ef0f5923` `followNonce` を足し、断りの出入りで追い直す）

### [MEDIUM] M-5 `accept` が毎レンダ新しいので、`rowProps` の `useMemo` と `PositionHitItem` の `memo` が両方無効

- reviewer: react
- 場所: `PositionSearchModal.tsx:178-188`、`PositionSearchHitList.tsx:57-69`、`PositionHitItem.tsx:101`
- 根拠: `rowProps` の他の依存（`resolveAbsPath` / `setActiveIndex` / `rootDir`）は同一性が保たれているのに、`accept` だけが毎レンダ別の関数になる
- なぜ問題か: 同一性を保つ意図で書かれた `useMemo` と `memo` が、この1本の依存で無意味になっている。この PR で `accept` は `setUnopenableKey` を持ったので、`unopenableKey` の変化が全行の再レンダに伝わる経路になった
- 直し方: `accept` を `useCallback`（依存は `resolveHitAbsPath` / `navigateToHit` / `closeModal`）で包む

- 結果: 対応済み（`153c92fd` `useCallback` で包んだ。`startNavigationToHit` 自身が選択で変わるので安定は部分的——次のラウンドの焦点6に残す）

### [MEDIUM] M-6 モーダルテストのモックが `requestId` を無視しているので、検索が成立していない状態でも一覧が出る

- reviewer: react
- 場所: `PositionSearchModal.test.tsx:41-51`。本物は `entities/search/model/provider.tsx:200-234`（`requestId == null` なら `null` / `EMPTY_HITS`）
- なぜ問題か: モックは最初のレンダから「完了済み・2件」を返すので、`searchPosition` が投げても `setRequestId` が落ちても緑のまま。断りが**実際にヒットが届く経路の上で**出ることを固定していない
- 直し方: `getHitsByRequestId` を `(rid) => (rid == null ? [] : HITS)` にし、`searchPosition` / `cancelSearch` はモジュール先頭で1つ作って使い回す。Enter は検索解決後に撃つ

- 結果: 対応済み（`07b80f22` モックが `requestId` を見るようにし、要求が立つ前は Enter が何もしないことを1本足した）

### [MEDIUM] M-7 段の出典が同じ文書の中で2箇所になり、F-19〜F-31 の扱いが読めない

- reviewer: architecture / comment / oss-hygiene
- 場所: `docs/state-transitions/failure-surfacing.md:91`（「段そのものは ADR-0004 が決める」）と `:157-159`（この PR が足した但し書き）
- なぜ問題か: §2 の先頭を読んだ人は ADR-0004 へ飛び、F-32 が無いのを見て「未割り当て」と読む。例外の告知は11行下にしか無い。さらに「それより後に足した行（F-32）」という書き方は F-32 を唯一の棚卸し後の行のように見せるが、**F-19〜F-31 も棚卸し後**で、しかもそれらの「いま起きること」には段が1つも書かれていない
- 直し方: 例外を `:91` の凡例側に移し（「ただし 2026-08-29 の棚卸し以降に足した行は、段をこの表の『いま起きること』に持つ」）、`:157-159` はその参照に縮める。F-19 以降のうち段が書けているのは F-32 だけである旨を明記する

- 結果: 対応済み（`e42f8281` 例外を §2 の凡例へ移し、F-19 以降は段が書かれていないことを明示した）

### [MEDIUM] M-8 Rust の早期 `return` の説明を4箇所に写し、しかも原因を1つに絞りすぎている

- reviewer: architecture / oss-hygiene / robustness
- 場所: `docs/spec/screens/position-search.md:88-89`、`failure-surfacing.md:127`、`usePositionHitNavigation.ts:20-23`、`usePositionHitNavigation.test.tsx` の冒頭。出所は `docs/state-transitions/search.md:78-93`
- 根拠: 書いた内容（`run_rescan_diff_apply` は `scan_kifu_files` の失敗で墓標ループの手前に戻る）は**現物どおり**（`project_manager.rs` の `return` が `with_tombstone` のループより手前）。ただし
  - `root_dir` が `None` の腕（`search.md` が書いている）を4箇所とも落としている
  - 同じ状態を作る経路が他にもある——**watcher の静穏 800ms のデバウンス窓**（ツリーは即時、索引は最短でも 800ms 遅れる。いちばん普通に起きる形）と、**watcher の起動失敗**（`commands.rs` は warn だけで成功扱い。そのセッション中は索引が一度も更新されない）
  - ratchet が読むのは `search.md` だけ（`src-tauri/tests/search_doc_names.rs`）なので、新しい4つの写しは Rust 側を改名しても赤くならない（**r2 の H-8 で訂正**: `docsIdentifiers.test.ts` が `docs/state-transitions/**` を読み、corpus に `src-tauri/src` も含むので、台帳と遷移表の綴りは守られている。無防備なのは `docs/spec/screens/**` だけ）
- 直し方: 機構の説明は `search.md` に1つだけ置き、他は結論＋参照に縮める。根拠は「索引の更新は watcher とデバウンス越しなので窓が常にある。加えて走査の失敗と watcher の起動失敗では削除が一切取り込まれない」に書き換える

- 結果: 対応済み（`58f0b2f3` 4箇所の写しを `search.md` への参照に縮め、原因を「デバウンスの窓／走査の失敗／watcher の起動失敗」に直した。走査範囲を広げるラチェットは **#445**）

### [MEDIUM] M-9 `unopenableKey` のコメントが挙げた失敗が、どの行でも起こらない

- reviewer: comment
- 場所: `PositionSearchModal.tsx:46-48`
- 根拠: コメントは「添字で覚えると届いていない棋譜の**名前で断りが出る**」と書くが、`InlineNotice` は固定文言で棋譜の名前を一切出さない
- なぜ問題か: 理由と行の対応が取れていないコメント。実際に起きるのは「並び替えで別のヒットが選択位置に来たとき、断りが別の行に付いたまま残る」で、それを見ているのは `:221`
- 直し方: 結末を実際の行に合わせる。`hitKey` で覚える理由は `:158-176` の選択追従と同じ理屈なので、そちらを指すだけでも足りる

- 結果: 対応済み（`1a9132d8`）

### [MEDIUM] M-10 「移動を始められたか」と「開けるか」の差が、名前と文言で潰れている

- reviewer: comment
- 場所: `usePositionHitNavigation.ts:20-23`、`PositionSearchModal.tsx:221` `:252`、`docs/spec/screens/position-search.md:97`
- 根拠: doc コメントは正しく「始められたか」と書くのに、`isUnopenable` / 「この棋譜を開けません」/ spec の「ヒットの棋譜を開けない」は「開けるか」を主張している。ツリーに在って読めない棋譜（F-31）は `true` が返って閉じる（H-4）
- 直し方: 戻り値の意味を名前に載せる（`didStart` / `navigationRefusedKey` など）。spec の失敗名を「ヒットの棋譜がツリーに無い」に限定し、F-31 の経路は別だと1行足す

- 結果: 対応済み（`a135ad74` `startNavigationToHit` / `refusedHit` へ改名し、呼び手も `started` で受ける）

### [MEDIUM] M-11 テストの見出しが、そのテストで確かめていない主張を括弧で断定している

- reviewer: comment
- 場所: `usePositionHitNavigation.test.tsx:60-68`（「ツリーを切り替えられたら true（局面はファイルが読めてから当たる）」）
- 根拠: 括弧の主張（この時点では当てない）を見ている `expect` が無い。同じファイルの1本目は `expect(applyCursor).not.toHaveBeenCalled()` を置いているので粒度も揃っていない
- 直し方: `expect(applyCursor).not.toHaveBeenCalled()` を足すか、括弧を落とす

- 結果: 対応済み（`4e675fcb`）

### [MEDIUM] M-12 画面仕様が `F-32` を裸で書いていて、台帳へのリンクがこのファイルに1つも無い

- reviewer: oss-hygiene
- 場所: `docs/spec/screens/position-search.md:97`。他の画面仕様（`analysis-pane.md:92`、`app-layout.md:132`、`boot.md:88`）は F 番号を出すとき必ず台帳を張っている
- 直し方: 表の直後に `→ [failure-surfacing.md](../../state-transitions/failure-surfacing.md) F-32` を1行足す

## 重複・矛盾した所見

- **H-1** は react（読み込み中に検索を開く筋）と robustness（F-31 の棋譜を2回開く筋）が別々の入口から同じ欠けた条件（`loadedAbsPath` の門）に到達した。統合済み
- **H-3** は architecture と robustness が同じ `pendingRef` の取り残しを、別の再現筋（後日その棋譜を開く／別ファイルが載る）で挙げた。統合済み
- **M-1** は4人が挙げた。文言の割り方の案が2通り出ている——(a) `navigateToHit` の戻りを判別可能な型にする、(b) `resolveHitAbsPath` ごとフックに引き取らせて `navigateToHit(hit)` にする。どちらでも層は動かない
- **M-2 と M-3 は互いに反対方向の提案を含む。** M-2 は「`pos-search__notice` も `InlineNotice` に寄せて器を1つにする」、M-3 は「断り専用の器を作って `overflow-y: auto` を持たせる」。両方やるなら順序は M-2 → M-3。**片方だけやると `.pos-search__notice` の `margin` と親の `gap` の食い違いが残る**
- **H-4 / H-5 / M-1 は「どこまでを同じ PR で塞ぐか」の判断が共通。** 3件とも「コードで塞ぐ」と「doc を現物に合わせて issue へ送る」の両論が出ている。計画側で1つの方針として決めること（バラバラに決めると、doc が塞いだと書いた枝と塞いでいない枝が混ざる）

## 見ていない範囲

- 実描画は誰も確認していない。ui の高さの見積もりは `global.scss`（1rem = 10px）と `Modal.scss` の `height: min(760px, 100%)` からの机上計算で、潰れ始める窓の高さは出していない
- `PositionSearchContinuation` / `PositionSearchDestinationCard` / `PositionSearchStatusBar` の中身（断りが出ている間に何を出すか）
- `react-window` 本体の挙動（器の高さが変わったときの内部処理、`scrollToRow` の align の効き方）
- `entities/file-tree` の `openKifuNode` の `restoreSelection` の詳細
- Rust 側は `project_manager.rs` の `run_rescan_diff_apply` 前半・`fs_scan.rs`・`commands.rs` の 100 行前後・`query_service.rs:151` のみ。索引の永続化（`cache/format.rs`）と watcher の実測頻度は見ていない
- `src/__tests__/contrast.ts` の走査が `.notice--danger` の対をどう数えているかは未読（比はトークンの値からの手計算）
- 検索モーダル以外の断り（設定タブ・保存モーダル・`FsErrorView`）はトークンの grep だけで、レイアウトは見ていない
- reviewer は誰も `npm run verify` / `verify:rust` を通していない（走らせたのは `vp test run src/features/position-search` のみ）。**この差分自体は `3e74ed04` 時点で verify / verify:rust を通してある**
- `docs/state-transitions/search.md` の F-17 まわりとの整合、ADR-0004 の決定本文（読んだのは割り当て表と決定4まわり）

## lint / hook で強制できるもの

- **`docs/spec/screens/**` を識別子の走査対象に足す。**（**r2 の H-8 で訂正**: 無防備なのはここだけ。`docs/state-transitions/\*\*`は`docsIdentifiers.test.ts` が綴りを見ている。→ #445 の本文も訂正済み）
- **`docs/spec/screens/*.md` の `F-\d+` が台帳 §2 に実在するか＋そのファイルが台帳へのリンクを持つか**（M-12 を機械で止められる）。`docsIdentifiers.test.ts` と同じ形
- **同じ面トークンの上に載る前景トークンが1つか。** `src/__tests__/contrast.ts` の `scanContrast` は既に面と文字の対を解いているので、`$surface-danger` などについて2種類以上の前景が現れたら落とすラチェットを足せる（M-2 の後半）
- **`navigateToHit` の戻り値を式文として捨てる呼び出しの禁止。** `src/__tests__/asyncResultUse.test.ts` に同型の走査がある。戻り値を判別可能な型にすれば既存のラチェットに乗る
- **`applyCursor` を呼ぶファイルに `reachedCursor` の import を要求する走査**（`playerAccess.test.ts` が `getTesuuPointer` の直呼びを落としている先例あり。例外は `// cursor-reach-ignored: 理由`）。H-5 の再発を止められる
- 機械では止まらないもの: H-2（effect の順序）、H-6（存在しない復帰導線）、H-7（遷移表と実装のずれ）、M-7（段の出典）。H-2 は並び替えを1回起こして選択が動かないことを見るテストで、H-1 は `loadedAbsPath` の門のテストで守れる

## 修正計画（r1 → r2）

**前提の更新:** 計画を書く時点で `origin/main` が `2273b3a0`（#440。解析の再開タイマーの取りこぼし）へ進んでいたので、
**ブランチをその上へ rebase した。** 所見が指す3コミットは `9b69cbdd` / `d0434894` / `890b3aa3` に付け替わっている
（報告書の見出しに書いた `3e74ed04` は rebase 前の綴り）。行番号は動いていない。

**H-5 の行き先が調査で変わった。** `reachedCursor` の doc が指す #296 は **CLOSED（COMPLETED、2026-09-02）**
だが、`grep` すると本番の呼び手はいまも0件で、`buildPlayer.ts:37` は「最初の客は #296」と書いたまま。
つまり **#296 は道具だけ入れて閉じられ、症状（索引が古いと別の局面へ黙って移動する）は生きている。**
閉じた issue へは送れないので、新しい issue を立てる。

- 結果: 対応済み（`132d68e3`）

### 束（同じ根から出ている所見）

- **移動の一回性と着地**: H-1 → H-3 → H-4 → H-5。H-1（速い経路の門）を直すと H-3 の踏み方が1つ減るが `pendingRef` の取り残しは残る（**別物になる**ので H-1 の後に書き直して取る）。H-4 と H-5 は「塞ぐ／塞がないを doc に書く」側なので、コード2件が入り切ってから取る
- **断りの理由**: M-1 → M-10 → M-9。M-1（理由を型で持つ）を直すと `unopenableKey` という名前も断りの本文も差し替わるので、M-10 と M-9 の指摘箇所は**別物になる**
- **断りの寿命と器**: H-2 → M-4。H-2（選択追従）を直しても M-4（器が縮んだときの追い直し）は残る
- **doc の現在地**: H-6 / H-4 / H-5 / H-7 / M-8 / M-7 / M-12。H-4 と H-5 は「何を塞いだか」の結論に依存するので、コード側の方針（下の「疑ったか」）が決まってから書く
- **テストの土台**: M-6 → H-1 のテスト → M-11。M-6（モックが `requestId` を無視）を先に直さないと、以降の修正が「テストで守られている」ように見えて実は守られていない

### このラウンドで直すもの

| 順  | 所見                                                             | なぜこの順か                                                                                                    | この直し方で壊しうるもの                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | M-6 モックを本物の契約に合わせる                                 | テストの土台。以降の修正が本当に守られているかがここで決まる（手順3 の1に最も近い位置）                         | 最初のレンダでヒットが0件になるので、`accept` を撃つ前に検索の解決を待つ必要が出る。**待ちを入れ損ねると「ヒットが無いので Enter が何もしない」で緑になる偽陽性**になり、以降の所見が全部守られていない状態で通る                                                                                                                                                                   |
| 2   | H-1 速い経路に `loadedAbsPath` の門を足す                        | 束の先頭。ここを直すと H-3 の踏み方が変わる。失敗経路の門の向きを変えるので早い段に置く（手順3 の3）            | いま即座に当たっていた「同じ棋譜のヒットを続けて開く」が、遅い経路へ落ちてレンダ1回分遅れる。`selectNodeByAbsPath` は `isAlreadyActive` のとき `openKifuNode` を呼ばないので、**`loadedAbsPath` が別値のまま `player` だけ在る状態では、盤が動かず断りも出ない新しい経路になりうる**（effect の門は `loadedAbsPath === absPath` を要求するため）。フックテスト3本目の期待値が変わる |
| 3   | H-3 `pendingRef` に世代を持たせ、別ファイルが載ったら落とす      | H-1 の後。H-1 で消えた踏み方を除いた残りを、書き直してから取る                                                  | いま「読み込みに時間がかかっても最終的に当たる」経路で、途中に別のファイルが載ると当たらなくなる（意図どおりだが、遅いディスクで移動が黙って流れる形が新しく出る）。同じファイルへ2回続けて `navigateToHit` すると古い世代が捨てられる                                                                                                                                              |
| 4   | M-1 断りの理由を値で持ち、文言を2つに割る                        | 束の先頭。M-10 / M-9 の指摘箇所がここで別物になる                                                               | `navigateToHit` の戻りが `boolean` でなくなるので、テストの `toBe(false)` が全部書き換わる。**`if (navigateToHit(...))` と書ける形が消える**ので、将来の呼び手は理由を必ず受け取る（狙いどおりだが、呼び手が増えるまで冗長）                                                                                                                                                        |
| 5   | M-10 名前を「移動を始められたか」に寄せる                        | M-1 で型が変わった直後。先にやると同じ行を2回触る                                                               | 名前だけ。`unopenableKey` を読んでいるのは同一ファイル内の2箇所のみ（grep 済み）                                                                                                                                                                                                                                                                                                    |
| 6   | M-9 コメントの結末を実際の行に合わせる                           | M-1 / M-10 で本文と名前が確定してから                                                                           | 無し（コメントのみ）。ただし M-1 の結論と食い違うと、次のラウンドで同じ所見が出る                                                                                                                                                                                                                                                                                                   |
| 7   | H-2 選択追従の `activeKeyRef` を操作時だけ書く                   | `main` から在る壊れだが、**この PR の断りの寿命がこの上に乗っている**（断りが黙って消える）。M-4 の前提でもある | チャンク到着で選択が動かなくなるので、いま偶然「開いている棋譜のヒットが先頭に来て選択が先頭に付く」見え方に依存している操作感が変わる。`activeIndex` の範囲外クランプ effect（`:164-169`）と競合しうる                                                                                                                                                                             |
| 8   | M-4 断りで器が縮んだときに選択行を追い直す                       | H-2 の後。追従の合図を足す先が H-2 で確定する                                                                   | 断りの出入りのたびに `scrollToRow` が走るので、**利用者が手でスクロールして選択行から離れている状態でも引き戻される**                                                                                                                                                                                                                                                               |
| 9   | M-5 `accept` を `useCallback` で包む                             | 上の修正で `accept` の中身が確定してから                                                                        | `navigateToHit` は `selectedNode` に依存して頻繁に変わるので、`rowProps` の安定は完全には得られない（**M-5 の狙いは部分的にしか達成されない**）。次のラウンドで「まだ毎レンダ変わる」と出る可能性がある                                                                                                                                                                             |
| 10  | M-11 テスト見出しの括弧を実際の `expect` にする                  | テストの整合。コードが固まってから                                                                              | 無し                                                                                                                                                                                                                                                                                                                                                                                |
| 11  | H-6 台帳の復帰導線を実態に直す                                   | **私の書き間違い。** doc の中で最も害が大きい（「復帰は用意済み」と読ませる）                                   | 「導線が無い」と書くことで、`danger` の段に動作が1つも無い理由が読めるようになる。**索引を作り直す口を後で作ったら、この行と ADR-0004 の F-17 の両方が古くなる**                                                                                                                                                                                                                    |
| 12  | H-4 塞いだ枝を「ツリーに無い場合だけ」に限定する                 | H-6 と同じ台帳の行を触るので連続させる。コード側の方針が11の時点で確定している                                  | 塞いでいない枝（F-31 / ディレクトリ）を明記するので、**後で誰かが塞いだときに doc が古くなる**。#434 の番号を添えて追えるようにする                                                                                                                                                                                                                                                 |
| 13  | H-5 着地を見ていないことを doc に書き、新しい issue を立てる     | 12 と同じ行。#296 が閉じている事実を添える必要がある                                                            | issue を立てずに doc だけ書くと、行き先の無い注意書きが残る。**issue 番号を書いてから doc を書く**（順序が逆だと番号なしの TODO になる）                                                                                                                                                                                                                                            |
| 14  | H-7 `position-search-view.md` の `enter` / `dblclick` セルを割る | 台帳が固まってから。表は台帳を参照する側                                                                        | セルを割ると `state_transition_cells.rs` の走査対象外なので機械では守られない。**表とテストの名乗りがずれても赤くならない**ことを承知で書く                                                                                                                                                                                                                                         |
| 15  | M-8 Rust の機構の写しを `search.md` への参照に縮める             | 14 までで doc の結論が固まってから。4箇所を1箇所へ寄せる                                                        | `search.md` を読まないと理由が分からなくなる。**参照先の節名が変わると4箇所が同時に迷子になる**ので、節名でなくファイルと見出しで指す                                                                                                                                                                                                                                               |
| 16  | M-7 段の出典を §2 の凡例へ移す                                   | 15 と同じファイル。最後にまとめる                                                                               | 凡例を書き換えると F-19〜F-31（段が書かれていない行）の扱いが明文化されるので、**「段が無い行がある」ことが表に出る**。それは事実なので隠さない                                                                                                                                                                                                                                     |
| 17  | M-12 画面仕様に台帳へのリンクを足す                              | 単独。他に依存しない                                                                                            | 無し                                                                                                                                                                                                                                                                                                                                                                                |

### 直さないもの

| 所見                                                                                         | 行き先                            | 理由                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-2 手書きの断りと `InlineNotice` の同居                                                     | **issue**（M-3 と1本にまとめる）  | `PositionSearchHitList` の既存の2つの断り（`pos-search__notice` / `pos-search__empty--error`）を寄せる作業で、この PR の範囲の外（`/implement` 手順7）。寄せると SCSS 2ブロックの削除と `role` の変更を伴い、#420 の差分が読めなくなる |
| M-3 左ペインに縦スクロールが無い                                                             | **issue**（M-2 と同じ）           | 同じ器の話。断り自体が潰れないことは ui reviewer も認めており、**いま出している文言は固定の2行**なので溢れない。溢れるのは長い `error` を出す既存の2箇所                                                                               |
| H-5 のコード側（`reachedCursor` を通す）                                                     | **新しい issue**                  | `applyCursor` の署名（`entities/game`）を変える話で、#288（エピック）の範囲。**#296 が COMPLETED で閉じているのに症状が残っている**ことを新しい issue に書く。この PR では doc に現在地を書く（順13）                                  |
| H-4 のコード側（`selectNodeByAbsPath` を `AsyncResult` に）                                  | **#434 と #288 へ**               | `entities/file-tree` の公開 API を変える。F-31（#434）が既に同じ経路を扱っており、そちらの直し方の選択（見出しの出どころを game に寄せるか）と衝突する                                                                                 |
| lint / hook（`navigateToHit` の戻り値を捨てる禁止、`applyCursor` に `reachedCursor` を要求） | **見送り**                        | `CLAUDE.md`「同じ失敗を2回するまでルールを足さない。1回目はルールではなくテスト」。呼び手はまだ1つで、失敗は1回目。**テスト（順2・順4）で守る**                                                                                        |
| lint / hook（`search_doc_names.rs` の走査対象を広げる）                                      | **issue**                         | `docs/spec/screens/**` を丸ごと対象にすると、既存の doc が名乗る識別子で一斉に赤くなる可能性が高い。**この PR の中で測らずに広げない**                                                                                                 |
| lint / hook（面ごとの前景トークンを1つに強制）                                               | **issue**（M-2 と同じ本文に書く） | `contrast.ts` の走査器に足す作業で、`$surface-danger` 以外の3面も同時に測ることになる                                                                                                                                                  |

### 対象そのものを疑ったか

**HIGH 7件のうち4件（H-1 / H-3 / H-4 / H-5）が同じ機構に集まっている**——`usePositionHitNavigation` の
「`pendingRef` に要求を置き、effect が条件を見て後から当てる」形。MEDIUM でも M-4 がここに触れる。

この機構は **#288（エピック: 局面検索・局面ナビの非同期と effect）が既に名指ししている**。
落とす案は「移動を1回きりのコマンドにして、着いたかを `reachedCursor` で返す」——
`applyCursor` の署名と `entities/game` の責務に触るので、#420 の要求（開けないヒットで閉じない）を超える。

**今回は落とさない。** ただし4件を個別に直すと、次のラウンドでまた同じ機構に所見が出る見込みが高いので、
順13 で立てる issue に「この機構ごと落とす案」を1行入れ、#288 から参照させる。

断りの表示にも3件（M-2 / M-3 / M-4）が集まっている。根は「左ペインに断りを載せる器が無い」こと。
器は issue（M-2 / M-3）で作り、今回は M-4 だけを取る。

### 次ラウンドの焦点

次の `/review-round` は、この一覧を reviewer へ渡す。

1. **`loadedAbsPath` の門を足したことで、盤が動かず断りも出ない経路が新しくできていないか**（順2）。とくに `isAlreadyActive` で `openKifuNode` が呼ばれない組み合わせ
2. **`pendingRef` の世代を足したことで、遅いディスクで移動が黙って流れる形**（順3）
3. **`navigateToHit` の戻りを判別可能な型にしたことで、呼び手が理由を取り違えていないか**。文言2つが枝と正しく対応しているか（順4）
4. **選択追従を操作時だけにしたことで、チャンク到着後に選択が範囲外へ残る形**（順7。`:164-169` のクランプ effect との競合）
5. **`scrollToRow` の再発火が、利用者の手スクロールを引き戻していないか**（順8）
6. **`accept` を `useCallback` にしても `rowProps` が毎レンダ変わるままでないか**（順9）
7. **doc が「塞いだ」と書いた枝と「塞いでいない」と書いた枝が、コードと1対1に対応しているか**（順11〜17）。とくに F-32 の行・spec の失敗表・`position-search-view.md` の3枚が互いに矛盾していないか
8. **テストのモックを本物の契約に寄せたことで、逆に検索が成立しないまま緑になっていないか**（順1）

### 検証の見積り

`.claude/hooks/verify-gate.sh` の判定は「TS を触ったら `verify`」「`docs/state-transitions/` は両方」。

- 順1〜10（TS のみ）: 10件 × `npm run verify`（実測 約40秒）≒ **7分**
- 順11〜16（`docs/state-transitions/` を含む）: 6件 × `verify` + `verify:rust`（約2分15秒）≒ **18分**
- 順17（`docs/spec/` のみ）: 1件 × `verify` ≒ **1分**

合計 **約26分**。`/review-plan` 手順7 の目安（Rust が走る側で20分）を少し超えるが、
**doc の6件は互いに矛盾を作らないために同じラウンドで入れる必要がある**（片方だけ直すと、
台帳と表が別のことを言う状態が1ラウンド残る）。次ラウンドへ送るのはコード側ではなく、
上の「直さないもの」に挙げた issue 3本。
