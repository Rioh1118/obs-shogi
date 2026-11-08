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
状態と表は下の「1本のプロセスの USI の状態」（Q0〜Q5）。

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

## 1本のプロセスの USI の状態（ADR-0016）

上の表（フロントと `analyzer` の起動）の P の下にある、1本のプロセスとのやりとりの判定。**U3 から状態機械
`UsiMachine`（`src-tauri/src/engine/usi_machine.rs`）が1つで持つ。** 時計も IO も持たず、U4 からアクター
（`protocol.rs` の `run_actor`。タスク1本）がそれを持って、入力を着いた順に渡し、出たこと（`Effect`）を出た順に行う。
アクターの側の経路は下の「アクターとハンドル」。段階の順は ADR-0016 の決定8。

入力の R1〜R9 は `UsiProtocol` の手順（名乗り `identify`、準備 `prepare`、値の確認 `check_value`、
新しい対局 `new_game`、探索 `search`、終局 `game_over`）と、`Search` の `ponderhit`、`stop`、`Drop`。
R10・R11 は`EngineShutdown`の `quit` と `kill_engine`。待つ上限は手順が持ち、状態機械は持たない（決定2）。

**表の全セルは、列ごとに1本の純関数のテストが固定する**（各表の「テスト」の行。どれも `usi_machine.rs` の `tests`）。
1本のテストが8つの行（Q0〜Q5）を全部作り、1つの入力を当てて、出たことと着いた状態を行ごとに突き合わせる。
セルの「台本:」は、同じ経路を実プロセス（台本のエンジン）で踏むテスト。

### 状態

| 記号 | 状態 | 判定（`usi_machine.rs` の `State` と `Naming`） |
| ---- | ---- | ---- |
| **Q0** | 名乗り前 | `Unready` で、名乗りが済んでいない（`Naming::Collecting`）。起こした直後はここ |
| **Q1** | 準備前 | `Unready` で、名乗り済み。`isready` を送ったか（準備の札があるか）は問わない |
| **Q2** | 待機 | `Idle` |
| **Q2c** | 値の確認中 | `Checking`。Q1 か Q2 から入り、値の確認の `usiok` を待つ。答えが来たら元の Q1 か Q2 へ戻る |
| **Q3** | 探索中 | `Searching`（`ponder` が偽）。本番の探索1本が走っている（`bestmove` がまだ） |
| **Q3p** | 先読み中 | `Searching`（`ponder` が真）。`go ponder` の探索1本が走っている |
| **Q4** | 止め待ち | `Stopping`。探索へ `stop` を書いたが `bestmove` がまだ。**待つ者が諦めても Q4 のまま**（ADR-0016 決定2） |
| **Q5** | 閉じた | `Closed`。理由は `EngineEnd`（`Requested` / `Exited` / `Stalled`）。**吸収状態**で、`Requested` が他の理由より優先する |

**名乗りは準備と別に進む**（`Naming`）。名乗らずに準備するエンジン（`usi` に答えない台本）も準備でき、探索できる。
そのエンジンは Q2〜Q4 でも名乗り前の印を持ち、名乗りを頼まれると、Q2 なら `usi` を書き、Q2c なら確認の `usiok` を待ち、
Q3・Q3p・Q4 なら断る（不変条件3）。`id` と `option` 行を集めるのは、名乗り前の間ずっと（どの行でも）。

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
| **R10** | `quit` | `EngineShutdown`（台帳） |
| **R11** | kill | `EngineShutdown`（台帳） |

### 表: 受けた行と書き込み

`—` は「何もしない（行は捨てる）」。

