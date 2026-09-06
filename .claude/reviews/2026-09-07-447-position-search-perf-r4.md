# レビュー 447-position-search-perf ラウンド4

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（基点 `8d53ea45` / 対象 `b22a09c9`）
- 走らせた reviewer: react / robustness / comment / architecture
- 前ラウンド: `-r3.md`。その「次ラウンドの焦点」6点を全 reviewer へ渡した

**焦点への答え**:

| 焦点                                                      | 結果                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 `.catch`/`.finally` の門で `isLaunching` が落ちない経路 | **在る**（実測。世代を進める口は3つあり、doc は2つしか数えていない）→ R4-3                                                        |
| 2 世代が変わった検索が state に残らないこと               | **残らない。だが呼び手が成功と区別できず、画面が「待機中 / 一致する棋譜がありません」になる**（3人が独立に指摘、2人が実測）→ R4-1 |
| 3 `open_start` の payload を組む責任                      | provider（元から reducer の唯一の起こし手なので妥当）。ただし scope の決め方が手書きの三項で**既定が破壊側** → R4-4               |
| 4 `"Empty"` の分類                                        | **変わっていない**（`Empty: false`）。ただし同じ enum の2つ目の表が `default:` で網羅を握り潰したまま → R4-5                      |
| 5 barrel の口が全部残っているか                           | **残っている**（外の消費は7名）。ただし `EVT_*` 7名が値のまま出ていて、門の外に2人目の購読者を作れる → R4-6                       |
| 6 テストの doc が実際より広く名乗っていないか             | comment は「今回は見つからなかった」。**react が別の形を見つけた**——到達しない文字列を見ている assert → R4-2                      |

## 所見

### [HIGH] R4-1 捨てた検索が、呼び手には成功と同じ型で返る。画面は「待機中 / 一致する棋譜がありません」で固まる

- reviewer: react / robustness / architecture（**3人。2人が実測**）
- 場所: `provider.tsx` の `searchPosition`（`generation` が変わったら `stopAccepting` して `return out`）、`PositionSearchModal` の `.then`
- 根拠: 返りは成功時と同じ `SearchPositionOutput`。モーダルの世代（`launchSeqRef`）は動いていないので `.then` は自分の番だと判断し `setRequestId(out.requestId)` する。その rid には `search_requested` が撃たれていないのでセッションが無く、`isSearchingRequest` は偽、`.finally` が `isLaunching` を降ろす。実測の画面は
  **「一致: 0 / 待機中 / 一致する棋譜がありません」**——`search.md` が核心の欠陥と呼ぶ「0件が完了として出る」そのもの。
  `lastQueryKeyRef.current === queryKey` なので**同じ画面では撃ち直せない**。捨てた rid に `cancelSearch` も投げていないので、Rust の検索は最後まで走る
- **r3 の R3-5 が作った。** 「前の根のパスが混ざる」を「黙って0件」に付け替えた形
- 踏みやすさ: 線が引き直されるのは `open_start` だけで、根の切り替えは `WorkspaceTab` が `reload()` する。現に踏めるのは**起動時の `openProject` と検索が競合したとき**
- 直し方: **結末を型に出す。** 呼び手が分岐を書かない限り tsc が落ちる形にする。捨てる側は `cancelSearch` も投げる

### [HIGH] R4-2 `.catch` の門は、外しても全テストが緑になる

- reviewer: react（**変異を当てて実測**）
- 場所: `PositionSearchModal.tsx` の `.catch` の門、テストは「捨てた起動が失敗しても、走っている起動にエラーは出ない」
- 根拠: 門の1行を削って走らせると **12 passed**。対になる `.finally` 側を削ると落ちる。唯一の assert が `not.toContain("検索に失敗しました")` だが、**その文言は到達しない**——それを出すのは `PositionSearchHitList` の空表示で、この試験では起動Bが飛行中なので `isSearching` が真、表示は「検索結果を受信中…」。門を外したとき実際に出るのは状況バーの `error` 文字列で、テストはそこを見ていない
- なぜ問題か: `52d229c1` のコミットメッセージが言う「2つの顔をそれぞれテストで固定」が成り立っていない。**緑が別の理由で出ている**（CLAUDE.md）
- 直し方: 実際に出る値（状況バーの理由）を見る

### [MEDIUM] R4-3 「立ちっぱなしにはならない」は、世代を進める第3の口を数えていない

