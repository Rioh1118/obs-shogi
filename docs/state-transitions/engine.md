# 状態遷移表: engine（L1）

対象: `src/entities/engine/model/provider.tsx` と `src/entities/engine/api/initializer.ts`、
および対応する Rust 側 `src-tauri/src/engine/analyzer.rs`（`start_engine` / `shutdown`）と
`src-tauri/src/engine/bridge.rs`。

上位は [app.md](app.md)。局面の送信は [engine-position-sync.md](engine-position-sync.md)、
解析セッションは [analysis.md](analysis.md) が持つ。

## 状態（フロントエンド）

| 記号   | 状態     | 判定                                                            |
| ------ | -------- | --------------------------------------------------------------- |
| **S0** | 未起動   | `phase === "idle"`、`activeRuntime === null`                    |
| **S1** | 起動中   | `phase === "initializing"`                                      |
| **S2** | 起動済み | `phase === "ready"`、`engineInfo !== null`                      |
| **S3** | 失敗     | `phase === "error"`、`error !== null`、`activeRuntime === null` |
| **S4** | 終了     | `phase === "exited"`、`activeRuntime === null`                  |
| **S5** | 応答なし | `phase === "unresponsive"`、`activeRuntime` は残る              |

`isReady` は S2 と同義ではない。`desiredRuntime` と `activeRuntime` の一致まで見る
（`provider.tsx`）。**設定を変えた直後は S2 のまま `isReady === false`。**

どの起動の結果を state に書くかは世代（`provider.tsx` の `lastRequestRef`）で決める。
`initialize` / `shutdown` を呼ぶたびに上がり、古い世代の結果は捨てる。

## 外部の状態（Rust プロセス）

**この列を忘れたことが issue #120 の BLOCK だった。** 必ず並べる。

| 記号   | 状態                             | 判定                                                                                   |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| **P0** | プロセス無し                     | `analyzer.engine_id === None`、`startup.cancel === None`                               |
| **P1** | 起動処理中                       | `startup.cancel === Some(_)`（`start_engine` が起動・`setoption`・`readyok` を待つ間） |
| **P2** | 生きている                       | `analyzer.engine_id === Some(_)`                                                       |
| **P3** | 生きているが解析セッションを保持 | `active_sessions` に席あり → [analysis.md](analysis.md)                                |

**P1 は Rust の側で取り消せる。** 起動中に `shutdown_engine`（`EngineAnalyzer::shutdown`）か
次の `start_analysis_engine` が来たら、起動中のプロセスも落として前の呼び出しを `cancelled` で
断る。`engine_id` に載せるのは世代が最新のときだけ（`analyzer.rs` の `Startup` と `publish`）。
踏んでいるテストは `analyzer.rs` の `tests::starting`。

P2・P3 の間の、1本のプロセスとのやりとり（名乗り、準備、探索、止め、閉じる）は、作り直しの後は状態機械が持つ。
状態と表は下の「目標の形」（Q0〜Q5）。

## イベント

| 記号    | イベント                                        | 発生源                                                   |
| ------- | ----------------------------------------------- | -------------------------------------------------------- |
| **E1**  | `desiredRuntime` が付く                         | プリセット選択（`EngineRuntimeGate`）                  |
| **E2**  | `desiredRuntime` が外れる                       | プリセット未選択に戻す                                   |
| **E3**  | `desiredRuntime` が**別の値に変わる**           | プリセット切替・プリセットの編集                         |
| **E4**  | `desiredRuntime` が**同じ値のまま再設定される** | `selectedPresetVersion` の更新                           |
| **E5**  | 起動が成功する                                  | `startAnalysisEngine` の resolve（`readyok` まで通った） |
| **E6**  | 起動が**失敗する**                              | 同 reject。種類つき（`StartFailure`。`asStartFailure`）  |
| **E7**  | 停止が成功する                                  | `shutdownEngine` の resolve                              |
| **E8**  | 停止が**失敗する**                              | 同 reject                                                |
| **E9**  | 「もう一度起動」を押す                          | 帯か操作列。**一部の種類にだけ出る**※7                   |
| **E10** | 「起動を中止」を押す                        | 起動中が `SLOW_START_MS` を越えると出る帯と操作列※8      |
| **E11** | プロセスが自分で終わる                          | Rust の `engine-exited`。番号が最後の起動のときだけ採る※9 |
| **E12** | 指示が通らなくなる                              | Rust の `engine-unresponsive`。番号は E11 と同じ※10       |
| **E13** | `stop` に遅れて答えが来る                       | Rust の `engine-answered`。番号は E11 と同じ※10           |

