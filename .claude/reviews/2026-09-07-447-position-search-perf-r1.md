# レビュー 447-position-search-perf ラウンド1

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（基点 `8d53ea45` / 対象 `c98040d7`）。11ファイル、+1327 −147
- 走らせた reviewer: architecture / react / perf / robustness / comment / oss-hygiene
- 変更の狙い: #447（局面検索のヒットが数千件で止まる）。合流バッファ・増分導出・読みのデバウンス＋in-flight 合流＋バイト上限キャッシュ＋先読み

## 所見

### [BLOCK] B-1 「写しを渡す」理由が、いまのコードでは成り立っていない（かつ経緯の混入）

- reviewer: comment
- 場所: `src/entities/search/model/provider.tsx:357-360`
- 根拠: 「いまその形が表に出ていないのは、判定が毎回外れて別の配列を返しているからでしかない」。`canAppend` は同じ差分で当たるようになっており、写しが要る理由は「1行下で `slice()` しているから」ではなく「`flat` が伸び続ける同じ配列だから」
- なぜ問題か: 読み手は「判定は外れるものらしい」と読み、`canAppend` を触るときに誤った前提を持つ。CONTRIBUTING の「変更の経緯を書かない」にも当たる
- 直し方: 3文目を削る

### [BLOCK] B-2 コメントが存在しない識別子 `PREFETCH_STEP` を指している

- reviewer: comment
- 場所: `src/features/position-search/ui/PositionSearchContinuation.tsx:38`
- 根拠: `grep -rn PREFETCH_STEP src/` はこの1行だけ。実在するのは `PREFETCH_DELAY_MS`
- 直し方: `PREFETCH_DELAY_MS` に直す。歩幅（`activeIndex + moveDirRef.current`）は呼び手側にあるので、そこは `prefetchHit` の doc へ

### [HIGH] H-1 選択が外れた後に、前の行の続きが書き戻される（早期 return が世代を進めない）

- reviewer: react（**再現済み**）
- 場所: `src/features/position-search/ui/PositionSearchContinuation.tsx:210-218`
- 根拠: `if (!target) { … return; }` が `++seqRef.current` より前にある。飛んでいる読みの `mySeq` が有効なまま残り、解決時に `setMoves` が通る
- なぜ問題か: 検索をやり直して0件になったとき、**前の検索で選んでいた行の続きが右ペインに残る**。`loading` も落ちているので「取得中」ですらない。`main` にも同じ形があるが、この差分でデバウンスと先読みが入り「読みが飛んでいる状態」が常態になったので当たりやすさが変わった
- 直し方: `const mySeq = ++seqRef.current;` を `if (!target)` より前に出す。テストで固定する

### [HIGH] H-2 状態遷移表が「選択は `hitKey` で追う」のまま

- reviewer: oss-hygiene
- 場所: `docs/state-transitions/position-search-view.md:55`
- 根拠: 実装は `orderedHits.indexOf(activeHitRef.current)`。同じファイルのコメントが「鍵の文字列にしない」と正面から反対を書いている
- なぜ問題か: `docs/spec/screens/position-search.md` が状態の表をこちらへ委譲している。**唯一の出所が嘘になる**。`hitKey` は `refusedHit` で現役なので grep しても矛盾に気づけない
- 直し方: 備考を「選択はヒットの実体（参照）で追う（`orderedHits.indexOf`）。`hitKey` は断りを付ける行を覚えるほうにだけ残る」に差し替える

### [HIGH] H-3 `MAX_CACHED_CHARS` の doc が採らなかった理由を誤って説明し、実際の保持量が約6倍

- reviewer: comment / perf（**perf は実測**）
- 場所: `src/features/position-search/ui/PositionSearchContinuation.tsx:42-53`, `:114-124`
- 根拠:
  - comment: doc は「件数で切ると打鍵がほぼ全部外れる」を理由に挙げるが、量で切っても同じように外れる。1本 100KB なら 2,000,000 文字で 20〜40本＝旧上限（16件）と同じ桁。実際の理由は「大きい棋譜ばかりのときに件数上限では抱える量が青天井になる」
  - perf: `tsshogi` の `importKIF → exportJKF → normalizeMinimal` を通した 120手 KIF は原文 3,871 文字／保持 JKF は **原文1文字あたり 11.9 bytes**（516本を `--expose-gc` で保持、heapUsed 差 22.7MB）。上限に届いた時点で **22.7MB**。doc の「控えめに置く」は逆向き
