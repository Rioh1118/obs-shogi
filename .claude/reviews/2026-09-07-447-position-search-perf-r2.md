# レビュー 447-position-search-perf ラウンド2

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（基点 `8d53ea45` / 対象 `d817ef97`）
- 走らせた reviewer: react / robustness / comment / architecture / perf
- 前ラウンド: `2026-09-07-447-position-search-perf-r1.md`。その「次ラウンドの焦点」7点を全 reviewer へ渡した

**焦点への答え**（計画が「壊しうる」と書いたもの）:

| 焦点                                            | 結果                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1 H-1 で余分に捨てられていないか                | **踏めない**（react が経路を探して見つけられず）。ただし別経路で余分な `buildPlayer` は起きている → R2-6 |
| 2 死んだ rid の判定が生きている検索を巻き込むか | **巻き込む形が2つ見つかった** → R2-1 / R2-4                                                              |
| 3 閉じる瞬間に「完了・0件」が出るか             | **出ない**（同じ effect 本体で自動バッチに畳まれる。react が確認）                                       |
| 4 `evict` が無限ループするか                    | **しない**（`for...of` で `while` が無く、全部未解決なら `bytes` が 0 で即 return）                      |
| 5 byte 予算で実効本数が落ちたか                 | **落ちていない**。`24,000,000 / 12 = 2,000,000` で旧 `MAX_CACHED_CHARS` と同値。実測 120手 517本         |
| 6 共有述語が片方の条件を飲み込んだか            | **飲み込んでいない**（`currentAbs` の一致は述語の外で `&&`）                                             |
| 7 `prefetchAbsPath` の effect が張り直るか      | **張り直らない**（deps は文字列2つで値比較）                                                             |

## 所見

### [HIGH] R2-1 `search_end` / `search_error` が門を素通りし、`clear_search` で消したセッションを作り直す

- 結果: 対応済み（`f0453e0f` 終わり・失敗は在るセッションにしか効かせない。始まりは `isAccepting` を通す）

- reviewer: react / robustness（**両者が実測で再現**）
- 場所: `provider.tsx` の `onSearchEnd` / `onSearchError`、`reducer.ts` の `search_end` / `search_error`（`ensureSession`）、`src-tauri/src/search/query_service.rs:127`・`:179`
- 根拠: 門（`chunkBuffer`）を通るのは `search_chunk` だけ。Rust は取り下げられた検索でも `break` の後で必ず `EVT_SEARCH_END` を emit する。実測: `clearSearch(7)` 直後の `Object.keys(state.sessions)` は `[]`、続けて `onSearchEnd({requestId:7})` を撃つと `["7"]` に戻る
- なぜ問題か: **r1 の D-1（`clearSearch` に呼び手を与えた）と D-2（門を作った）の組み合わせが、この穴を毎回踏む経路にした。** 閉じる／撃ち直すたびに空のセッションが1つ積まれ、消す口はもう無い（画面は rid を忘れている）。`sessions` が増え続け、次の検索の吐き出しごとに `{...sessions}` がその全件を毎回コピーする。**D-1 が閉じたはずの穴が別の口から開いている**
- 直し方: `search_end` / `search_error` は在るセッションにしか効かないようにする（`clear_search` と同じ `if (!state.sessions[rid]) return state;`）。`search_begin` は作る側が正しいので、`ChunkBufferApi` に「受け取る rid か」を答える口を足して入口で弾く

### [HIGH] R2-2 続きの5手が、要求した局面に着けなくても印無しで別の線を読む

- 結果: doc と仕様に反映（`c1f4fb3c`）。実装は #443 と同じ判断が要るのでそちらへ

- reviewer: robustness
- 場所: `lib/readContinuation.ts`、`entities/kifu/lib/buildPlayer.ts` の doc、`playerCursor.ts` の `reachedCursor`
- 根拠: `buildPlayer` の doc が「**要求した局面に着くとは限らない**。`goto` は `forkAndForward` の返り値を見ないので、実在しない変化は黙って捨てられ、要求した `tesuu` ちょうどで別の線に着く」と書いている。`readContinuation` は `reachedCursor` を通していない
- なぜ問題か: 索引を作った後に棋譜が編集された／索引の blob が壊れて `root()` にすり替わった、のどちらでも、**正しい顔をした別の答え**が出る。「読めなかった」（#421）と違って気づく手掛かりが1つも無い
- **範囲の判断**: `main` から在る。実装の直しには第3の表示状態の決定が要り、#443（`reachedCursor` の本番の呼び手が0件）と同じ判断。**この PR では doc と仕様の欠けとして書く**