|  | L1 id | L2 option | L3 usiok | L4 readyok | L5 info | L6 checkmate | L7 bestmove | L8 出力の終わり | L9 解けない行 | W1 詰まった |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Q0** | 名と作者を集める | 宣言に溜める（上限 `MAX_OPTIONS` と `MAX_DECLARED_BYTES`。`declared.rs` の `declared_options_are_kept_only_while_open` ほか） | 名があれば名乗りを覚えて答え → Q1。名が無ければ断り（`NO_ID_NAME`）、Q0 のまま集め直す。台本: `an_engine_without_a_name_is_refused_with_no_id_name` | 準備の札が無ければ —。あれば Q1 と同じ | — | — | — | → Q5（`Exited`）。名乗りの待ちに「`usiok` の前に終わった」。台本: `a_startup_failure_carries_the_last_stderr_line` | —（数えて間引いて記録するのは `protocol.rs` の読み取り。時計が要る）。台本: `an_overflowing_number_does_not_end_the_reading` | → Q5（`Stalled`） |
| **Q1** | — | —（宣言は閉じている）。台本: `option_lines_after_usiok_are_not_declared` | — | 準備の札があれば、全部に途中の `info string` を答え → Q2。無ければ —。台本: `a_start_returns_the_info_and_keeps_the_engine` | `info string` を準備の控えに足す。台本: `a_book_outside_the_vars_is_sent_as_a_path_only_when_it_is_accepted_and_read` | — | — | → Q5（`Exited`）。準備の待ちに「準備の前に終わった」 | Q0 と同じ | → Q5（`Stalled`） |
| **Q2** | — | — | — | — | — | — | 頼んでいない `bestmove`。捨てて記録する | → Q5（`Exited`）。台本: `an_engine_that_exits_while_idle_is_reported` | Q0 と同じ | → Q5（`Stalled`）。台本: `an_engine_that_stops_reading_is_reported_as_unwritable` |
| **Q2c** | — | —（確認では宣言を作り直さない） | 確認の待ちに途中の `info string` を答える → 元の状態 | — | `info string` を確認の控えに足す（`check_book_path_support` の判定） | — | — | → Q5（`Exited`）。確認の待ちに断り。台本: `an_engine_that_dies_during_the_path_check_fails_with_its_output` | Q0 と同じ | → Q5（`Stalled`） |
| **Q3** | — | — | — | — | その探索へ流す。台本: 検討は `bridge` の `endings`、対局は U0:T1 | その探索へ流す。台本: `a_checkmate_line_is_passed_on` | その探索へ最後の行として流して閉じる → Q2。台本: `an_instant_bestmove_is_not_lost`、対局は U0:T1、検討は U0:T7・T8 | → Q5（`Exited`）。探索を閉じる（受け手は届かない理由を受ける）。台本: `an_engine_that_exits_during_a_search_is_reported_with_its_start`、対局は U0:T5 | Q0 と同じ | → Q5（`Stalled`）。探索を閉じる |
| **Q3p** | — | — | — | — | Q3 と同じ。U0:T3 | Q3 と同じ | Q3 と同じ（`ponderhit` の前に来た `bestmove` も同じ）。U0:T3 | Q3 と同じ。U0:T5 | Q0 と同じ | Q3 と同じ |
| **Q4** | — | — | — | — | 捨てる（止めた探索の行） | 捨てる | 止めの待ちに全部「答えた」→ Q2。待つ者が諦めていれば、答えは `LateAnswer` が受ける。台本: `a_late_answer_can_be_waited_for_and_holds_back_the_next_search`、対局は U0:T2 | → Q5（`Exited`）。止めの待ちに「届かない」。台本: `an_engine_that_exits_on_stop_is_unreachable` | Q0 と同じ | → Q5（`Stalled`）。止めの待ちに「詰まった」 |
| **Q5** | — | — | — | — | — | — | — | —（理由は変えない。kill の後の終わりは `Requested` のまま）。台本: `an_engine_we_shut_down_is_not_reported` | — | —（理由は変えない） |
| **テスト** | `an_id_line_is_collected_only_before_usiok` | `an_option_line_is_declared_only_before_usiok` | `usiok_answers_the_one_who_asked` | `readyok_answers_only_a_prepare`、`a_readyok_nobody_asked_for_changes_nothing` | `an_info_line_goes_to_whoever_is_waiting_for_it` | `a_checkmate_line_goes_only_to_a_running_search` | `a_bestmove_ends_only_the_search_it_belongs_to` | `the_end_of_the_output_answers_everyone_waiting` | `an_unreadable_line_changes_nothing` | `a_stalled_write_closes_with_its_own_reason` |

### 表: 頼まれたこと

「断る」はどれも `Err` を返し、書かない。Q5 の断りの文は理由で選ぶ（`usi_machine.rs` の `closed_error`。
`who_stopped_the_engine_is_not_flattened_into_one_message`）。