- 直し方: 理由を「量で切る」に直し、実測係数（11.9 bytes/文字）を数式か doc に出す。上限は byte 予算で書くか、`MAX_CACHED_CHARS` を下げる

### [HIGH] H-4 `lastChunk` の doc に「元はこうだった」が入っている

- reviewer: comment
- 場所: `src/entities/search/model/provider.tsx:53-61`
- 根拠: 「（この形が実際に O(n²) を作っていた）」。前2文は現在形の「なぜ」として正しい
- 直し方: 括弧内を削る

### [HIGH] H-5 続きの読みが失敗しても「（続きなし）」としか出ない

- reviewer: robustness / oss-hygiene
- 場所: `src/features/position-search/ui/PositionSearchContinuation.tsx:78`, `:236-240`, `:285-286`
- 根拠: `loadKifu` は `describeFsError` で理由を作って投げるが、唯一の呼び手が引数無しの `catch` で捨てる。権限拒否・ファイル消失・壊れた KIF・索引がパスを返さない、が**投了直後のヒットと1文字も違わない**
- なぜ問題か: 利用者は「この棋譜はここで終わっている」と読む。`docs/spec/README.md` の「無いものを『無い』と書く」にも反する（仕様の失敗表にこの行が無い）
- **範囲の判断**: `main` から在る。直すには第3の表示状態と文言・段（ADR-0004）の決定が要る。**issue を立て、仕様の「いま満たしていないこと」に載せる**（`/implement` 手順7「直し方に判断が要る」）

## 重複・矛盾した所見

### D-1 解放の口が無い（perf / react / robustness の3人）

`clearSearch` は `src/` に呼び手が1つも無く、`open_start` は `hitsCacheRef` を掃除しない。
perf の実測で n=100,000 のとき `session.chunks` 16.2MB + この差分が足した `flat`+`snapshot` 1.4MB
＝ **1検索あたり 17.6MB** が解放されない。モーダルを開くたびに積み上がる。

- 直し方（3人が一致）: `PositionSearchModal` が rid を捨てる2箇所（閉じるとき／`queryKey` が変わったとき）で `clearSearch(prevRid)` を呼ぶ。`openProject` の `dropPendingChunks()` の隣で `hitsCacheRef.current.clear()`

### D-2 合流バッファの入口が閉じていない（robustness M3 / M5、react M4）

- `dropPendingChunks()` が消せるのは**その瞬間までに溜まったぶんだけ**。Rust の `open_project` は進行中の検索をキャンセルしない（`src-tauri/src/search/commands.rs:45`）ので、`open_start` の直後に届いたチャンクが `ensureSession` で消えたセッションを作り直し、`currentRequestId` と `filePathById` を古い根のものへ戻す。**コメントは「捨てるので作り直されない」と言い切っているが成り立っていない**
- 後片付けにも「もう終わった」印が無い。unmount 後に届いたチャンクがタイマを張り直せる
- テスト `畳まれたら溜め場ごと捨てる` は cleanup effect を丸ごと削除しても緑（react が実測）。`not.toThrow()` の外に守りたいものがある
- 直し方: 溜め場の object に `disposed` と「死んだ rid の集合」を持ち、`enqueueChunk` の入口で弾く。テストは `vi.getTimerCount()` を見る

### D-3 ファイル名 `orderPositionHits.ts` に `orderPositionHits` が無い（architecture / comment）

export は `hitKey` と `useOrderedPositionHits` の2つで、しかも別の関心。
`lib/` の先例は `usePositionHitNavigation.ts`（ファイル名＝フック名）。

- 直し方: `lib/useOrderedPositionHits.ts` と `lib/hitKey.ts` に分ける

### D-4 `KifuCache` の置き場と、追い出しの穴（architecture M3 / robustness M4）