### [HIGH] R2-3 invoke が解決する前に閉じると、取り下げも破棄も1つも飛ばない

- 結果: 対応済み（`bcb8b862` 起動の世代を取り、解決した側が自分の番かを確かめる）

- reviewer: react / robustness / perf（**3人。robustness と perf が実測**）
- 場所: `PositionSearchModal.tsx` の `discardSearch`（`rid == null` で素通り）と `searchPosition(...).then`（世代を確かめずに `inFlightRidRef` と `setRequestId` を書く）
- 根拠: 実測で `cancelSearch calls: []` / `clearSearch calls: []` / 閉じたモーダルが `getHitsByRequestId(42)` を引き続ける。保持量は n=100,000 で **19.4MB**
- なぜ問題か: 開いた直後に Esc（窓は invoke の往復ぶん）で、Rust の検索は取り下げられず最後まで走り、届いたヒットは門を素通りする（rid は `dead` にも `deadBefore` にも入らない）。`getHitsByRequestId` は `if (!isOpen) return null` より**上**にあるので、**閉じているモーダルが吐き出しのたびに平坦化と並べ替えを回し続ける**。#447 が減らそうとしている仕事が、画面が閉じている間に走る。
  第2の顔: `.then` が世代を見ないので、`queryKey` が A→B と続けて変わり A が後に解決すると `setRequestId(A)` が勝ち、**問い合わせ B の画面に A の結果が出る**
- 直し方: 起動ごとに世代を取り、`.then` で「まだ自分の番か」を確かめる。違えば即 `cancelSearch` + `clearSearch`

### [BLOCK] R2-4 テストの doc が「選択は鍵で追う」と言っている（同じファイルの15行下が正反対を書く）

- 結果: 対応済み（`61c10c29` R2-17 と同じ修正で書き換わった）

- reviewer: comment
- 場所: `ui/__tests__/PositionSearchModal.test.tsx` の「チャンクが届いて並び替わっても、断りは押した行に付いたまま」の doc
- 根拠: 実装は `orderedHits.indexOf(hit)`。同じファイルの下のテストは「参照で追えば追従そのものは鍵を組まない」と書き、`docs/state-transitions/position-search-view.md` も直っている。**`7d48f456` の置き去り**
- 直し方: 「断りは鍵で覚える。選択そのものは参照で追う」に差し替える

### [MEDIUM] R2-5 門の線が「イベントで見た rid」からしか引かれない

- 結果: 対応済み（`53657045` invoke が返した rid も線に数える）

- reviewer: robustness（**実測**）
- 場所: `provider.tsx` の `noteRequest`（`onSearchBegin` と `enqueue` からしか呼ばれない）、`stopAccepting()` の `dead.clear()`、`searchPosition`
- 根拠: `clearSearch(rid)` の rid は invoke の戻り値なので `maxSeenRid` を追い越しうる。追い越したぶんは `dead.clear()` で忘れられる。実測で「rid 8 の begin だけ見た状態で `clearSearch(9)` → `open_start` → rid 9 のチャンク」が通り、**古い根のパスが新しい根の state に混ざる**
- なぜ問題か: コメントの「線より手前は `deadBefore` が受け持つ」が成り立っていない。いまは `WorkspaceTab` が `window.location.reload()` するので潜在だが、**それを外した瞬間に静かに破れる**
- 直し方: `searchPosition` の直後に `chunkBuffer.noteRequest(out.requestId)` を1行

### [MEDIUM] R2-6 選択の真実の源が2つあり、突き合わせが effect にあるので1フレーム別の行が選ばれる

- 結果: 対応済み（`3b7d0aef` 実体だけを state にし、添字を導出。追従 effect とクランプが消えた）

