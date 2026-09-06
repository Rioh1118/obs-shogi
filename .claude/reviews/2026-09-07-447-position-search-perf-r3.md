# レビュー 447-position-search-perf ラウンド3

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（基点 `8d53ea45` / 対象 `1887f8d6`）
- 走らせた reviewer: react / robustness / comment / architecture
- 前ラウンド: `-r2.md`。その「次ラウンドの焦点」6点を全 reviewer へ渡した

**焦点への答え**（r2 の計画が「壊しうる」と書いたもの）:

| 焦点                                             | 結果                                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 begin を落とした回に `isDone` が立たなくなるか | **踏めない**（2人が独立に確認）。`search_requested` がセッションを作り、`search_end` は門を通さず reducer 側で守られている。ただし**担保がその1点に移ったのに、それを固定するテストが無い** → R3-6 |
| 2 起動の世代が正常な起動まで捨てるか             | **捨てていない**。ただし**捨てた側の後始末が現に走っている起動へ書き戻る** → R3-1                                                                                                                  |
| 3 `indexOf` が `-1` を返す間の描画               | **漏れない**。`-1` は 0 に畳まれ、空配列の `undefined` は全経路が受けている                                                                                                                        |
| 4 コメントを減らした結果                         | **辿れる**（2箇所が同じ指し先を名指し）。ただし指し先の1つが古い → R3-2                                                                                                                            |
| 5 3つの置き場が同じ順で落ちるか                  | **落ちる**（`state.sessions` を消す口は2つだけで、どちらも `dropSessions` の後）。ただし**形で縛れているのは 2/3** → R3-4                                                                          |
| 6 境界が名前と一致したか                         | **一致している**（Rust の `next_request_id` は 1 始まりなので `firstLiveRid = 1` と `>=` で辻褄が合う）。ただし線の引き方に穴が残る → R3-5                                                         |

## 所見

### [HIGH] R3-1 世代を見ているのは `.then` だけ。捨てた起動の `.catch` / `.finally` が現在の画面へ書き戻る

- reviewer: react / robustness（**両者が独立に実測で再現**）
- 場所: `PositionSearchModal.tsx` の `.then`（世代を見る）、`.catch` / `.finally`（見ない）
- 根拠（実測、2人の再現が一致）:
  - **顔1**（`.finally`）: 開く（起動A）→ Esc →すぐ開き直す（起動B）→ A が解決 → `.then` は世代不一致で return するが `.finally` が `setIsLaunching(false)`。B の rid はまだ来ていないので画面は
    **「待機中 / 一致する棋譜がありません」**。`search.md` が核心の欠陥と呼ぶ「0件が完了として出る」がそのまま出る
  - **顔2**（`.catch`）: A が失敗（`start_search` は app handle 未準備で `Err`）すると `launchError` が載り、**B の正しい結果の上に**「検索に失敗しました」が残る。消えるのは `queryKey` が変わるか閉じるときだけで、同じ画面では再検索が撃てない。行が届いても「途中で失敗したので、これで全部とは限りません」が付いたまま
- **r2 の R2-3 が `.then` だけに門を置いたことで生まれている**
- 直し方: 門を `.catch` / `.finally` にも置く。`isLaunching` が立ちっぱなしになる心配は無い（閉じる枝と次の起動が明示的に書き直す）

### [BLOCK] R3-2 状態遷移表が `CHUNK_FLUSH_MS` の置き場を `provider.tsx` と書いている

- reviewer: comment
- 場所: `docs/state-transitions/position-search-view.md`
- 根拠: 現物は `entities/search/model/chunkBuffer.ts`。`provider.tsx` に綴りは1つも無い。**R2-20（`e0b11056`）が置き去りにした**
- なぜ問題か: この表は現物を引くための索引。**機械は止められない**——`docsSourcePaths` はパスの実在だけ、`docsIdentifiers` は綴りが repo のどこかに在れば通るので、**両方が緑のまま対だけが壊れる**
- 直し方: 指し先を直す。同じ段の「`done` / `fail` は待たずに吐き出す」は provider 側なので分けて書く

### [MEDIUM] R3-3 `isIndexBusy` は、自分の doc が名指しした失敗を防げない形のまま

- reviewer: comment / architecture（**comment が実測**）
- 場所: `entities/search/model/indexState.ts`
- 根拠: doc は「union の手書きは tsc が落とすが3項の or は落ちない」と書くが、**同じコミットがその「union の手書き」を `IndexUiState["state"]` に置き換えた**。実測で `IndexState` に `"Compacting"` を1つ足して `tsc -b --force` → **終了コード0**。repo のどこも赤くならない。新しい段は黙って `false`（＝動いていない）になり、索引を組み直している最中の0件が確定した0件として出る
- 直し方: 網羅を tsc に見させる（`Record<IndexState, boolean>`）。引数の `| "Empty"` は `IndexState` に既に含まれるので落とす。置き場も純関数なので `lib/` へ（スライス内の `lib/cursorAdapter.ts` と同じ形）