- architecture: IO の合成・in-flight の畳み込み・バイト量での追い出し・棋譜の走査という UI でない知識4つが `ui/` の `.tsx` に 90行超で同居。テストがコンポーネントを描画しないと境界を突けない。`useRef(new KifuCache(...))` にしたことでキャッシュの寿命が「どこに `new` を書いたか」の副産物になっている
- robustness: `evict()` が未解決の entry を `chars: 0` として数えるので、上限超過のたびに `entries.size === 1` まで削り落とす。消された先読みは解決時に自分が居ないことに気づいて中身を捨て、その行へ降りると**150ms 待たされたうえで2本目の `read_file` が飛ぶ**
- 直し方: `lib/kifuCache.ts` へ出す。`evict` は解決済みのものだけを落とす

## その他の所見

### [MEDIUM] M-1 購読の effect が、溜め場のコールバックに依存するようになった

- reviewer: architecture / react
- 場所: `src/entities/search/model/provider.tsx:236`
- 根拠: deps が `[]` から `[enqueueChunk, flushChunks]` になった。いまは連鎖が全て安定だが、`flushChunks` が `state.sessions` を見た瞬間にチャンク到着ごとに購読が張り直る。`listen` は IPC の往復を待つので、隙間の emit は誰にも届かず**エラーも出ずに件数だけ減る**
- 直し方: 起こし手を `chunkBufferRef` の object に入れ、deps を `[]` に戻す

### [MEDIUM] M-2 「末尾にしか増えない」という不変条件を、2つの層が別々に手書きで持っている

- reviewer: architecture
- 場所: `provider.tsx:343-346` と `lib/orderPositionHits.ts:63-66`
- 根拠: 同じ3節の述語が entities と features に独立して書かれ、どちらも末尾1要素しか見ない。この検査は既に1度間違えており（`53ca9e40` が直したのは provider 側だけ）、次も片方だけ直る形
- 直し方: 述語を `shared/lib/` の1関数に出して両者から呼ぶ

### [MEDIUM] M-3 `prefetchHit` の契約（中身を出さない）が型で何も止めていない

- reviewer: architecture
- 場所: `PositionSearchContinuation.tsx:17-25`, `:259-262`
- 根拠: 子は絶対パスしか取り出していないのに `PositionHit` 全体を受け取り、そのせいで `resolveAbsPath` の同一性churn を避ける `useMemo` と注意書きが要っている
- 直し方: prop を `prefetchAbsPath?: string | null` にする。memo と注意書きが丸ごと消える

### [MEDIUM] M-4 毎フラッシュに残る最大の費用は `[...same, ...other]`

- reviewer: perf（**実測**）
- 場所: `lib/orderPositionHits.ts:86`
- 根拠: n=100,000 で spread **1.370ms** / `concat` **0.114ms** / `flat.slice()` 0.035ms。残した O(n) コピー3本のうち spread 1本が残り2本の合計の9倍。効くのは n ≥ 50,000 かつストリーミングが1秒以上続くときだけ
- 直し方: `cache.same.concat(cache.other)`

### [MEDIUM] M-5 `PositionHitItem` の `memo` は到達不能。それを効くものとして根拠にしているコメントが残っている

- reviewer: perf
- 場所: `PositionSearchModal.tsx:251-254`（コメント）、`VirtualHitRow.tsx:68-71`
- 根拠: `VirtualHitRow` が `onSelect` / `onAccept` を毎回リテラルで作るので shallow compare は必ず外れる。**性能上の実害は無い**（仮想リストで比較に到達する行は約31行に頭打ち）
- 直し方: コメントを事実に直す（memo を効かせるより安い）

### [MEDIUM] M-6 `resolveHitAbsPath` は引けないとき `null` でなく空文字を返す

- reviewer: robustness
- 場所: `src-tauri/src/search/query_service.rs:151`（`unwrap_or_default()`）、`reducer.ts:47-61`、`provider.tsx:388-391`
- 根拠: Rust はそのチャンクに出た fileId を必ず `files` に載せるので `?? null` は一度も効かない。`if (abs && …)` 系が**空文字が falsy であることだけに乗って偶然正しく動いている**。`VirtualHitRow.tsx:44` は日本語 UI に `"path unknown"` を出し、`PositionSearchDestinationCard` は「未選択」と出す
- **範囲の判断**: Rust 側の修正が要り（`verify:rust`）、UI の文言決定も伴う。`main` から在る。**issue へ**