- reviewer: react
- 場所: `PositionSearchModal.tsx` の `activeHit = orderedHits[activeIndex]`（添字が源）と追従 effect（参照が源）
- 根拠: 開いている棋譜のヒットが新しいチャンクに乗ると `same` が伸び、`other` に居る選択行の添字が後ろへずれる。`orderedHits` は新しく `activeIndex` は古いレンダが**必ず1回**入る
- なぜ問題か: その1フレームの `activeHit` は利用者が選んでいない隣の行。反転行が飛び、`destAbsPath` と `prefetchAbsPath` が別の棋譜を指し、`PositionSearchContinuation` の `target` が変わって「取得中…」へ差し替わる（**`target` の `useMemo` が防ごうとしたもの**）。50ms ごとの吐き出しに乗るので最大 20回/秒。その1フレームで Enter を押すと選んでいない行へ移動する
- 直し方: 添字を state に持たず導出する（`activeHit` を state にして `activeIndex` を `indexOf` で計算し、追従 effect を消す）

### [MEDIUM] R2-7 `KifuCache.load` に契約が書かれていない

- 結果: 対応済み（`a667e6de` `load` に4つの約束を書いた）

- reviewer: comment
- 場所: `lib/kifuCache.ts` の `load`（無印）に対し、private の `evict` には10行
- 根拠: 呼び手が知らないと踏む約束が4つ——同じパスの飛行中は同じ `Promise`、失敗は `Error` で **reject する**、失敗は抱えないので次に呼べばまた IPC、**呼ぶと他の entry が追い出されうる**
- 直し方: `load` に TSDoc

### [MEDIUM] R2-8 溜め場の名前が振る舞いから1つずつずれている

- 結果: 対応済み（`4de0701a` `activate`/`deactivate`、`deadBefore` → `firstLiveRid`）

- reviewer: comment
- 場所: `provider.tsx` の `open` / `dispose` / `deadBefore`
- 根拠: `dispose` は「もう使えない」を意味するが `open()` で復活するので、注記が2箇所要っている。`deadBefore` は判定が `<= deadBefore` で**自身も弾く**ので、コメントが名前を訂正している
- なぜ問題か: `< deadBefore` に書き換えても型は通り、**`open_start` の直前に始まった検索が1本だけ生き残る**（r1 の D-2 と同じ壊れ方）
- 直し方: `activate` / `deactivate`、`deadBefore` → 判定が名前で読める形へ

### [MEDIUM] R2-9 仕様の「更に 300ms」が実装より 150ms 長く読める

- 結果: 対応済み（`3a453f76` 「更に」を落とした）

- reviewer: comment
- 場所: `docs/spec/screens/position-search.md`
- 根拠: 2つの effect は同じ commit でタイマを張るので、先読みが走るのは**選択が止まってから 300ms**。450ms ではない。テストの `PAST_PREFETCH_MS = 400` が仕様どおりなら書けない
- 直し方: 「更に」を落とす

### [MEDIUM] R2-10〜R2-16（r1 から継続。現物で未解消を確認済み）

| 番号  | 所見                                                                                                                                                      | 場所                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R2-10 | 死んだ `memo` を根拠にしたコメント（r1 M-5）**→ `e452337f`**                                                                                              | `PositionSearchModal.tsx` / `VirtualHitRow.tsx`                                            |
| R2-11 | 「既定の 300 件区切り」は既定ではない（r1 M-7）**→ `dbf570d6`**                                                                                           | `provider.tsx` / `chunkCoalescing.test.tsx` / `PositionSearchModal.tsx`                    |
| R2-12 | 実測値が出典なしで **8箇所**（r1 M-8）**→ `c50a1b70`**                                                                                                    | 各所                                                                                       |
| R2-13 | 「macOS の既定で 25〜30 回/秒」は最速設定（r1 M-9）**→ `ae0b21eb`**                                                                                       | `PositionSearchContinuation.tsx` と同テスト                                                |
| R2-14 | 公開面に「返り値は共有の配列」が無い（r1 M-10）**→ `a667e6de`**                                                                                           | `types.ts` / `useOrderedPositionHits.ts`                                                   |
| R2-15 | コメントが指す `search_chunk` は存在しない（r1 M-11）。**解消済み**（`61c10c29` がその段ごと書き換えた）                                                  | `PositionSearchModal.tsx`                                                                  |
| R2-16 | テストの名前と doc が実際より広い2件（r1 M-12）**→ `1222481d`**／ref 宣言が書く側より下（r1 M-13）は `3b7d0aef` で**解消済み**（`activeHitRef` が消えた） | `chunkCoalescing.test.tsx` / `useOrderedPositionHits.test.tsx` / `PositionSearchModal.tsx` |

