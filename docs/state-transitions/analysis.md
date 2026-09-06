# 状態遷移表: analysis（L1）

対象: `src/entities/analysis/model/provider.tsx`、Rust 側 `src-tauri/src/engine/bridge.rs`。

上位は [app.md](app.md)。エンジンプロセスの生死は [engine.md](engine.md)、
局面の送信は [engine-position-sync.md](engine-position-sync.md) が持つ。

**この表は3つの状態機械をまたぐ。** フロントの解析状態・局面の同期状態・Rust のセッション。
issue #120 のラウンド3 BLOCK は、3つ目を列に入れ忘れたことで入った。

## 状態（フロントエンド）

| 記号   | 状態                 | 判定                                                                         |
| ------ | -------------------- | ---------------------------------------------------------------------------- |
| **S0** | 停止中               | `isAnalyzing === false`、`sessionId === null`                                |
| **S1** | 解析中・安定         | `isAnalyzing`、`lastAnalyzedSfenRef === currentSfen`、タイマ・in-flight なし |
| **S2** | 再開待ち（debounce） | `debounceTimerRef !== null`                                                  |
| **S3** | 同期待ち             | `syncWaitRef !== null`（`syncedSfen !== desiredSfenRef`）                    |
| **S4** | 再起動中             | `restartInFlightRef !== null`、`pendingAfterRef === false`                   |
| **S5** | 再起動中・次が保留   | `restartInFlightRef !== null`、`pendingAfterRef === true`                    |
| **S6** | エラー               | `error !== null`。**`isAnalyzing` は false になるが `sessionId` は残る**※1   |

## 外部の状態（Rust の解析セッション）

| 記号   | 状態           | 判定                                                                                |
| ------ | -------------- | ----------------------------------------------------------------------------------- |
| **P0** | セッション無し | `active_sessions` が空                                                              |
| **P1** | 解析中         | `active_sessions` に項目がある。この間 `take_session` は**必ず弾く**（`bridge.rs`） |

## イベント

| 記号    | イベント                             | 発生源                                                 |
| ------- | ------------------------------------ | ------------------------------------------------------ |
| **E1**  | 開始ボタン                           | `AnalysisPaneHeader` → `startInfiniteAnalysis()`       |
| **E2**  | 停止ボタン                           | 同 → `stopAnalysis()`                                  |
| **E3**  | 局面が変わる                         | 盤操作・棋譜ナビ（`currentSfen`）                      |
| **E4**  | 同期が追いつく                       | `syncedSfen === desiredSfenRef` になる                 |
| **E5**  | 同期がタイムアウトする               | 2000ms（`POSITION_SYNC_TIMEOUT_MS`）                   |
| **E6**  | エンジンが ready でなくなる          | → [engine.md](engine.md) E6/E7/E8                      |
| **E7**  | 結果が届く                           | Rust の `analysis-update`                              |
| **E8**  | 完了通知が届く                       | Rust の `analysis-complete`                            |
| **E9**  | エラー通知が届く                     | Rust の `analysis-error`                               |
| **E10** | `start_infinite_analysis` が失敗する | エンジンが応答しない・**セッションが残っている**       |
| **E11** | `stop_analysis` が失敗する           | 同上                                                   |
| **E12** | リスナの登録に失敗する               | `setupAnalysisEventListeners` の reject（起動時1回）   |
| **E13** | 画面が畳まれる                       | `RequireRootDir` の差し戻し（`RuntimeProviders` ごと） |

## 表

`—` は「そのイベントでは何も起きない／その状態には来ない」。

**S0/P1**（フロントは停止・Rust に席が在る）に入る口は2つ。開始の応答待ち
（席は Rust に在るが、フロントはまだ ID を受け取っていない）と、※7 の後
（停止に失敗したのにフロントだけ S0 になった）。