### [MEDIUM] M-7 「既定の 300 件区切り」は既定ではない

- reviewer: comment
- 場所: `provider.tsx:41`、`types.ts:74`、`chunkCoalescing.test.tsx:13`
- 根拠: 既定を持つのは `searchPositionBestEffort`（**5000**）だけ。300 は `PositionSearchModal.tsx:179` の直値
- 直し方: 「既定の」を落とし、出所を書く。`chunkSize: 300` の側に `CHUNK_FLUSH_MS` の前提であることを1行

### [MEDIUM] M-8 実測値が出典なしで4箇所に散っている

- reviewer: comment
- 場所: `orderPositionHits.ts:36-37`(2,357ms)、`PositionSearchContinuation.tsx:230-231`(0.13/2.54ms)、`chunkCoalescing.test.tsx:58`(836ms)、`PositionSearchModal.test.tsx:67`(0.5〜2.7µs)
- 根拠: `docs/decisions/0007` が「実測（日付）。**再現できる形で書く。**」を作法にしている。`PositionSearchModal.test.tsx:202` の 24 秒は出典付きで書けている
- 直し方: 出典（`.claude/reviews/...`）を添えるか、添えられない数字は削って定性的な理由だけ残す

### [MEDIUM] M-9 「macOS の既定で 25〜30 回/秒」は既定でなく最速設定

- reviewer: comment
- 場所: `PositionSearchContinuation.tsx:34`、同テスト `:12`, `:181`
- 根拠: `KeyRepeat` の既定値 6 × 15ms = 90ms ≒ 11 回/秒。25〜30 回/秒はスライダ最速側
- 直し方: 「最速設定では 30 回/秒に達する（`KeyRepeat` の下限 2 × 15ms）」に直す

### [MEDIUM] M-10 公開面（`PositionSearchContextType`）に、返り値が共有配列だという不変条件が書かれていない

- reviewer: comment
- 場所: `types.ts:96-101`
- 根拠: 実装側には厚い doc があるが、呼び手が読む面には1行も無い。返り値を `sort()` / `reverse()` する呼び手が1人出ればキャッシュと state が同時に壊れる
- 直し方: `getHitsByRequestId` に TSDoc。`useOrderedPositionHits` にも同じ1行

### [MEDIUM] M-11 コメントが指す `search_chunk` というアクションは存在しない

- reviewer: comment
- 場所: `PositionSearchModal.tsx:213`
- 直し方: `search_chunks`（`entities/search/model/reducer.ts`）に直す

### [MEDIUM] M-12 テストの名前とコメントが、実際に検証している内容より広い（2件）

- reviewer: comment
- 場所: `chunkCoalescing.test.tsx:135-146`（順序を名乗って件数だけ見ている）、`orderPositionHits.test.tsx:111-118`（「同じ長さでも」と言いながら 3→4 件）
- 直し方: 前者は `lastHits.map(h => h.occ.fileId)` を見る。後者は同じ長さで実体だけ差し替えるケースにする

### [MEDIUM] M-13 `PositionSearchModal` の ref 宣言が、それを書く effect より 60行下にある

- reviewer: react
- 場所: `PositionSearchModal.tsx:158`, `:177`（書く側）、`:218`, `:225`（宣言）
- 根拠: いまは effect が commit 後に走るので TDZ を踏まないが、**成立している理由が「実行が後だから」だけ**。この行を `useMemo` へ移す・early return を上に足す、のどちらでも落ちる
- 直し方: 宣言を effect より前へ出す。reviewer は `useHitSelection` への切り出しを勧めているが、**これは性能修正の範囲外**（別途判断）

### [MEDIUM] M-14 仕様に先読みが書かれていない