### [MEDIUM] R2-17 同じ不変条件（選択は参照・断りは鍵）が8箇所に書かれ、1つが腐った

- 結果: 対応済み（`61c10c29` 正を状態遷移表に決め、コードは指す形に縮めた）

- reviewer: comment
- 根拠: 8箇所すべてが別の言い回しで同じことを説明し、実装が変わったとき7箇所が追随して**1箇所（R2-4）だけが取り残された**
- 直し方: 正を1つ（`docs/state-transitions/position-search-view.md`）に決め、コードのコメントはそこを指す形に縮める

### [MEDIUM] R2-18 `kifuCache` が entities 側の型の言い切りを `unknown` と `as` で捨てている

- 結果: 対応済み（`a667e6de` `toText` と `as JKFData` を落とした）

- reviewer: architecture
- 場所: `lib/kifuCache.ts` の `toText` と `as JKFData`
- 根拠: `readText` は `AsyncResult<string, FsError>` なので `Uint8Array` の枝も `String(content ?? "")` の枝も到達しない。`ParsedKifu.jkf` も既に `JKFData`
- なぜ問題か: 契約を跨ぐ場所で型の口を広げているので、**読み口の型が変わったときに tsc で落ちず**、`"[object Object]"` を作って無関係な文言の断りになる
- 直し方: `toText` を落として `res.data` を直に使い、`as JKFData` を外す

### [MEDIUM] R2-19 「索引が動いている」の判定が2つの feature に手書きで重複

- 結果: 対応済み（`141f21aa` `isIndexBusy` を entities に置き、2箇所から呼ぶ）

- reviewer: architecture
- 場所: `PositionSearchModal.tsx` の `indexStale`、`features/settings/ui/tabs/WorkspaceTab.tsx`
- 根拠: `IndexState` に段が1つ増えたとき、`WorkspaceTab` の手書き union は tsc が落とすが、3項の or **2箇所は落ちない**
- なぜ問題か: 新しい段が「動いている」側なら、局面検索は結果に「更新中」を付けず、**0件が「完了・最新」として出る**——provider 自身が警戒している失敗そのもの
- 直し方: `entities/search` に `isIndexBusy(s: IndexState)` を置いて出典にする

### [MEDIUM] R2-20 「そのセッションはもう無い」が3つの置き場に散り、順序でしか保証されていない

- 結果: 対応済み（`e0b11056` `dropSessions` を唯一の口にし、溜め場を `model/chunkBuffer.ts` へ。React 抜きの単体テスト8件つき）

- reviewer: architecture
- 場所: `provider.tsx` の `openProject` と `clearSearch` の呼び出し列、`reducer.ts` の `ensureSession`、`createChunkBuffer`
- 根拠: rid で引ける置き場が3つ（`state.sessions` / 溜め場の `pending`+`dead`+`deadBefore` / `hitsCacheRef`）。全部に伝える責任が2箇所の呼び出し順にしか無い。**この結合はこのブランチで増えている**（基点では置き場2つ・呼び出し1箇所）
- 直し方: 破棄の口を1つにする。`createChunkBuffer` を `model/chunkBuffer.ts` へ出し、React 抜きで線の判定を単体テストできるようにする

### [LOW] R2-21 自スライスの import が絶対パスで書かれている（5件）

- 結果: 対応済み（`bab0fdf0`）

- reviewer: architecture
- 根拠: `rg 'from "@/features/'` が feature 間の結合を洗う唯一の機械的手段だが、自スライスを絶対で書いた行が混ざると目で仕分けることになる。同じスライス内で相対と絶対が混在
- 直し方: 5件を相対に直す

## 見ていない範囲

- **実ブラウザ（WebView）での測定はしていない。** perf の数字はすべて node の V8 で、DOM のレイアウト・ペイント・ResizeObserver を含まないので**下限**
- `read_file` の Tauri IPC 往復の実費用
- Rust 側は `query_service.rs` の emit ループと `commands.rs` の cancel のみ。索引の構築・watcher・`cache/format.rs` の門番は未読。R2-2 の `root()` すり替えの到達性はそこに依存する
- SCSS・アクセシビリティ（ui-reviewer は走らせていない。この差分に SCSS もレイアウトも無い）
- `isAppendOnlyContinuation` の「末尾1つしか見ない」弱点を踏める経路は**探して見つけられなかった**。無いと言い切る確認はしていない