### [MEDIUM] R3-4 `dropSessions` の doc が「3つとも形で縛る」と言うが、縛れているのは2つ

- reviewer: comment / architecture
- 場所: `provider.tsx` の `dropSessions` と、その2つの呼び手
- 根拠: 関数が落とすのは溜め場と平坦化キャッシュの2つ。3つ目（`clear_search` / `open_start` の dispatch）は呼び手の次の行にしか無い。**名前も誤誘導する**——`dropSessions` は `state.sessions` に一切触らない
- なぜ問題か: doc の言い切りを信じた3人目の呼び手が `dispatch` だけ書くと、R2-1 と同じ壊れ方に戻る
- 直し方: 落とす `Action` を渡して dispatch までこの関数に閉じる。呼び手から `dispatch` の行が消え、順序を変える改変が1行では書けなくなる

### [MEDIUM] R3-5 `open_start` の線が、rid の返っていない invoke を「線より後」に数える

- reviewer: react
- 場所: `chunkBuffer.ts` の `stopAccepting`（`firstLiveRid = maxSeenRid + 1`）
- 根拠: `maxSeenRid` が進むのは「イベントを見た」か「invoke が解決した」の2つだけ。**飛行中の invoke に Rust が既に振っている rid は、どちらにも数えられていない。** 直前が rid 4 なら線は 5 になるが、飛行中の invoke の rid も 5 なので通る。通ると `search_requested` が新しい根にセッションを作り、`mergeFiles` が**前の根の絶対パス**を入れる（門の doc が防ぐと言っている失敗そのもの）
- 現状の踏みやすさ: 根の切り替えは `WorkspaceTab` が `reload()` するので、実際に踏めるのは起動時の `openProject` と検索が競合したときだけ。**r2 が「reload を外した瞬間に破れる」と書いた状態が半分残っている**
- 直し方: `searchPosition` が invoke の前に開き直しの世代を控え、解決後に変わっていたらその rid を止めて `search_requested` を出さない（モーダルの `launchSeqRef` と同じ形）

### [MEDIUM] R3-6 `isDone` が立つ唯一の担保が `search_requested` に移ったのに、それを固定するテストが無い

- reviewer: react
- 場所: `reducer.ts` の `search_end`（`if (!s) return state;`）と `search_requested`（`ensureSession`）
- 根拠: 既存のテストは逆向き（「捨てた検索の終わりが届いても、セッションは戻らない」）しか見ていない。**`search_requested` にも門を足す「対称にする」改変が通ってしまう**。通すと begin を落とした回の end が捨てられ、「検索中…」で永久に止まる
- 直し方: 「`searchPosition` が解決した後、`search_begin` を撃たずに `search_end` だけ撃つ → `isSearchingRequest` が偽になる」を1本

### [MEDIUM] R3-7 `isAccepting` の doc が「チャンク以外の口もここを通す」と言うが、通しているのは `search_begin` だけ

- reviewer: comment / architecture
- 場所: `chunkBuffer.ts` の `ChunkBufferApi`
- 根拠: 呼び手は `enqueue` と `onSearchBegin` の2つ。`search_end` / `search_error` は reducer 側の別ルールで守られ、`search_requested` は**どちらでも守られていない**（門を足しても塞がらない——rid が分かる前の窓がある）
- なぜ問題か: doc を信じた人が reducer の `if (!s) return state` を余分な防御と見て落とすと、R2-1 の HIGH がそのまま戻る
- 直し方: 2つの門を両方書き、`search_requested` が門では守れない理由も書く

### [MEDIUM] R3-8 溜め場の境界テストの doc が、コードに無い `<` / `<=` を「取り違える対象」に挙げている

- reviewer: comment
- 場所: `__tests__/chunkBuffer.test.ts`
- 根拠: 現物の境界は `>=` と `+ 1` の2つ。`<` も `<=` も無い。書いてある失敗（1本だけ生き残る）を起こすのは `+ 1` を落とすこと。**R2-8 の改名で言い回しだけが前の形のまま残った**
- 直し方: 通す条件と線の引き方を、いまの式で書く

### [MEDIUM] R3-9 `chunkSize: 300` の理由が5箇所に写り、定義側の根拠が循環している