- reviewer: oss-hygiene
- 場所: `docs/spec/screens/position-search.md:53-55`
- 根拠: 「読みに行くのは選択が止まってから」は網羅的な規則として読まれるが、実際は選択していない棋譜も `read_file` される。「読み込み済みなら待たずに出る」も、先読みを知らない読者には「一度見た行だけ速い」と読める
- 直し方: 先読み（300ms・直前に動いた向きの次の1行・中身は出さない）を1行足す

### [MEDIUM] M-15 状態遷移表の chunk 事象が「Rust の分割到着」のまま

- reviewer: oss-hygiene
- 場所: `docs/state-transitions/position-search-view.md:55`, `:79`, `:127`
- 根拠: 画面が見るのは 50ms ごとに畳んだ束。`L-load → L-strm` は「Rust が最初の chunk を emit した瞬間」ではなくなった。この表から未消化セルのテストを起こす人は落ちる
- 直し方: 発生源を「画面側で 50ms 単位に畳んだ束（`CHUNK_FLUSH_MS`）。`done` / `fail` は待たずに吐き出す」に直す。数値は定数名で参照し、表に二重に書かない

### [MEDIUM] M-16 `obs-shogi-spec.md` が消えた識別子 `orderPositionHits` を指す

- reviewer: oss-hygiene
- 場所: `obs-shogi-spec.md:55`
- 直し方: `useOrderedPositionHits` に直す

## 見ていない範囲

- Rust 側は `query_service.rs` の emit ループと `commands.rs` の cancel 有無のみ。索引の構築・watcher・`file_table` の世代管理は未読
- **334 チャンクが実時間で何秒に散るか（＝フラッシュ回数 F の実測値）を誰も測っていない。** `yield_now()` は実時間を進めないので、`provider.tsx` の「実時間に散らして emit する」という前提自体が未検証。ここが違うと M-4 の重みが変わる
- SCSS・見た目・仮想リストの描画（ui-reviewer は走らせていない。この差分に SCSS もレイアウトも無い）
- 実機での挙動（背面ウィンドウでの `setTimeout` の絞られ方、10万件時の実測）
- 実物の棋譜がリポジトリに無いため、perf の測定は `tsshogi` で組んだ合成 KIF。分岐が多い研究用・エンジン解析コメント付きはこれより大きい可能性があり、H-3 の 11.9 bytes/char は下限寄り

## lint / hook で強制できるもの

- **コメント／doc 中のバッククォート識別子が実在するかの走査**。B-2（`PREFETCH_STEP`）、M-11（`search_chunk`）、M-16（`orderPositionHits`）の3件が1本で落ちる。置き場は `src/__tests__/`（`commentHistory.test.ts` / `cursorConstruction.test.ts` と同じ形）。外部語（`read_file`, `yield_now`）は除外リストで抑える
- **「実測」を含むコメントに出典を要求する走査**。M-8 の4件が落ち、出典付きの1件は通る
- **`ui/` の `.tsx` に `class` 宣言を置かない**ラチェット。D-4 の `KifuCache` が引っかかる
- **`docs/` に現れた `\d+ms` のうち、対応する定数名を伴わないもの**を警告する走査（M-15 の再発防止）
- 経緯の混入（B-1 / H-4）は `HISTORY_WORDS` のリテラル一致では拾えない。`ていた` を足すと現在形の説明を巻き添えにするので**機械化しない**
- M-1（購読 effect の deps）は lint で表せない。**コードの形**（起こし手を ref の object に入れる）で不可能にする

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **溜め場の門番**: D-2（入口が閉じていない）→ M-1（購読 deps）。D-2 の直し方は「起こし手を溜め場の
  object へ入れる」なので、**M-1 の指摘箇所（deps が `[enqueueChunk, flushChunks]`）は D-2 を直すと消える**
- **解放**: D-1（`clearSearch` の呼び手ゼロ・`hitsCacheRef` が `open_start` で残る）→ D-2。
  D-1 が `clearSearch` を実際に呼ぶようにすると、D-2 の「`clear_search` 側の穴」が**表に出る経路になる**。
  D-2 を先に置く
- **置き場**: D-4a（`KifuCache` を `lib/` へ）→ D-4b（`evict` の穴）→ H-3（上限の doc）→ B-2（`PREFETCH_STEP`）。
  D-4a で行が動くので、後の3件は**移動先で取る**