## lint / hook で強制できるもの

- **コメント中のバッククォート識別子が実在するかの走査。** R2-15（`search_chunk`）で**2ラウンド続けて同じ形**が出た。`CLAUDE.md`「同じ失敗を2回するまでルールを足さない」の条件を満たす。Rust 側には既に `comment_identifiers` があるので、TS 側は `src/__tests__/` に同じ形で置ける
- **「実測」を含むコメントに出典（`.claude/reviews/` か `docs/`）を要求する走査**。R2-12 の8件が落ち、出典付きの3件は通る
- **`lib/` 配下に `.tsx` を置かない**走査（`VirtualList.tsx`）
- **`ensureSession(` の出現数を2に固定する**走査（R2-1 の再発検知）。ただし形で寄せるのが先
- **行高台帳のテスト**: `getRowHeight` の呼び出し回数を数え、`activeIndex` を1動かしたときに件数に比例しないことを固定する

## 修正計画（r2 → r3）

### 束

- **セッションの生死**: R2-1 → R2-5 → R2-20。R2-1（門を素通りする口）を塞ぐと R2-5（線の引き方）の穴が表に出る。R2-20（置き場の集約）は最後
- **選択の源**: R2-6 → R2-4 → R2-17。源を1つにすると、説明の複製（R2-17）を縮める先が決まる
- **コメントの複製**: R2-17 が R2-4 / R2-10 / R2-13 の指摘箇所を**別物にする**ので、R2-17 を先に置く

### このラウンドで直すもの

| 順  | 所見                                                    | なぜこの順か                                      | この直し方で壊しうるもの                                                                                                                                                                                          |
| --- | ------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | R2-1 `search_end`/`search_error` がセッションを作り直す | **r1 の修正が作った穴**。門の向きを変えるので最初 | 「begin を見ていない検索の end」が記録されなくなる。`search_requested` はセッションを作るので、invoke → end の順で begin を落とした回だけ `isDone` が立たなくなる（画面は「検索中…」のまま）。R2-5 とセットで塞ぐ |
| 2   | R2-3 invoke 解決が閉じた後に来る                        | HIGH。3人一致。門の外の経路                       | 世代を進める場所を増やすので、**正常な起動まで捨てる**形が作れる。`queryKey` が同じまま再描画された回で世代が進まないことを確かめる                                                                               |
| 3   | R2-5 線を invoke の戻り値からも引く                     | R2-1 の後。1行                                    | `maxSeenRid` が先に進むので、`open_start` の線がこれまでより後ろに引かれる。開いた直後に根を変えると、その検索まで死ぬ（正しい）                                                                                  |
| 4   | R2-6 選択の源を1つにする                                | 選択の束の先頭                                    | `activeIndex` を導出にすると、**`indexOf` が `-1` を返す間の描画**が要る（新しい検索の最初のレンダ）。クランプの分岐と噛み合うか                                                                                  |
| 5   | R2-17 説明の複製を1箇所へ寄せる                         | R2-4 / R2-10 / R2-13 の指摘箇所を別物にする       | コメントが減るので、**次に読む人が `docs/` を開かないと理由に辿り着けない**。指し先を明示する                                                                                                                     |
| 6   | R2-4 テスト doc の「鍵で追う」                          | R2-17 の後                                        | 無し                                                                                                                                                                                                              |
| 7   | R2-18 `toText` / `as JKFData` を落とす                  | 型の口を狭める。他より先（落ちるなら早く）        | `readText` が `string` 以外を返すようになったら tsc で落ちる（それが狙い）                                                                                                                                        |
| 8   | R2-7 `KifuCache.load` の TSDoc                          |                                                   | 無し                                                                                                                                                                                                              |
| 9   | R2-14 公開面の TSDoc                                    |                                                   | 無し                                                                                                                                                                                                              |
| 10  | R2-8 溜め場の命名                                       |                                                   | 名前が変わるので、`chunkCoalescing.test.tsx` の doc も追随が要る                                                                                                                                                  |
| 11  | R2-19 `isIndexBusy` を entities へ                      |                                                   | `WorkspaceTab` も触る（範囲がわずかに広がるが、片側だけ直すと重複が残って意味が消える）                                                                                                                           |
| 12  | R2-11 「既定の 300」                                    |                                                   | 無し                                                                                                                                                                                                              |
| 13  | R2-13 macOS のキーリピート                              |                                                   | 無し                                                                                                                                                                                                              |
| 14  | R2-9 仕様の「更に 300ms」                               |                                                   | 無し                                                                                                                                                                                                              |
| 15  | R2-15 `search_chunk`                                    |                                                   | 無し                                                                                                                                                                                                              |
| 16  | R2-12 実測値の出典                                      |                                                   | 無し                                                                                                                                                                                                              |
| 17  | R2-16 テスト2件と ref 宣言位置                          |                                                   | 無し                                                                                                                                                                                                              |
| 18  | R2-10 死んだ memo のコメント                            |                                                   | 無し                                                                                                                                                                                                              |
| 19  | R2-21 自スライスの絶対 import                           |                                                   | 無し                                                                                                                                                                                                              |
| 20  | R2-2 続きが着けないことを doc と仕様へ                  | doc。最後                                         | 無し                                                                                                                                                                                                              |
| 21  | R2-20 `chunkBuffer.ts` の分離と破棄口の集約             | 構造。他が落ち着いてから                          | 置き場が動くので、`chunkCoalescing.test.tsx` の import が変わる。破棄の順序（門 → 置き場 → dispatch）を1箇所に閉じるので、順序を変える改変が1行では書けなくなる                                                   |