## 表

|           | E1 runtime が付く   | E2 runtime が外れる            | E3 別の runtime                         | E4 同じ runtime      | E5 起動成功 | E6 起動失敗     | E7 停止成功          | E8 停止失敗                                                                                    | E9 もう一度起動 | E10 起動を中止する                           |
| --------- | ------------------- | ------------------------------ | --------------------------------------- | -------------------- | ----------- | --------------- | -------------------- | ---------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| **S0/P0** | → S1 `initialize()` | —                              | → S1                                    | —                    | —           | —               | —                    | —                                                                                              | —               | —                                          |
| **S1/P1** | 何もしない          | → S0 `shutdown()`※1            | **待たずにその設定で `initialize()`**※2 | **起こし直さない**   | → S2/P2     | → S3/P0（種類） | → S0                 | → S0 だが **P が不明**※3                                                                       | —               | → S3（`cancelled`）。Rust の起動も落とす※8 |
| **S2/P2** | —                   | → S0 `shutdown()`              | → `restart()` = 停止してから起動        | **再起動しない**※4   | —           | —               | → S0/P0              | → S0 だが **P2 のまま**※3                                                                      | —               | —                                          |
| **S3/P0** | —                   | → S0 `shutdown()`              | → S1 再トライ※5                         | **再トライしない**※5 | —           | —               | → S0                 | → S0                                                                                           | → S1※7          | —                                          |
| **S2/P3** | —                   | 停止 → [analysis](analysis.md) | 再起動 → [analysis](analysis.md)        | —                    | —           | —               | セッションも止まる※6 | **席は空く**（`shutdown_engine_impl` が先に `stop_all_sessions` を通す）。プロセスは残りうる※3 | —               | —                                          |

### 注

※1 **停止は進行中の起動を待たない。** Rust が起動中のプロセスを落とし、その起動は `cancelled` で
断られる。断りは世代が古いので捨てる（`provider.tsx` の `lastRequestRef`）。待つ形だと、`readyok` を
返さないエンジンを選んだ回に停止ごと固まる。**停止の往復の間に次の起動を撃っていたら、停止の結果で
`idle` を書かない**（書くと `lifecycleStepOf` の `idle` の枝が同じ設定でもう1回起動する）。

**世代は Rust にも渡す**（`startAnalysisEngine` / `shutdownEngine` の `request`）。Tauri のコマンドは
別々のタスクで走るので、撃った順と Rust に着く順が逆転しうる。Rust は既に受けた番号より古い
要求を何もせずに断る（`analyzer.rs` の `Request`）ので、フロントが捨てた古い起動が新しい要求を
取り消すことは無い。

※2 起動中に別の設定になったら、前の起動の結果を待たずにその設定で起動し直す
（`lifecycleStepOf` の `initializing` の枝）。前の起動は Rust が落とし、前の呼び出しの
断り（`cancelled`）は世代が古いので捨てる。**進行中の起動を使い回す口は無い**——使い回すと、
前の設定の起動結果を新しい設定のものとして `activeRuntime` に書く。
踏んでいるのは `provider.test.tsx` の「起動中に設定が変わったら、その設定で起動し直す」。

※3 **停止が失敗しても `dispatch({ type: "shutdown" })` は `finally` で必ず走る**
（`provider.tsx`）。フロントは S0（未起動）になるが、Rust のプロセスは残りうる。
呼び出し元は `shutdown().catch(() => {})`（`provider.tsx`）なので**誰にも届かない**。
issue #120 と同型の行き止まり
→ [failure-surfacing.md](failure-surfacing.md) F-8

※4 `equalRuntime` が同値と判定すれば再起動しない（`provider.tsx`）。
ただし `engineKey` は `selectedPresetVersion` を含むので、
**プリセットを編集すると engineKey だけ変わってエンジンは再起動しない**組み合わせがある。
そのための「同じ engineKey での再起動」の扱いが
[engine-position-sync.md](engine-position-sync.md) の E3