- reviewer: react / robustness（**両者が StrictMode で実測**）
- 場所: `PositionSearchModal.tsx` の `.finally` の doc と `discardSearch` の3つの呼び手
- 根拠: 世代を進めるのは `discardSearch` だけだが、呼び手は3つ——閉じる枝（直後に降ろす）、撃ち直しの枝（直後に上げ直す）、**畳みの effect（進めるだけで撃ち直さない）**。3つ目の後に setup が再走しても `lastQueryKeyRef.current === queryKey` で早期 return するので、飛行中の起動は全部の門で弾かれ、**降ろす者が居なくなる**。実測（StrictMode）で `cancel=1 clear=1` なのに画面は「検索中…」のまま固まる
- 踏みやすさ: `main.tsx` は StrictMode を使っていないので**いまは踏めない**。踏めなくしているのは `discardSearch` の依存の同一性が安定していることだけで、どこにも書かれていないし検査も無い
- 直し方: 「捨てたら次のレンダで撃ち直す」を1つの不変条件にする（`discardSearch` が `lastQueryKeyRef` まで面倒を見る）。StrictMode で描くテストを1本

### [BLOCK] R4-4 `search_chunks` の doc が、溜め場の置き場を `provider.tsx` と書いている

- reviewer: comment
- 場所: `entities/search/model/types.ts`
- 根拠: R3-2 が `docs/state-transitions/` で直したのと**同じ文言の双子がコード側に残っている**。しかも `5dcd7ee3` がこの doc ブロックを編集して通過した
- 直し方: `model/chunkBuffer.ts` に直す

### [BLOCK] R4-5 `RefusalReason` の doc が「どちらも」「danger」と言うが、理由は3つで1つは `warning`

- reviewer: comment
- 場所: `PositionSearchModal.tsx` の `RefusalReason` の doc
- 根拠: `NavigationOutcome` は3値なので `RefusalReason` は3件。`tree-unavailable` は `warning` で、本文が「もう一度お試しください」と言っている。doc の「どちらも」「danger」「検索し直せば直るは成り立たない」の3つが同時に嘘。`docs/spec/screens/position-search.md` は正しく書けている
- 直し方: 「理由は3つ。**この画面から直せるかで段を決める**」に変え、`danger` 2件と `warning` 1件を並べる

### [MEDIUM] R4-6 `dropSearch` の scope が手書きの三項で、既定が破壊側

- reviewer: architecture
- 場所: `provider.tsx` の `DropSearchAction` と `dropSearch`
- 根拠: union に3つ目を足すと三項は `else` へ落ちて `requestId = undefined`。そのまま**全セッションの線を引き直し**、キャッシュを全部消す。**tsc は1つも落ちない**。加えて `state.sessions` を消すのは reducer なのに、その列挙は provider に在る
- 直し方: 三項を `never` 落ちの switch にする（R3-3 で採った形）。`DropSearchAction` の定義を `reducer.ts` へ移す

### [MEDIUM] R4-7 barrel が `EVT_*` を値のまま出していて、門の外に2人目の購読者を作れる

- reviewer: architecture
- 場所: `entities/search/index.ts`
- 根拠: doc の**字面**（`api/tauri` を出さない）は守られているが、**理由**（provider を通らない口を作らせない）はこの7名で破れる。`EVT_SEARCH_CHUNK` と `listen` の2行で、`isAccepting` を1度も通らない購読者が立つ。スライス外の消費は0
- 直し方: 値 export を落とし、doc に「イベント名も出さない。購読者は provider 1人」を足す

### [MEDIUM] R4-8 `IndexState` の分類表が3つあり、tsc が網羅を迫るのは1つだけ

- reviewer: architecture
- 場所: `features/settings/ui/tabs/WorkspaceTab.tsx` の `badgeForIndexState`（`default:` で受ける）、`entities/search/model/types.ts` の `IndexUiState`
- 根拠: R3-3 は `isIndexBusy` を `Record` にしたが、**同じ enum の2つ目の表は `default:` のまま**。段が増えると黙って「未作成」になり、**設定画面は「未作成」・局面検索は「更新中」**という食い違った2つの顔が出る。`types.ts` の `IndexStatePayload["state"] | "Empty"` も冗長（`IndexState` に既に含まれる）
- 直し方: `Record<IndexState, …>` にして `default:` を落とす。`types.ts` は `IndexState` に寄せる

### [MEDIUM] R4-9 `dead` の doc が、入れる口を1つ少なく数えている