|  | R1 名乗り | R2 準備 | R3 値の確認 | R4 新しい対局 | R5 探索 | R6 ponderhit | R7 止める | R8 捨てる | R9 終局 | R10 quit | R11 kill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Q0** | `usi` を書いて待つ。待ちが既に有れば書かずに同じ答えを待つ。台本: `concurrent_engine_info_requests_share_every_option` | Q1 と同じ。名乗りは待たない（Q0 のまま `readyok` を待つ）。台本: `search.rs` の `ready` を使う全部 | Q1 と同じ → Q2c | 断る | 断る | 断る | 答えた（走っていない探索は `bestmove` で終わっている） | — | 断る | 印を立てて `quit` を書く | → Q5（`Requested`）。待ちに全部 `Cancelled`、落とす。台本: `cancelling_while_waiting_for_usiok_leaves_nothing_starting`、`stopping_before_usiok_cancels_without_waiting_for_the_limit` |
| **Q1** | 覚えた名乗りを返す | `setoption` を並べ `isready` を書いて待つ（Q1 のまま）。待ちが既に有れば、次の `readyok` で全部に答える | `setoption` と `usi` を書く → Q2c。台本: `no_answer_to_the_path_check_switches_the_book_off_with_its_own_warning` | 断る（`readyok` の前は積まない。ADR-0016 決定3） | 断る（決定3） | 断る | 答えた | — | 断る | Q0 と同じ | → Q5（`Requested`）。準備の待ちに `Cancelled`。台本: `stopping_while_loading_cancels_and_leaves_nothing` |
| **Q2** | 覚えた名乗りを返す。名乗らずに準備したなら `usi` を書いて待つ | Q1 と同じ（**必ず** `isready` を送る） → Q1 | Q1 と同じ | `usinewgame` を書く。台本: `a_start_returns_the_info_and_keeps_the_engine` | `position` と `go` を書き `Search` を返す → Q3 か Q3p。台本: `bridge` の `endings`、対局は U0:T1 | 断る | 答えた。台本: `lines_come_in_order_and_end_at_bestmove` | — | `gameover` を書く。U0:T6 | Q0 と同じ。台本: `shutdown_sends_quit_before_ending_the_engine` | → Q5（`Requested`）、落とす。台本: `every_way_of_ending_ends_an_engine_that_ignores_quit` |
| **Q2c** | 覚えた名乗りを返す。名乗り前なら、確認の `usiok` で答える | 確認を諦めたと答え（`Cancelled`）、Q1 と同じ → Q1。台本: `no_answer_to_the_path_check_switches_the_book_off_with_its_own_warning` | 断る | 断る | 断る | 断る | 答えた | — | 断る | Q0 と同じ | → Q5（`Requested`）。確認の待ちに `Cancelled` |
| **Q3** | 覚えた名乗りを返す。名乗り前なら断る（`usi` を書けない） | 断る（探索中の `setoption` と `isready` は USI が認めない） | 断る | 断る | 断る（2本目。手順「探索」は前の探索の終わりを待ってから頼む） | 断る（本番の探索） | `stop` を書いて待つ → Q4。番号が違えば答えた。台本: `a_stopped_search_answers`、対局は U0:T2 | `stop` だけを書く。待つ者は居ない → Q4。台本: `dropping_a_search_writes_stop`、U0:T10 | 断る。U0:T4 | Q0 と同じ | → Q5（`Requested`）、探索を閉じる。台本: `shutting_down_during_a_silent_search_ends_the_engine` |
| **Q3p** | Q3 と同じ | Q3 と同じ | Q3 と同じ | Q3 と同じ | Q3 と同じ | `ponderhit` を書く → Q3。台本: `only_a_ponder_search_takes_ponderhit`、U0:T3 | Q3 と同じ（外れた先読みを止める）。U0:T2 | Q3 と同じ | Q3 と同じ | Q0 と同じ | Q3 と同じ |
| **Q4** | Q3 と同じ | 断る | 断る | 断る | 断る（止めに答えていない）。台本: `a_search_started_after_a_dropped_one_does_not_take_its_bestmove`、`an_engine_that_does_not_answer_stop_gets_no_next_position` | 断る | 同じ答えを待つ（書かない） | — | 断る（探索中の `gameover` は USI 違反）。U0:T4 | Q0 と同じ | → Q5（`Requested`）。止めの待ちに「届かない」、落とす。台本: `restarting_an_unresponsive_engine_kills_it_without_quit` |
| **Q5** | 断る。名乗る前に閉じたなら、名乗りの待ちが受けた断りと同じ（終わった回は「`usiok` の前に終わった」、落とした回は `Cancelled`） | 断る | 断る | 断る | 断る | 断る | 「届かない」 | — | 断る | — | 落とす（2回目は空振り）。理由は `Requested` に上がる。台本: `a_stuck_write_does_not_block_the_kill` |
| **テスト** | `identify_writes_usi_once_and_then_remembers`、`identify_after_an_early_exit_says_it_ended_before_usiok`、`naming_runs_beside_the_preparation` | `prepare_always_writes_isready` | `check_value_is_asked_only_before_a_search` | `new_game_is_written_only_when_idle` | `a_search_starts_only_when_idle` | `ponderhit_is_only_for_the_ponder_search_that_is_running` | `a_stop_waits_only_for_the_search_it_names` | `a_dropped_search_writes_stop_and_waits_for_nobody` | `game_over_is_written_only_when_idle` | `quit_marks_the_end_as_ours` | `a_kill_answers_everyone_and_then_kills` |