|           | E1 開始             | E2 停止                                             | E3 局面変化      | E4 同期完了 | E5 同期TO         | E6 not ready      | E7 結果           | E8 完了                | E9 エラー通知        | E10 開始失敗           | E11 停止失敗              | E12 リスナ登録失敗                             | E13 畳まれる                                          |
| --------- | ------------------- | --------------------------------------------------- | ---------------- | ----------- | ----------------- | ----------------- | ----------------- | ---------------------- | -------------------- | ---------------------- | ------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| **S0/P0** | 同期→開始※2         | `stop_analysis` を出さず state だけ落とす           | —                | —           | —                 | —                 | 捨てる※3          | —                      | → S6                 | → S0 のまま※4          | —                         | 結果が二度と届かないが画面には何も出ない → F-4 | —                                                     |
| **S0/P1** | **必ず失敗する**※11 | 握っていれば席を返す。応答待ちでは state だけ落とす | —                | —           | —                 | —                 | —                 | —                      | —                    | —                      | —                         | —                                              | 開始の応答待ちなら 席を返す※13。※7 の後は 席を返す※12 |
| **S1/P1** | 何もしない          | → S0/P0                                             | → S2             | —           | —                 | **→ S1 のまま**※5 | 80ms 間引きで反映 | → S0（**P は不明**）※6 | → S6/**P1 のまま**※1 | —                      | → S0 だが **P1 が残る**※7 | —                                              | 席を返す※12                                           |
| **S2/P1** | —                   | → S0 タイマ破棄                                     | 最新で上書き     | → S4 へ     | —                 | ※5                | 反映              | → S0                   | → S6                 | —                      | —                         | —                                              | 席を返す※12                                           |
| **S3/P1** | —                   | → S0                                                | 待ち対象を更新※8 | → S4 へ     | **停止して S6**※9 | ※5                | —                 | —                      | → S6                 | —                      | —                         | —                                              | 席を返す※12                                           |
| **S4/P1** | —                   | → S0※10                                             | → S5             | —           | —                 | ※5                | —                 | —                      | → S6                 | → S6 + `stop_analysis` | —                         | —                                              | 席を返す※12・※13                                      |
| **S5/P1** | —                   | → S0※10                                             | 最新で上書き     | —           | —                 | ※5                | —                 | —                      | → S6                 | → S6                   | —                         | —                                              | 席を返す※12・※13                                      |
| **S6/P0** | 再開できる          | —                                                   | —                | —           | —                 | —                 | —                 | —                      | —                    | —                      | —                         | —                                              | —                                                     |
| **S6/P1** | **必ず失敗する**※11 | —                                                   | —                | —           | —                 | —                 | —                 | —                      | —                    | —                      | —                         | —                                              | 席を返す※12                                           |

### 注

※1 `set_error` は `isAnalyzing: false` にするが **`sessionId` を残す**（`reducer.ts`）。
`stop_analysis` を続けて撃たない経路（E9 の `onError`、`provider.tsx`）では
**フロントが「停止」、Rust に席が残ったまま**になる。以降 E1 は※11 に落ちる

※2 `startInfiniteAnalysis` は `syncPosition()` → `waitUntil(syncedSfen === currentSfen, 2000)`
→ `startInfiniteAnalysisCore()` の順（`provider.tsx`）。
`isReady` でなければ `throw new Error("Engine not ready")`

※3 `flushLatest` が `analyzingRef.current` を見て捨てる（`provider.tsx`）

※4 `startInfiniteAnalysis` の throw は `AnalysisPaneHeader` の `console.error` で終わる。
**押しても何も起きない。** 同期タイムアウトのときだけ `set_error` が飛ぶが、その `error` の読み手が0
→ [failure-surfacing.md](failure-surfacing.md) F-6 / F-2

※5 **`isReady` が false になっても解析は止まらない。** 自動再開の effect が
`if (!isReady) return` で黙って抜けるだけ（`provider.tsx`）。
`isAnalyzing` は true のまま、結果だけが来なくなる。
**「解析中」の表示のまま何も更新されない**状態が残る → **未検証**

※6 `onComplete` は `stop_analysis` を dispatch するが、Rust 側でセッションが
片付いているかはイベントの契約に依存する。**表で追えていない**

※7 `stopAnalysis` は `finally` で必ず `stop_analysis` を dispatch する（`provider.tsx`）。
`stopAnalysisCore` が reject してもフロントは S0 になる。**issue #120 の再発経路**
→ [failure-surfacing.md](failure-surfacing.md) F-7

※8 `syncWaitRef` は `{seq, want, startedAt}` を持つ。
**時刻だけを持つと前回の経過時間を引き継いで即座に打ち切る**ため（`provider.tsx`）

※9 タイムアウト時は `stopAnalysisCore` を撃ってから `set_error` + `stop_analysis`
（`provider.tsx`）。**ここは P を片付けている。**
`.catch(() => {})` が付いているが、直後に `set_error` が飛ぶので握り潰しではない

※10 `stopAnalysis` は `restartSeqRef` を上げる。in-flight の再開は、開始の応答が
返った行で世代を見て、違っていれば `start_analysis` を dispatch せずに**その席を返す**
（`provider.tsx`）。見ないと、止めたはずの解析が画面でも Rust でも走り直す。
停止ボタンが撃てるのはその時点で握っている席までなので、後から返る席はそこでしか返せない。

※11 `take_session` が `Err("Analysis already running")` を返す（`engine/bridge.rs`）。

**席が在るかどうかしか見ない。** `AnalysisSession` は「解析中か」を表す欄を持たない
（持たせると、偽を書く口を誰も通らないまま定数になる）。席が在ること自体が
「走っている」で、終わったら項目ごと消える。

空ける口を数え上げない（数えると、口を1つ足したときに嘘になる）。追うときは
`active_sessions` への write を全部見ること。

**どの口も通らないまま席が残ると、エンジンを再起動するまで解析が二度と始まらない。**
これが #120 の BLOCK の形。席を返す側が不変条件を破る経路は → #365

※12 アンマウントの cleanup が `stopAnalysisCore()` を**セッションを指さずに**撃つ
（`provider.tsx` の `releaseSeatOnUnmount`）。Rust は `stop_all_sessions` に落ちて
`active_sessions` を空にする。指さないのは、握っている ID が席の主とずれる経路が
在るため——停止が落ちて握り続けた回と、完了通知の ID が一致しなかった回。
指した上で別の席が居ると `stop_session` は照合して断り、**席は残る**。

**撃つかどうかは「席を握っているか」だけで決める**（`seatRef`）。Rust が席を渡した
行で握り、返せたときだけ手放す。`isAnalyzing` や `sessionId` から導いてはいけない
——あれを書くのは commit の後の effect なので、開始の応答が返った直後に畳まれた回は
空のまま残り、席が在るのに「無い」と読む。
**停止が落ちたときは手放さない**ので、※7 の経路（フロントだけ S0）で畳んでも返しにいける。
StrictMode の setup → cleanup → setup では握っていないので撃たない。

※13 開始の応答を待っている間に畳まれた回。畳んだときの一括停止（※12）と
`take_session` はどちらの順にもなり、一括停止が先に届けばその席は残る。
順序に頼らず、応答が返った側でも `unmountedRef` を見て `stop_analysis` を撃つ
（`provider.tsx`）。手動開始（E1）の窓では ※12 の門が閉じている——まだ席を
握っていない——ので、返せるのはここだけ。E2（停止ボタン）で同じ窓に入る経路も
同じ行で塞いである（※10）。

## この表が満たすべき不変条件

1. **フロントが S0（停止中）なら Rust も P0。** ※1・※7 がこれを破る
2. **`isAnalyzing` が true なら、結果がいつか届くか、エラーが出るか、利用者が止められる。**
   ※5 はこれを破る（何も届かないまま「解析中」が続く）
3. **S6（エラー）から抜ける道が常にある。** ※11 の状態では E1 が必ず失敗するので破れている
4. **表示している候補手は、盤面の局面に対するもの。**
   `waitUntil` と `syncWaitRef` はこれを守るためにある
5. **画面が消えたら Rust も P0。** 席の持ち主はこの provider だけで、
   畳まれた後は誰も返せない。※12・※13 がこれを守る。
   **※6 では破れる**——完了通知で席を手放した後に Rust 側が片付けていなければ、
   畳んでも撃たない（手放した以上、席が在ることを知る者が居ない）

## 埋まっていないセル

`src/entities/analysis/model/__tests__/provider.test.tsx` が踏んでいるセル以外。
特に:

- **`(S1〜S5, E6)` エンジンが ready でなくなる（※5）。** 全行にまたがる未検証
- **`(S6/P1, E1)` セッションが残った状態での再開（※11）。** #120 の BLOCK そのものだが、
  Rust 側に席を残したままフロントを S6 にする再現手段がテストに無い
- `(S1, E11)` / `(S4, E10)` 停止・開始の失敗（※7）
- `(S0, E12)` リスナ登録の失敗。**踏むと解析結果が二度と届かないが、画面には何も出ない**
  → [failure-surfacing.md](failure-surfacing.md) F-4

いずれも実装上は経路があるが、**テストは無い**。