- reviewer: comment
- 場所: `chunkBuffer.ts` の `dead`
- 根拠: R3-5 の修正で `searchPosition` が2人目の書き手になった。doc は `clear_search` しか名指していない
- 直し方: 2つの口を両方書く

### [MEDIUM] R4-10 barrel の doc が、lint が禁じている形を指示している

- reviewer: comment
- 場所: `entities/search/index.ts` の「スライスの中からは相対で読むこと」
- 根拠: `model/__tests__/` から `api/` は2階層遡るので、相対で書くと lint が落ちる（r3 で実測済み）。同じスライスの新しいテストが既にその通りにしていない。加えてこの `/** */` は**どの export にも付いていない**
- 直し方: 「barrel を経由せず実体を読むこと。1階層なら相対、2階層以上は `@/`」に直し、`//` の段落コメントにする

### [MEDIUM] R4-11 指す先の無いレビュー識別子が3箇所。走査は取りこぼしている

- reviewer: comment
- 場所: `openOnRootChange.test.tsx`（`r1-06`）、`reducer.ts`（`C-M2` / `C-M4`）
- 根拠: `C-M2` / `C-M4` は repo のどこにも定義が無い。`commentHistory.test.ts` の `REVIEW_TAG` は閉じ括弧が数字の直後を要求するので `(C-M2 backstop)` を取りこぼし、`r\d+-\d+` も見ていない。**「機械が止める」と書いてあるものが止まっていない**
- 直し方: 識別子を落として、いま守っている条件だけを書く

### [MEDIUM] R4-12 `docs/IDEAS.md` の段が、この差分で根拠ごと古くなった

- reviewer: comment
- 根拠: `searchPositionBestEffort` は**リポジトリから消えている**のに、IDEAS が名指しで残っている。`WorkspaceTab` の `IndexState` 手写しも直っている
- 直し方: 済んだぶんを落とし、残っている主張だけにする

## 見ていない範囲

- **実プロセス（Tauri の WebView）では1つも動かしていない。** 実測はすべて happy-dom
- **`chunkBuffer.ts` の「Rust は `yield_now` を挟んで実時間に散らして emit する」は、comment が今回現物で確認した**（`query_service.rs` の `yield_now` / `next_request_id` の 1 始まり / `break` 後に必ず END）。r1 から4ラウンド「未検証」だったものが1つ埋まった
- 新しいテストのうち**変異を当てて確かめたのは3本だけ**（react）。`kifuCache` / `useOrderedPositionHits` / `appendOnly` / `PositionSearchContinuation` は読み合わせのみ
- `PositionSearchHitList` / `VirtualHitRow` / `lib/virtual/`（`main` 由来。行高の件は #479）
- SCSS・アクセシビリティ

## lint / hook で強制できるもの

- **R4-1 は型で止まる**（判別可能な結末）。走査は要らない
- **`@tauri-apps/api/*` の値 import を `entities/\*/api/**`に限る override**。R4-7 がこれで無意味になる。repo 全体で既に満たされていて、例外は`entities/analysis/model/provider.tsx` の1つだけ
- **union の分類表は `Record` で書く**（R4-8）。R3-3 で前例を作ったので、`switch` の `default:` が握り潰す形を型へ寄せられる
- **`commentHistory` の `REVIEW_TAG` に `r\d+-\d+` と `\([A-Z]-[A-Z]?\d+[^)]*\)` を足す**（R4-11）。**レビュー識別子の取りこぼしは2回目**なので two-strikes に当たる
- **`` `X`（path） `` の対の突き合わせ**。r1 / r2 / r3 / r4 と**4ラウンド続けて同じ形**（R4-4 が4件目）。走査の対象を `docs/` からコメントへ広げる必要がある
- **barrel の未使用 export を落とす走査**。r3 で4名落とした後も28名が未消費で、R4-7 の値7名はその中に埋もれていた。**同じ形が2ラウンド連続**

## 修正計画（r4 → r5）

### 対象そのものを疑ったか（**この段が今回の中心**）

**同じ機構が2ラウンド連続で新しい HIGH を生んでいる。**

| ラウンド | 入れたもの                                             | 次のラウンドで出た HIGH                                         |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| r2       | 起動の世代（`launchSeqRef`）を `.then` に置く          | R3-1: `.catch` / `.finally` が素通り                            |
| r3       | 溜め場の世代（`generation`）を `searchPosition` に置く | R4-1: 捨てた結末が呼び手に伝わらない／R4-3: 世代を進める第3の口 |