※5 S3 では**同じ runtime なら自動では再トライしない**（`provider.tsx`）。
無限リトライを避けるため。**復帰は E3（設定を直す）か E9（もう一度起動）を通る**——失敗すると
`EngineFailureBridge` が種類ごとの帯を出し、「設定を開く」が設定のエンジン管理タブを開く
（そこからプリセットを編集する。行き先の一次記述は
[settings.md](../spec/screens/settings.md)）。直した設定は別の runtime になるので、
その場で起動し直す。

**「同じ runtime」はプリセットの同一性ではない**——見るのは `enginePath` /
`evalPath` / `book`（パスと解析で使うか）/ `values`（名前で。並びは見ない）（`entities/engine/lib/equalRuntime.ts`。
この判定がここの唯一の出典で、他の doc はここを指す）。だから**選択中のプリセットの
オプションを1つ変えて保存するだけでも起動し直す**——プリセットが1つしか無い利用者に
残っている道はこれだけ
→ [failure-surfacing.md](failure-surfacing.md) F-9

※6 `shutdown_engine_impl` は `stop_all_sessions()` を先に呼ぶ（`bridge.rs`）

※7 「もう一度起動」を出す種類は `entities/engine/lib/engineNotices.ts` の
`ENGINE_START_FAILURE_NOTICES` だけが持つ（決め方もその doc。ここに種類を写さない）。押すと
`useEngine().initialize()` を撃つ

※8 **`readyok` の待ちに上限は無い**ので、答えないエンジンでは起動中のまま進まない。起動中が
`SLOW_START_MS` を越えたら「時間が掛かっている」帯を出し、「起動を中止」（`useEngine().cancelStart()`）を
持たせる。やめると失敗（`cancelled`）として止まる——`idle` に戻すと、設定が選ばれたままなので
effect が同じ設定で起動し直す。起動し直すのは E3（設定を変える）か E9

※9 **S2 からだけ S4 へ入る。** こちらが落とした回（`quit` を送った後）は通知が出ない。
番号（`request`）が最後の起動のものでなければ捨てる。起動の応答より先に通知が着いたら、
応答を書いた直後に S4 へ入る（`provider.tsx` の `exitedRequestRef`）。

S4 の抜け方は S3 と同じ。**同じ設定のまま自動では起動しない**。E3 と E9 で S1 へ、E2 で S0 へ。

※10 **S2 からだけ S5 へ入り、E13 で S2 へ戻る。** S5 の間 `isReady` は false なので、局面の同期も
検討も止まる。Rust も `EngineAnalyzer::unanswered` が立っている間は `position` と `go` を断る。
S5 から落とすときは `quit` を待たない（`EngineRegistry::kill`）。抜け方は E3（別の設定）、E9、E2。
書けない回（理由 `unwritable`）は E13 が来ない。

## この表が満たすべき不変条件

1. **S2（起動済み）なら `activeRuntime` は実際に起動したプロセスの設定と一致する。**
   世代の古い起動の結果は書かない（※1 / ※2）
2. **フロントが S0 なら Rust 側も P0。** ※3 はこれを破る
3. **S3（失敗）から抜ける道が常にある。** 帯が設定へ送り、そこで `desiredRuntime` を
   前回試した値から動かせば E3 で起動し直す（※5。プリセットを選び直しても、
   選択中のものを編集してもよい）。設定の外を直した回のために、ほとんどの種類に E9 も出る（※7）
4. **S1（起動中）から抜ける道が常にある。** `readyok` を待つ上限は無いが、E10（※8）で止められる

## 埋まっていないセル

- `(S2, E8)` / `(S1, E8)` 停止の失敗（※3）。**Rust 側を落とす手段が無く踏めていない**
- `(S2, E2)` 起動済みからの停止の、フロントの側。Rust の側は `analyzer.rs` の `tests::starting` が踏む

**`entities/engine` のテスト**は `model/__tests__/provider.test.tsx`（`(S3, E4)` / `(S3, E3)` /
`(S1, E3)` / `(S1, E4)` / `(S1, E2)` の後の E1 / `(S1, E10)` / 呼ぶたびに上がる番号 / E11 と S4 の抜け方）、
`model/__tests__/notReadyReason.test.tsx`（`notReadyReason` の割り当て）と
`lib/__tests__/`（`asStartFailure`、`toOptionValues`、`equalRuntime`、`lifecycleStepOf`、`notReadyReasonOf`）。
`(S3, E9)` と E10 の帯は `app/providers/bridges/__tests__/engineFailureBridge.test.tsx`。
Rust の側の順序（古い番号の要求を断る）は `analyzer.rs` の `tests::starting`。