**R7 に「止めるものが無い」は無い。** 探索は `bestmove` か閉じることでしか終わらないので、走っていない探索は
答え済み（`StopAnswer::Answered`）。U2b までの「止めるものが無かった」（積み置きの `go` を落とした回）は、
積み置きが無くなって起きなくなった。

### この状態機械が満たすべき不変条件

1. **書く行の順は、状態機械が出した順。** アクターは出た書き込みを、状態機械を動かしたのと同じ処理の中で
   書き込みの列へ入れ、その間に待ちを挟まない（`protocol.rs` の `UsiActor::step`。同期で await 点を持たない）。
   並びは各列のテストが出たことの順で見る
2. **1本のプロセスで走る探索は高々1本で、`bestmove` は Q3・Q3p・Q4 の探索にだけ結び付く。** 次の探索の受け手が前の探索の行を
   受け取ることは無い（`a_bestmove_ends_only_the_search_it_belongs_to`、`a_dropped_search_writes_stop_and_waits_for_nobody`）
3. **Q3・Q3p・Q4 の間、`setoption` / `isready` / `usi` / `usinewgame` / `position` / `go` / `gameover` を書かない**
   （`nothing_but_stop_ponderhit_and_quit_is_written_during_a_search`）
4. **待っている手順は必ず答えを受け取る。** 行で、出力の終わりで、詰まりで、kill で。待つ者が諦めた答えは持ち主が黙って捨てる
   （`the_end_of_the_output_answers_everyone_waiting`、`a_stalled_write_closes_with_its_own_reason`、`a_kill_answers_everyone_and_then_kills`）
5. **Q5 は吸収状態で、理由は `Requested` が他より優先する**（`closed_absorbs_every_later_input`、`who_stopped_the_engine_is_not_flattened_into_one_message`）

### アクターとハンドル（U4）

アクター（`run_actor`）は、状態機械と札の送り先と子プロセスを持つタスク1本。入力は1本の列（`Input`）で着く:
ハンドルの頼みごと（R1〜R11）、読み取りの行と出力の終わり（L1〜L9。`start_reading`）、書き込みの詰まり（W1。`run_writer`）。
**処理（`UsiActor::handle`）は同期で、await 点を持たない。** ハンドルは2つの型に分かれる（ADR-0016 決定6）。

| ハンドル | できること | 持つ者 | アクターを生かすか |
| ---- | ---- | ---- | ---- |
| `UsiProtocol` | 手順、終わりの見張り、直近の出力 | 呼び手（`analyzer`、`game`、`probe`）、`Search` | 生かす |
| `EngineShutdown` | `quit`、kill | 台帳（`registry`）だけ | 生かす |
| `EngineEndWatch`、`LateAnswer` | 終わりを待つ、遅れた答えを待つ | 呼び手 | 生かさない（状態の写しだけを持つ） |
| 読み取り、書き込みの列 | 行と終わり、詰まりをアクターへ送る | アクターが起こしたタスク | 生かさない（weak で持つ） |

アクターの側で、状態機械の表に載らない経路:

| 経路 | どうなるか | テスト |
| ---- | ---- | ---- |
| ハンドルを全部捨てた | 列が閉じてアクターが終わる。終わる前に R11 を渡し（待ちに `Cancelled`、閉じた理由は `Requested`）、子プロセスはアクターと一緒に落ちる | `dropping_the_protocol_ends_the_process`、`dropping_the_protocol_while_waiting_for_readyok_ends_the_process`、U0:T10 |
| `LateAnswer` を持ったままハンドルを全部捨てた | 上と同じ。`LateAnswer` は落とした理由（`GONE`）で返る | `a_late_answer_does_not_keep_a_dropped_engine_alive` |
| 手順「探索」を、アクターの答えを受け取る前に捨てた | `Search` はアクターが状態機械へ頼んだ直後に作る（`UsiActor::start_search`）。受け取り手が居なければアクターの手元か答えの中で落ち、その `Drop` が R8 を頼む | `a_search_dropped_while_writing_does_not_hold_the_engine` |
| kill を見届ける間（`KILL_TIMEOUT`）の頼み | アクターは落とすよう頼むだけ（`EngineChild::start_kill`）で、見届けるのは頼んだ側（`EngineShutdown::kill_engine`）。アクターは次の頼みに Q5 の断りを返す | `stopping_before_usiok_cancels_without_waiting_for_the_limit`。待たないことは `UsiActor::handle` が同期であることで決まる |
| 書き込みの詰まり（W1） | 書き込みの列は、詰まった書き込みに答える**前に**アクターへ知らせる。答えを受けた手順は、アクターが閉じたのを写しで見てから返る（`Handle::finish`。上限 `CLOSED_SEEN_LIMIT`）。返った後の頼みと届かない理由は、閉じた状態を見る | `a_stalled_write_is_seen_as_stalled_as_soon_as_it_returns`、`an_engine_that_stops_reading_is_reported_as_unwritable`、`a_stuck_write_does_not_block_the_kill` |
| 探索中に閉じた（kill、出力の終わり、詰まり） | アクターは探索の送り手を落とし、閉じた写しを書く。行の途切れを見た `Search::next_line` は、閉じた写しを見てから届かない理由を組む（`Handle::closed_reason`）。順の約束に頼らない | `a_search_cut_by_the_kill_says_we_stopped_it` |
| 出力の終わりと書き込みの詰まりが重なった | 列に着いた順に渡す。先に着いたほうで閉じ、後のほうは Q5 の — （理由は変えない） | `closed_absorbs_every_later_input`（状態機械） |
| 出力の終わり | 読み取りの送り手（`Reading`）が落ちるときに、行の後に送る。読み取りの終わり方を数え上げない | `an_instant_bestmove_is_not_lost` |

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
| T7 | (Q3, L7) | 時間を決めた検討が、上限を待たずにその探索の `bestmove` で結果を返す | `analyzer.rs` |
| T8 | (Q3, L5) (Q3, R7) | 深度を決めた検討が、目標に届いたら `stop` を書いて結果を返す | `analyzer.rs` |
| T9 | (Q0, L3) | `usiok` の前に `id name` が無いエンジンを `NO_ID_NAME` で断る | `protocol.rs` |
| T10 | (Q3, R8) | 探索中にハンドルを全部捨てると、プロセスが落ちる。いまは `dropping_the_protocol_while_waiting_for_readyok_ends_the_process` が Q1 だけを踏む | `protocol.rs` |

kill（R11）と値の確認（Q2c）は、台本のテストで足りている（表の「台本:」）。U4 の後に同じテストが通ることを見る。

**前の探索の遅れた行は、U3 から状態機械の Q4 で防ぐ。** 止め待ちの間は次の探索を断り、手順「探索」（`UsiProtocol::search`）は
前の探索が終わるのを上限（`PREVIOUS_SEARCH_LIMIT`）まで待ってから頼む（`a_search_started_after_a_dropped_one_does_not_take_its_bestmove`）。
止めに上限まで答えなかった探索も、`LateAnswer` を捨てたかに関わらず、遅れた `bestmove` が来るまで次の探索を始めない。

T4 は5秒を待つが `#[ignore]` にしない。載せ替えの番人なので、毎回走らないと意味が無い。

**U3 で「積む・通す」から「断る」へ変えたセル**（ADR-0016 決定11）: `readyok` の前の R4・R5（決定3）、探索中と止め待ちの
R2〜R5・R9、待機中の頼んでいない L7（捨てて記録する）。どれも、いまの呼び手が踏まないことを確かめてから入れた（PR の本文）。