r3 の計画は「r4 でまた出るなら形ごと見直す」と書いた。**その条件に当たった。**

ただし受け皿として挙げた `useSearchSession`（`docs/IDEAS.md`）への全面移行は、この PR の範囲を大きく超える。
**代わりに、同じ故障の芽を型で塞ぐ**——「飛んでいる非同期が自分の番か」を
**呼び手が無視できない形**（判別可能な結末）にする。門を3つ目に足すのではなく、
門を通らなかったことが**返り値に出る**ようにすれば、`.then` / `.catch` / `.finally` の
どれで受けても分岐を書かない限り tsc が落ちる。

r5 でまだ「非同期の世代」に所見が出るなら、そのときは `useSearchSession` を実行する。

### このラウンドで直すもの

| 順  | 所見                                      | なぜこの順か                                     | この直し方で壊しうるもの                                                                                                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | R4-1 結末を型に出す                       | **利用者に見える誤り**、かつ機構の見直しそのもの | 返り値の型が変わるので `PositionSearchContextType` の署名と呼び手が動く。捨てた回に `cancelSearch` を足すぶん、正常な回で二重に投げないことを確かめる                          |
| 2   | R4-3 「捨てたら撃ち直す」を不変条件にする | R4-1 の後。同じ effect を触る                    | `lastQueryKeyRef` を `discardSearch` が落とすので、**閉じる枝の同じ代入が二重になる**。片方を消す。撃ち直しが増える経路（世代だけ進んだ回）が正しく1回だけになることを確かめる |
| 3   | R4-2 `.catch` のテストを効く形に          | 1・2 で挙動が変わるので、その後                  | 無し（テストの修正）                                                                                                                                                           |
| 4   | R4-6 `dropSearch` の scope を switch に   | 型で止める形。他より先                           | `never` 落ちを入れるので、union に足す人がここで止まる（狙い）                                                                                                                 |
| 5   | R4-8 `badgeForIndexState` を `Record` に  | 同上                                             | 見た目は変えない。分類だけ迫る                                                                                                                                                 |
| 6   | R4-7 barrel から `EVT_*` を落とす         | 構造                                             | スライス外の消費が0であることを確かめてから                                                                                                                                    |
| 7   | R4-4 `types.ts` の指し先                  | doc                                              | 無し                                                                                                                                                                           |
| 8   | R4-5 `RefusalReason` の doc               | doc                                              | 無し                                                                                                                                                                           |
| 9   | R4-9 `dead` の doc                        | doc                                              | 無し                                                                                                                                                                           |
| 10  | R4-10 barrel の doc                       | doc                                              | 無し                                                                                                                                                                           |
| 11  | R4-11 指す先の無いレビュー識別子          | doc                                              | 無し                                                                                                                                                                           |
| 12  | R4-12 `docs/IDEAS.md`                     | doc                                              | 無し                                                                                                                                                                           |

### 直さないもの

| 所見                                          | 行き先                          | 理由                                                                                               |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `useSearchSession` への全面移行               | **`docs/IDEAS.md`（記載済み）** | この PR の範囲を超える。R4-1 の型の修正で同じ故障の芽は塞がる                                      |
| `commentHistory` の `REVIEW_TAG` を広げる走査 | **`docs/IDEAS.md`**             | two-strikes には当たるが、走査の追加は #447 の範囲外。R4-11 は識別子を落とすことで今回の分は消える |
| `` `X`（path） `` の対の走査                  | **`docs/IDEAS.md`**             | 同上。4ラウンド続けて出ているので価値は高い                                                        |

### 次ラウンドの焦点

1. **R4-1 の型で、正常な検索が捨てられていないか。** `cancelSearch` が二重に飛ばないか
2. **R4-3 で撃ち直しが増えすぎていないか**（世代だけ進んだ回に1回だけ立つこと）
3. **R4-6 の `never` 落ちが、既存の2つの合図で正しく通ること**
4. **R4-7 で barrel から `EVT_*` を落とした後、スライス内の購読が壊れていないか**
5. **今回直した doc が、また別の場所で双子を作っていないか**（R4-4 は R3-2 の双子だった）
6. **変異を当てていないテスト4本**（`kifuCache` / `useOrderedPositionHits` / `appendOnly` /
   `PositionSearchContinuation`）が、別の理由で緑になっていないか

### 検証の見積り

12件 × `verify`（実測 60〜90秒）≒ **18分**。`docs/state-transitions/` は今回触らない。