- reviewer: comment
- 根拠: 定義側は「`CHUNK_FLUSH_MS` の1回ぶんに1〜数本入る粒度」、`CHUNK_FLUSH_MS` の側は「300 件区切りなら 334 回」。**互いを根拠にしていて、どちらも実測を持たない。** r1 の「見ていない範囲」が「フラッシュ回数 F を誰も測っていない」と記録している当のもの
- 直し方: 理由の正を1つに決め、測っていないことも含めて書く。他の4箇所は数字を写さず参照だけにする

### [MEDIUM] R3-10 `entities/search` の barrel が、provider を素通りする生の invoke を出している

- reviewer: architecture
- 場所: `entities/search/index.ts`
- 根拠: export は35名、スライス外の消費は**7名だけ**。`searchPositionBestEffort` は repo 全体で呼び手0
- なぜ問題か: 「セッションの生死は provider が1人で持つ」形に寄せているのに、その provider を通らない口が同じ barrel から同じ書き方で import できる。feature 側が `searchPosition` を直接呼ぶと、`dropSessions` の対象にならない rid が `currentRequestId` に載る
- 直し方: `api/tauri` の関数4名を barrel から落とす（スライス内は相対で足りる）。`searchPositionBestEffort` は呼び手0なので消す

### [LOW] R3-11 新しいテスト2本が、自スライスを絶対パスで import している

- reviewer: architecture
- 場所: `entities/search/model/__tests__/chunkBuffer.test.ts` / `chunkCoalescing.test.tsx`
- 根拠: 同じファイルの中で `@/entities/search/api/ids` と `../types` が混ざっている。**R2-21 で直したのと同じ形が、私が足したテストに残っている**
- 直し方: 相対に揃える

## 見ていない範囲

- **実プロセス（Tauri の WebView）では1つも動かしていない。** 実測はすべて happy-dom
- Rust 側は `query_service.rs` / `commands.rs` / `types.rs` の `IndexState` / `workspace/commands/kifu.rs` のみ。索引の構築・watcher・`cache/format.rs` は未読
- **`chunkBuffer.ts` の「Rust は `yield_now` を挟んで実時間に散らして emit する」は、r1 から3ラウンド続けて未検証。** 溜め場の存在意義がここに乗っている
- 新しいテスト5本（計 1,308 行）の doc が実際の検査より広く名乗っていないか、は今回突き合わせていない（r1/r2 でこの形が3件出ている）
- `PositionSearchHitList` / `VirtualHitRow` / `lib/virtual/`（`main` 由来で差分の外。行高の件は #479）
- SCSS・アクセシビリティ（この差分に SCSS は無い）

## lint / hook で強制できるもの

- **doc / コメントの「識別子（パス）」の対を突き合わせる走査。** R3-2 がこれで落ちる。既存の `docsIdentifiers` は綴りが repo のどこかに在れば通り、`docsSourcePaths` はパスの実在だけを見るので、**両方が緑のまま対だけが壊れる**。`` `X`（path） `` の形を拾って `X` が `path` の中に在ることを見るだけで足りる。**同じ形（コメントの参照が空振り）が r1 / r2 / r3 と3ラウンド続けて出ている**
- **`IndexState` の網羅性**は lint でなく型で止まる（R3-3 の直し方がそのまま検査になる）
- **barrel の未使用 export と、`api/` の関数の再 export を落とす走査**（R3-10）。今回 `entities/search` だけで28名が該当し、目視では追えない
- R3-1（`.then` にだけ門がある形）は AST で拾えるが誤検知が多い。**この repo では1回目**なので、いまはルールでなくテスト

## 修正計画（r3 → r4）

### 束

- **世代の門**: R3-1 → R3-5。どちらも「飛んでいる非同期が、自分の番かを確かめていない」。R3-1（画面側）を先に直し、同じ形を R3-5（provider 側）へ持っていく
- **門の説明**: R3-7 → R3-4 → R3-8。3つとも「守っている機構と、doc が言う機構が違う」。R3-7 を直すと R3-4 の書き方が決まる
- **`isIndexBusy`**: R3-3 は doc とコードの両方を同時に直さないと、片方だけが嘘になる

### このラウンドで直すもの