## 目標の形: 1本のプロセスの USI の状態（ADR-0016）

**ここから下は作り直しの後の形で、まだ実装は無い。** 上の表（フロントと `analyzer` の起動）は作り直しで変わらない。
変わるのは P の下にある、1本のプロセスとのやりとりの判定で、作り直しの後は状態機械 `UsiMachine` が1つで持つ。
段階の順と、どの段でこの表を純関数のテストにするかは ADR-0016 の決定8。

いまの実装では、この表の判定は `protocol.rs` の `ReadyState` と積み置き、呼び手の受け手の登録、
検討の `unanswered`、対局の `Activity` に散っている。各セルの「いま」の欄は、同じ振る舞いをどこが守っているかを書く。

入力の R1〜R9 は、U1 から `UsiProtocol` の手順として在る（名乗り `identify`、準備 `prepare`、値の確認 `check_value`、
新しい対局 `new_game`、探索 `search`、終局 `game_over`。R6〜R8 は `Search` の `ponderhit`、`stop`、`Drop`）。
中身はまだ上の散った判定の上に載っていて、検討と対局の探索は U2a・U2b まで手順を通らない。
R7 の答え（`StopAnswer`）は `protocol/search.rs` の2つの純関数が決め、全通りをテストが固定する。

### 状態

| 記号 | 状態 | 判定（作り直しの後の欄） |
| ---- | ---- | ---- |
| **Q0** | 名乗り前 | 起こした直後から、名乗り（`usiok`）が済むまで。名乗りの待ちが有るか無いかは問わない |
| **Q1** | 準備前 | 名乗り済みで、`readyok` がまだ。`isready` を送ったかは問わない |
| **Q2** | 待機 | `readyok` 済み、探索なし |
| **Q2c** | 値の確認中 | Q1 か Q2 で、値の確認の `usiok` を待っている。答えが来たら元の Q1 か Q2 へ戻る |
| **Q3** | 探索中 | 本番の探索1本が走っている（`bestmove` がまだ） |
| **Q3p** | 先読み中 | `go ponder` の探索1本が走っている |
| **Q4** | 止め待ち | 探索へ `stop` を書いたが `bestmove` がまだ。**待つ者が諦めても Q4 のまま**（ADR-0016 決定2） |
| **Q5** | 閉じた | 理由は `EngineEnd`（`Requested` / `Exited` / `Stalled`）。**吸収状態**で、`Requested` が他の理由より優先する |

P との関係: P2 と P3 の間、プロセスは Q2〜Q4 のどれか。P3（席あり）でも Q4 はありうる（止めに答えないまま席だけ返った回）。

### 入力

| 記号 | 入力 | 発生源 |
| ---- | ---- | ---- |
| **L1** | `id name` / `id author` | 読み取り |
| **L2** | `option` 行 | 読み取り（生の行から `option_line` が解く） |
| **L3** | `usiok` | 読み取り |
| **L4** | `readyok` | 読み取り |
| **L5** | `info`（`info string` を含む） | 読み取り |
| **L6** | `checkmate` | 読み取り |
| **L7** | `bestmove` | 読み取り |
| **L8** | 出力の終わり | 読み取り（stdout の EOF か読み取りの失敗） |
| **L9** | 解けない行 | 読み取り |
| **W1** | 書き込みが詰まった | 書き込みの列（`WRITE_TIMEOUT`） |
| **R1** | 名乗り | 手順 |
| **R2** | 準備（`setoption` を並べて `isready`） | 手順 |
| **R3** | 値の確認（`setoption` と `usi`） | 手順 |
| **R4** | 新しい対局（`usinewgame`） | 手順 |
| **R5** | 探索（`position` と `go`） | 手順 |
| **R6** | `ponderhit` | `Search` |
| **R7** | 止める | `Search` |
| **R8** | `Search` を止めずに捨てる | `Search` の `Drop` |
| **R9** | 終局（`gameover`） | 手順 |
| **R10** | `quit` | 落とす面（台帳） |
| **R11** | kill | 落とす面（台帳） |

### 表: 受けた行と書き込み

`—` は「何もしない（行は捨てる）」。「いま」は同じ振る舞いを踏むテストで、「U0:T*n*」は載せ替えの前に足すテスト（下の一覧）。
**状態機械のセルは、U3 でどれも純関数のテストになる。** ここの印が答えるのは、殻へ載せ替える前に実プロセスで踏めているかだけ。