### 直さないもの

| 所見                                                                      | 行き先              | 理由                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| perf HIGH: 仮想リストの行高台帳が index 0 から作り直される                | **issue**           | `PositionSearchHitList.tsx` / `VirtualHitRow.tsx` は `main` から在り、この差分は触っていない。閾値は**選択行 20,000 以上**で、#447 が言う「数千件」の帯では 0.2〜3.9ms／打鍵。直すには「選択をどう行へ降ろすか」と「行の高さを実測に任せるか」の2つの設計判断が要る |
| R2-5 の親: 購読が張れないと永久に「検索中…」                              | **issue**           | `main` から在る。文言と段（ADR-0004）の決定が要る                                                                                                                                                                                                                   |
| architecture: `lib/virtual/` を `shared/ui` へ、`model/` セグメントの導入 | **`docs/IDEAS.md`** | この差分の外。6週間以内に着手する見込みが無い                                                                                                                                                                                                                       |
| architecture: `useSearchSession` へ検索の寿命を下げる                     | **`docs/IDEAS.md`** | R2-3 の最小の直しでこの PR の穴は塞がる。集約は別の判断                                                                                                                                                                                                             |

### 対象そのものを疑ったか

所見が集まっている機構は**溜め場（`chunkBuffer`）で 4件**（R2-1 / R2-5 / R2-8 / R2-20）。r1 でも4件だったので、**2ラウンド続けて同じ機構に集まっている**。

r1 の計画は「r2 でまた溜め場に所見が出るなら、そのときは機構ごと動かす」と書いた。**その条件に当たった。**
ただし r2 の4件はいずれも「門の穴」「名前」「置き場」で、**溜め場そのものが不要だという所見は1つも無い**
（合流の効果は perf が実測で確認: `mergeFiles` が 46.2ms → 5.7ms）。
落とすのではなく、**置き場を分けて React 抜きで検査できる形にする**（順21）ところまでを取る。
r3 でまだ溜め場に所見が出たら、そのときは `api/tauri.ts` 側へ出す案を実行する。

### 次ラウンドの焦点

1. **R2-1 の修正で、`search_begin` を落とした回に `isDone` が立たなくなっていないか**
2. **R2-3 の世代が、正常な起動まで捨てていないか**（同じ `queryKey` での再描画、StrictMode）
3. **R2-6 で `activeIndex` を導出にしたあと、`indexOf` が `-1` を返す間の描画**（新しい検索の最初のレンダ、クランプとの噛み合い）
4. **R2-17 でコメントを減らした結果、理由に辿り着けなくなっていないか**
5. **R2-20 で破棄の口を1つにしたあと、3つの置き場が本当に同じ順で落ちるか**
6. **R2-8 の改名で、境界（`<=` か `<` か）の意味が名前と一致したか**

### 検証の見積り

21件 × `verify`（実測 60〜90秒）≒ **30分**。`docs/state-transitions/` は今回触らないので `verify:rust` は走らない見込み。