- **改名**: D-3（`orderPositionHits.ts` の分割）→ M-16（`obs-shogi-spec.md` の識別子）。
  D-3 を直すと M-16 の参照は**壊れる**ので、同じコミットで追随しないと嘘が増える。
  M-16 は D-3 の修正の一部として扱う（別の所見を畳んでいるのではなく、同じ1つの改名）
- **状態遷移表**: H-2 と M-15 は同じ行（`:55`）。H-2（追従の手段）を先に直し、M-15（事象の発生源）を
  その上に重ねる

### このラウンドで直すもの

| 順  | 所見                                                             | なぜこの順か                                                                                                     | この直し方で壊しうるもの                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | H-1 世代を進めない早期 return                                    | **唯一の、利用者に見える誤り**。失敗経路の向きを変えるので、修正が積み上がる前に入れる（`/review-plan` 手順3-3） | `target` が `null` になるたびに世代が進むので、**飛んでいる読みは全て捨てられる**。`activeHit` が一瞬 `null` になってから同じ行へ戻る経路（クランプ effect が `selectIndex(n-1)` を通る）があると、キャッシュに載る前の読みを毎回捨てて読み直す。`KifuCache` が `Promise` を抱えるので `read_file` は増えないが、`buildPlayer` は増える                    |
| 2   | D-2 溜め場の入口が閉じていない                                   | 門番の向きを変える。D-1 が `clearSearch` を実際に呼ぶ前に閉じる                                                  | 死んだ rid を弾くようになるので、**`search_begin` より前に届いたチャンクが捨てられる**。Rust は begin → chunk の順に emit するので現物では起きないが、順が入れ替わる経路（別プロセス・再送）があれば結果が0件になる。`disposed` は unmount 後の積み込みを止めるので、StrictMode の1回目で畳まれた溜め場が2回目に引き継がれない（引き継いでいた想定は無い） |
| 3   | M-1 購読 effect の deps                                          | D-2 で起こし手が ref へ移るので、ここで `[]` に戻す                                                              | deps が `[]` に戻るので、**`enqueueChunk` が閉じ込めた値は初回の1つで固定される**。溜め場の object 越しに読むので今は問題ないが、将来 props を読む形にすると古い値を掴む                                                                                                                                                                                   |
| 4   | D-1 解放の口が無い                                               | 門番を閉じた後。閉じる前に呼ぶと、`clear_search` の後に届いたチャンクがセッションを作り直す                      | `clearSearch(prevRid)` を閉じる/撃ち直す2箇所で呼ぶと、**そのセッションを見ている描画が同じフレームで0件になる**。`PositionSearchModal` は `requestId` も同時に `null` にするので `EMPTY_HITS` へ落ちるが、順序が逆になると「完了・0件」が一瞬出る                                                                                                         |
| 5   | D-4a `KifuCache` を `lib/kifuCache.ts` へ                        | 移動を先にやる。後の3件（D-4b / H-3 / B-2）が移動先で取れる                                                      | 移動だけ。**寿命は変えない**（`useRef(new KifuCache(...))` のまま）。変えると「モーダルを閉じても抱え続ける」に化けるので、寿命は別の判断として据え置き、その旨をファイルに書く                                                                                                                                                                            |
| 6   | D-4b `evict` が未解決を 0 文字で数える                           | 移動先で取る                                                                                                     | 解決済みだけを落とすようになるので、**未解決だらけのとき上限を超えたまま止まる**。先読みは1本ずつしか飛ばないので現物では起きないが、`while` が進めない場合に無限ループしない形にすること                                                                                                                                                                  |
| 7   | H-3 `MAX_CACHED_CHARS` の理由と実測係数                          | 移動先で取る。D-4b で `chars` の数え方に触るので直後に置く                                                       | 実測係数（11.9 bytes/文字）を掛けると**実効の上限が約 1/12 になる**。同じ 2,000,000 のままだと抱えるのは 20〜40本 → 2〜3本になり、矢印移動のキャッシュが効かなくなる。予算そのものを byte で置き直すこと                                                                                                                                                   |
| 8   | B-2 `PREFETCH_STEP`                                              | 移動先で取る                                                                                                     | 無し（文字列の置換）                                                                                                                                                                                                                                                                                                                                       |
| 9   | D-3 + M-16 `orderPositionHits.ts` の分割・改名                   | 他の所見の指摘箇所（M-16）を消す                                                                                 | import が5箇所動く。`docs/spec/screens/position-search.md` と `obs-shogi-spec.md` の識別子が**追随しないと嘘になる**。テストのファイル名も揃える                                                                                                                                                                                                           |
| 10  | M-2 「末尾にしか増えない」述語の二重持ち                         | 改名の後（`useOrderedPositionHits.ts` が確定してから）                                                           | 述語を `shared/lib/` へ出すと、**entities と features が同じ関数を見る**ようになる。片方だけ条件を足したくなった場合に無理が出る（`currentAbs` の一致は features 固有なので、共有するのは3節のうち2節だけ）                                                                                                                                                |
| 11  | M-3 `prefetchHit` → `prefetchAbsPath`                            | 型で契約を止める。M-4 より先（同じファイル群を触る）                                                             | 親が `resolveHitAbsPath` を呼ぶ回数が毎レンダ1回増える（いまは子の `useMemo` に載っている）。`filePathById` の引きは `Record` の1回なので無視できるが、**親が memo していないと先読みの effect が毎レンダ張り直される**——文字列は値比較なので実際は張り直らない。ここを確かめること                                                                        |
| 12  | M-4 `[...same, ...other]` → `concat`                             | 1行。改名の後                                                                                                    | 無し。同一性は新しい配列のままなので React 側の判定は変わらない                                                                                                                                                                                                                                                                                            |
| 13  | H-4 `lastChunk` の doc の経緯                                    | ここから下はコメントと doc。コードを動かし終えてから取る                                                         | 無し                                                                                                                                                                                                                                                                                                                                                       |
| 14  | B-1 「写しを渡す」理由の経緯と嘘                                 | 同上                                                                                                             | 無し                                                                                                                                                                                                                                                                                                                                                       |
| 15  | H-2 状態遷移表の追従の手段                                       | doc。`verify:rust` が走る                                                                                        | 無し（表の記述）                                                                                                                                                                                                                                                                                                                                           |
| 16  | M-15 状態遷移表の chunk 事象                                     | H-2 と同じ行。重ねる。`verify:rust` が走る                                                                       | 表から未消化セルを起こす人の前提が変わる。`:127` の行に経路が1つ増える                                                                                                                                                                                                                                                                                     |
| 17  | M-14 仕様に先読みが無い                                          | doc                                                                                                              | 無し                                                                                                                                                                                                                                                                                                                                                       |
| 18  | H-5 仕様の「いま満たしていないこと」へ載せる（コードは直さない） | doc。issue と対で置く                                                                                            | 無し（表に1行足すだけ）                                                                                                                                                                                                                                                                                                                                    |