|  | L1 id | L2 option | L3 usiok | L4 readyok | L5 info | L6 checkmate | L7 bestmove | L8 出力の終わり | L9 解けない行 | W1 詰まった |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Q0** | 名と作者を集める | 宣言に溜める（上限 `MAX_OPTIONS` と `MAX_DECLARED_BYTES`）。いま: `declared_options_are_kept_only_while_open` ほか純関数 | 名があれば名乗りを覚えて答え → Q1。名が無ければ断る（`NO_ID_NAME`）。U0:T9 | — | — | — | — | → Q5（`Exited`）。名乗りの待ちに「`usiok` の前に終わった」と直近の出力。いま: `a_startup_failure_carries_the_last_stderr_line` | 数を数えて間引いて記録し、読み続ける。いま: `an_overflowing_number_does_not_end_the_reading` | → Q5（`Stalled`） |
| **Q1** | — | —（宣言は閉じている）。いま: `option_lines_after_usiok_are_not_declared` | — | → Q2。準備の待ちに途中の `info string` を返す。いま: `a_start_returns_the_info_and_keeps_the_engine` | `info string` を準備の控えに足す。いま: `a_book_outside_the_vars_is_sent_as_a_path_only_when_it_is_accepted_and_read` | — | — | → Q5（`Exited`）。準備の待ちに「準備の前に終わった」と直近の出力 | Q0 と同じ | → Q5（`Stalled`） |
| **Q2** | — | — | — | — | — | — | 頼んでいない `bestmove`。捨てて記録する（**新**。いまは受け手が居れば配る） | → Q5（`Exited`）。終わりを知らせる。いま: `an_engine_that_exits_while_idle_is_reported` | Q0 と同じ | → Q5（`Stalled`）。いま: `an_engine_that_stops_reading_is_reported_as_unwritable` |
| **Q2c** | — | —（確認では宣言を作り直さない） | 確認の待ちに途中の `info string` を返す → 元の状態。いま: `a_book_outside_the_vars_is_sent_as_a_path_only_when_it_is_accepted_and_read` | — | `info string` を確認の控えに足す（`check_book_path_support` の判定）。いま: 同上 | — | — | → Q5（`Exited`）。確認の待ちに断りと直近の出力。いま: `an_engine_that_dies_during_the_path_check_fails_with_its_output` | Q0 と同じ | → Q5（`Stalled`） |
| **Q3** | — | — | — | — | その探索へ流す。いま: 検討は `bridge` の `endings`、対局は U0:T1 | その探索へ流す | その探索へ最後の行として流して閉じる → Q2。いま: `an_instant_bestmove_is_not_lost`、`a_search_the_engine_ended_itself_is_reported_and_frees_the_seat`。対局は U0:T1。時間と深度を決めた検討は U0:T7・T8 | → Q5（`Exited`）。探索を閉じる（受け手は終わりを見る）。いま: `an_engine_that_exits_during_a_search_is_reported_with_its_start`。対局は U0:T5 | Q0 と同じ | → Q5（`Stalled`）。探索を閉じる |
| **Q3p** | — | — | — | — | Q3 と同じ。U0:T3 | Q3 と同じ | Q3 と同じ（`ponderhit` の前に来た `bestmove` も同じ）。U0:T3 | Q3 と同じ。U0:T5 | Q0 と同じ | Q3 と同じ |
| **Q4** | — | — | — | — | 捨てる（止めた探索の行）。いま: 呼び手が捨てる（`the_answer_to_a_stop_is_not_a_completion`、対局は `is_current_search`） | 捨てる | 止めの待ちに「答えた」→ Q2。待つ者が諦めていたら「遅れて答えた」を知らせる。いま: `a_late_answer_lets_the_next_position_through`。対局は U0:T2 | → Q5（`Exited`）。止めの待ちに「届かない」。いま: 純関数（`waiting_for_bestmove_does_not_collapse_its_endings`） | Q0 と同じ | → Q5（`Stalled`） |
| **Q5** | — | — | — | — | — | — | — | —（理由は変えない。kill の後の終わりは `Requested` のまま）。いま: `an_engine_we_shut_down_is_not_reported` | — | — |

### 表: 頼まれたこと

「断る」はどれも `Err` を返し、書かない。Q5 の断りの文は理由で選ぶ（`cannot_reach_text` の優先順。いま: `who_stopped_the_engine_is_not_flattened_into_one_message`）。