| 順  | 所見                                       | なぜこの順か                                        | この直し方で壊しうるもの                                                                                                                                                                               |
| --- | ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | R3-1 `.catch` / `.finally` の門            | **唯一の、利用者に見える誤り**。2人が実測           | 門を足すと `isLaunching` が落ちない経路ができうる。閉じる枝（明示的に `false`）と次の起動（`true` → 自分の `.finally`）の2つで必ず解決することを確かめる                                               |
| 2   | R3-6 begin を落とした回のテスト            | R3-5 の前。担保がどこに在るかを固定してから線を触る | 無し（テストの追加）                                                                                                                                                                                   |
| 3   | R3-5 開き直しの世代を provider にも        | R3-1 と同じ形。テストで担保を固定した後             | 世代が変わったとき `search_requested` を出さないので、**その検索は state に一切残らない**。呼び手（モーダル）は rid を受け取るので、`isSearchingRequest` が偽のまま「検索中…」にならないことを確かめる |
| 4   | R3-3 `isIndexBusy` を網羅に                | 型で止まる形にする。他より先（落ちるなら早く）      | `Record<IndexState, boolean>` にすると `"Empty"` の扱いを明示することになる。いまの or は `"Empty"` を偽にしているので、同じ値を書くこと                                                               |
| 5   | R3-4 `dropSessions` に dispatch まで閉じる | R3-3 の後。破棄の形を最後に固める                   | 呼び手から `dispatch` が消えるので、`open_start` の payload をこの関数が組むことになる。`rootDir` を渡す口が要る                                                                                       |
| 6   | R3-7 `isAccepting` の doc                  | 形が決まってから書く                                | 無し                                                                                                                                                                                                   |
| 7   | R3-8 境界テストの doc                      | 同上                                                | 無し                                                                                                                                                                                                   |
| 8   | R3-2 状態遷移表の指し先                    | doc。`verify:rust` が走る                           | 無し                                                                                                                                                                                                   |
| 9   | R3-9 `chunkSize: 300` の理由               | doc                                                 | 無し                                                                                                                                                                                                   |
| 10  | R3-10 barrel から生の invoke を落とす      | 構造。他が落ち着いてから                            | スライス外の消費が本当に7名かを確かめてから落とす。`searchPositionBestEffort` は呼び手0だが、**消すと `deadcode` の基準が動く**                                                                        |
| 11  | R3-11 自スライスの絶対 import              | 最後                                                | 無し                                                                                                                                                                                                   |

### 直さないもの

| 所見                                                      | 行き先              | 理由                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yield_now` が実時間を散らすという前提（3ラウンド未検証） | **`docs/IDEAS.md`** | 実プロセスでの計測が要り、この worktree には計測の土台が無い。溜め場の効果自体は「レンダ回数」で実測済み（`mergeFiles` 46.2ms → 5.7ms）なので、前提が外れても修正の価値は変わらない |
| 新しいテスト5本の doc の突き合わせ                        | **r4**              | r4 の comment reviewer へ焦点として渡す                                                                                                                                             |
| `isIndexBusy` の置き場を `model/` → `lib/`                | **順4 に含める**    | 同じファイルを触るので分けない（同じ1つの所見の一部）                                                                                                                               |

### 対象そのものを疑ったか

**溜め場（`chunkBuffer`）への所見は r3 で 2件**（R3-5 / R3-8）。r1 で4件、r2 で4件だったので**減っている**。
r2 の計画が置いた「r3 でまだ溜め場に所見が出たら `api/tauri.ts` 側へ出す」の条件は、
件数が減っている以上**当たらない**と判断する——r3 の2件はどちらも「門の穴」ではなく
「線の引き方」と「doc の言い回し」で、機構を動かしても消えない。

代わりに所見が集まったのは**「飛んでいる非同期が自分の番かを確かめる」形で 2件**（R3-1 / R3-5）。
これは r2 で導入した機構（起動の世代）なので、**r4 でまた出るなら形ごと見直す**
（`docs/IDEAS.md` の `useSearchSession` へ寄せる案がその受け皿）。

### 次ラウンドの焦点

1. **R3-1 の門で `isLaunching` が落ちない経路ができていないか**
2. **R3-5 で世代が変わったとき、その検索が state に一切残らないこと**。呼び手が rid を
   受け取って `isSearchingRequest` を引く経路で「検索中…」に固まらないか
3. **R3-4 で `dropSessions` が dispatch まで持ったあと、`open_start` の payload を
   組む責任がどこに行ったか**
4. **R3-3 の `Record<IndexState, boolean>` が `"Empty"` を r3 以前と同じ側に置いているか**
5. **R3-10 で barrel を削ったあと、スライス外から使われている口が全部残っているか**
6. **新しいテスト5本の doc が、実際の検査より広く名乗っていないか**（r1 / r2 / r3 で
   計3件出ている形）

### 検証の見積り

11件 × `verify`（実測 60〜90秒）+ 1件（順8）は `docs/state-transitions/` なので
`verify:rust` も走る ≒ **20分**。