### 直さないもの

| 所見                                                 | 行き先              | 理由                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-5 続きの読みの失敗が「（続きなし）」に潰れる       | **issue**           | `main` から在る。直すには第3の表示状態・文言・段（ADR-0004）・再試行の導線の決定が要る。`/implement` 手順7 の「直し方に判断が要る（設計の選択が絡む）→ issue を立て、ユーザーに選ばせる」。仕様の「いま満たしていないこと」には同じ PR で載せる（上の順18）                                   |
| M-6 `resolveHitAbsPath` が `null` でなく空文字を返す | **issue**           | Rust 側（`unwrap_or_default()`）の修正が要り、`VirtualHitRow` の `"path unknown"` と `PositionSearchDestinationCard` の「未選択」という UI 文言の決定も伴う。`main` から在り、この差分の前提を壊してはいない（`useOrderedPositionHits` は falsy 判定なので空文字でも正しく `other` へ落ちる） |
| M-5 死んだ `memo` を根拠にしたコメント               | **r2**              | 件数を減らすため。実害無しと perf が明言している                                                                                                                                                                                                                                              |
| M-7 「既定の 300 件区切り」                          | **r2**              | 同上                                                                                                                                                                                                                                                                                          |
| M-8 実測値の出典なし4件                              | **r2**              | 同上                                                                                                                                                                                                                                                                                          |
| M-9 「macOS の既定で 25〜30 回/秒」                  | **r2**              | 同上                                                                                                                                                                                                                                                                                          |
| M-10 公開面の TSDoc                                  | **r2**              | 同上                                                                                                                                                                                                                                                                                          |
| M-11 `search_chunk` という存在しないアクション名     | **r2**              | 同上                                                                                                                                                                                                                                                                                          |
| M-12 テスト2件が実際より広いことを名乗る             | **r2**              | 同上。**r2 の先頭に置く**（テストの名乗りは他より重い）                                                                                                                                                                                                                                       |
| M-13 ref 宣言が書き手より下にある                    | **r2**              | 同上。react が勧める `useHitSelection` への切り出しは**性能修正の範囲外**として見送る。宣言位置だけ動かす                                                                                                                                                                                     |
| lint / hook の走査4本                                | **`docs/IDEAS.md`** | `CLAUDE.md`「同じ失敗を2回するまでルールを足さない」。識別子の走査は今回3件出たので**2回目に当たる可能性がある**が、`commentHistory.test.ts` の隣に足す判断は独立して取りたい                                                                                                                 |