|  | R1 名乗り | R2 準備 | R3 値の確認 | R4 新しい対局 | R5 探索 | R6 ponderhit | R7 止める | R8 捨てる | R9 終局 | R10 quit | R11 kill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Q0** | `usi` を書いて待つ。待ちが既に有れば同じ答えを待つ。いま: `concurrent_engine_info_requests_share_every_option` | 断る（名乗り前） | 断る | 断る | 断る | 断る | 止めるものが無い | — | 断る | 印を立てて `quit` を書く | → Q5（`Requested`）。待ちに全部 `Cancelled`、落とす。いま: `cancelling_while_waiting_for_usiok_leaves_nothing_starting`、`stopping_before_usiok_cancels_without_waiting_for_the_limit` |
| **Q1** | 覚えた名乗りを返す | `setoption` を並べ `isready` を書いて待つ。いま: `analyzer` の `starting` | `setoption` と `usi` を書く → Q2c。いま: `no_answer_to_the_path_check_switches_the_book_off_with_its_own_warning` | 断る（**新**。いまは `readyok` まで積む） | 断る（**新**。いまは積む） | 断る | 止めるものが無い（**新**。いまは積み置きの `go` を落とす `cancel_queued_go`） | — | 断る | Q0 と同じ | → Q5（`Requested`）。準備の待ちに `Cancelled`。いま: `stopping_while_loading_cancels_and_leaves_nothing` |
| **Q2** | 覚えた名乗りを返す | Q1 と同じ（**必ず** `isready` を送る） → Q1 | Q1 と同じ | `usinewgame` を書く。いま: `a_start_returns_the_info_and_keeps_the_engine` | `position` と `go` を書き `Search` を返す → Q3 か Q3p。いま: `bridge` の `endings`。対局は U0:T1 | 断る | 既に `bestmove` が来た探索なら「答えた」。それ以外は「止めるものが無い」 | — | `gameover` を書く。U0:T6 | Q0 と同じ。いま: `shutdown_sends_quit_before_ending_the_engine` | → Q5（`Requested`）、落とす。いま: `every_way_of_ending_ends_an_engine_that_ignores_quit` |
| **Q2c** | 覚えた名乗りを返す | 断る（確認の答え待ち。**新**） | 断る（**新**） | 断る（**新**） | 断る（**新**） | 断る | 止めるものが無い | — | 断る | Q0 と同じ | → Q5（`Requested`）。確認の待ちに `Cancelled` |
| **Q3** | 覚えた名乗りを返す | 断る（探索中の `setoption` と `isready` は USI が認めない。**新**） | 断る（**新**） | 断る（**新**） | 断る（2本目。**新**。いまは `bridge` の席と対局の `Activity` が守る） | 断る（本番の探索） | `stop` を書いて待つ → Q4。いま: `a_position_during_a_search_goes_out_only_after_the_stop`。対局は U0:T2 | `stop` を書く。待つ者は居ない → Q4（**新**。いまは対局の `Runner` の `Drop` が取り消しを撃つ）。U0:T10 | 断る（**新**。いまは対局が `Activity` で守る）。U0:T4 | Q0 と同じ | → Q5（`Requested`）、探索を閉じる。いま: `shutting_down_during_a_silent_search_ends_the_engine` |
| **Q3p** | Q3 と同じ | Q3 と同じ | Q3 と同じ | Q3 と同じ | Q3 と同じ | `ponderhit` を書く → Q3。U0:T3 | Q3 と同じ（外れた先読みを止める）。U0:T2 | Q3 と同じ | Q3 と同じ | Q0 と同じ | Q3 と同じ |
| **Q4** | 覚えた名乗りを返す | 断る | 断る | 断る | 断る（止めに答えていない）。いま: `an_engine_that_does_not_answer_stop_gets_no_next_position`（`refuse_if_unanswered`） | 断る | 同じ答えを待つ | — | 断る（探索中の `gameover` は USI 違反）。U0:T4 | Q0 と同じ | → Q5（`Requested`）、`quit` を待たずに落とす。いま: `restarting_an_unresponsive_engine_kills_it_without_quit` |
| **Q5** | 断る | 断る | 断る | 断る | 断る | 断る | 「届かない」 | — | 断る | — | 落とす（2回目は空振り）。理由は `Requested` に上がる。いま: `a_stuck_write_does_not_block_the_kill` |

### この状態機械が満たすべき不変条件

1. **書く行の順は、状態機械が出した順。** 殻は「書く」を出た順に書き込みの列へ入れ、その間に待ちを挟まない
2. **1本のプロセスで走る探索は高々1本で、`bestmove` は Q3・Q3p・Q4 の探索にだけ結び付く。** 次の探索の受け手が前の探索の行を受け取ることは無い
3. **Q3・Q3p・Q4 の間、`setoption` / `isready` / `usi` / `usinewgame` / `position` / `go` / `gameover` を書かない**
4. **待っている手順は必ず答えを受け取る。** 行で、出力の終わりで、詰まりで、kill で。待つ者が諦めた答えは殻が黙って捨てる
5. **Q5 は吸収状態で、理由は `Requested` が他より優先する**（いまの `next_ready_state` と `cannot_reach_text` の2つが持つ性質を1つにする。いま: `closed_absorbs_every_later_transition`）

### 載せ替えの前に要るテスト（U0）

上の表で「U0」の印が付いたセル。**どれも台本のエンジン（`child::script`）で踏む。** 足したら、守っている判定を壊す変異で落ちることを確かめる。

| 番号 | セル | 何を確かめるか | 置き場 |
| ---- | ---- | ---- | ---- |
| T1 | (Q3, L5) (Q3, L7) (Q2, R5) | 対局でエンジンの手番に `bestmove` が着手になる（`MoveDecided` から `AwaitingRuling`） | `game/session.rs` |
| T2 | (Q4, L7) (Q3p, R7) | 外れた先読みを止め、捨てる `bestmove` を着手に採らずに本番の `go` を出す | `game/session.rs` |
| T3 | (Q3p, R6) (Q3p, L7) | 先読みが当たったら `ponderhit` を書き、その `bestmove` を着手に採る | `game/session.rs` |
| T4 | (Q4, R9) (Q3, R9) | `stop` に答えないエンジンは `StopTimedOut` で終局し、`gameover` を書かない。止めの上限（5秒）を実際に待つ | `game/session.rs` |
| T5 | (Q3, L8) (Q3p, L8) | 探索中に終わったエンジンで、対局が `engineFailure` で終わる | `game/session.rs` |
| T6 | (Q2, R9) | 終局したら、探索していないエンジンへ `gameover` を書く | `game/session.rs` |
| T7 | (Q3, L7) | 時間を決めた検討が、上限を待たずにその探索の `bestmove` で結果を返す。前の探索の遅れた行を捨てる `drain_stale` は台本では踏めない（下） | `analyzer.rs` |
| T8 | (Q3, L5) (Q3, R7) | 深度を決めた検討が、目標に届いたら `stop` を書いて結果を返す | `analyzer.rs` |
| T9 | (Q0, L3) | `usiok` の前に `id name` が無いエンジンを `NO_ID_NAME` で断る | `protocol.rs` |
| T10 | (Q3, R8) | 探索中に取っ手を全部捨てると、プロセスが落ちる。いまは `dropping_the_protocol_while_waiting_for_readyok_ends_the_process` が Q1 だけを踏む | `protocol.rs` |

kill（R11）と値の確認（Q2c）は、いまのテストで足りている（表の「いま」）。U4 の後に同じテストが通ることを見る。

**`drain_stale` は実プロセスで踏めない。** 捨てるのは、受け手を張ってから `go` を書き終えるまでに届いた行だけで、
その窓は `analyze_with_time` の中で続けて走る2つの await の間しか無い。台本の側から、その窓に行を落とす手立てが無い。
窓の後に届いた前の探索の行は、`collect_until_bestmove` が区別せずに採る（コードを読んだ範囲。再現はしていない）。守っているのは純関数の `stale_output_is_dropped_before_collecting` だけ。
**作り直しで、`bestmove` を探索に結び付ける（不変条件2）ことでこの窓ごと無くなる。**

T4 は5秒を待つが `#[ignore]` にしない。載せ替えの番人なので、毎回走らないと意味が無い。

**「新」の印のセルは、いまの呼び手が踏まない経路で、作り直しで「積む・通す」から「断る」へ変わる**（ADR-0016 決定11）。
U3 で、呼び手が踏まないことを確かめてから入れる。U0 で固定しない——固定すると、変えると決めた振る舞いを番人にすることになる。