### 対象そのものを疑ったか

所見が集まっている機構は2つ。

- **合流バッファ（`chunkBufferRef`）に 4件**（D-2 の3件 + M-1）。すべて「溜め場という機構が、
  セッションの生死という別の機構と噛み合っていない」から出ている。**落とす案**: 合流を provider から
  `api/tauri.ts` の `listenSearchEvents` 側へ出し、provider は dispatch だけに戻す
  （architecture M-1 の後段の提案）。**今回は落とさない**——#447 が要求しているのは
  「レンダ回数を件数から切り離す」ことで、それは溜め場が provider にあっても達成できる。
  ただし r2 でまた溜め場に所見が出るなら、そのときは機構ごと動かす
- **`KifuCache` に 3件**（D-4a / D-4b / H-3）。置き場と、上限の数え方。落とす案は無い——
  in-flight 合流とバイト上限は #447 の直し方そのもの

所見が減らないラウンドはまだ1回目なので、対象を疑う段には達していない。

### 次ラウンドの焦点

次の `/review-round` は、これを reviewer へ渡す。

1. **H-1 の修正で、飛んでいる読みが余分に捨てられていないか。** `target` が `null` を挟んで
   同じ行へ戻る経路（クランプ effect）で `buildPlayer` が増えていないか
2. **D-2 の「死んだ rid」の判定が、生きている検索を巻き込んでいないか。** `search_begin` と
   `search_chunk` の順、`open_start` 直後に始まった新しい検索
3. **D-1 の `clearSearch` 呼び出しで、閉じる瞬間に「完了・0件」が出ないか。** `requestId` を
   `null` にする順との関係
4. **D-4b の `evict` が進めなくなる経路（全部が未解決）で無限ループしないか**
5. **H-3 で上限を byte 予算へ置き直したあと、矢印移動でキャッシュが実際に効くか。**
   実効の本数が 2〜3 本に落ちていないか
6. **M-2 の共有述語が、entities と features の片方だけに要る条件を飲み込んでいないか**
7. **D-3 の改名で、識別子を指す doc が1つも取り残されていないか**（`docs/`・`obs-shogi-spec.md`・
   `.claude/reviews/` を除く）

### 検証の見積り

- このブランチは `src-tauri/` を触らない。ただし **順15・16 は `docs/state-transitions/` なので
  `verify:rust`（約2分15秒）も走る**（`.claude/hooks/verify-gate.sh`）
- 見積り: 16件 × `verify`（実測 60〜90秒）+ 2件 × (`verify` + `verify:rust`) ≒ **30分**
- **9件を r2 へ送った**（M-5 / M-7 / M-8 / M-9 / M-10 / M-11 / M-12 / M-13 と lint 走査）。
  送らなければ 26件で 45分を超える
