# 状態遷移表: game-session（L1）

対象: `src-tauri/src/engine/game/session.rs`（状態機械）、`search.rs`（1回の `go`）、
`clock.rs`（持ち時間）、`manager.rs`（台帳）、`events.rs`（出来事の宛先）、
`src-tauri/src/engine/commands/game.rs`（Tauri コマンド）。
エンジンの出力を読む側は `src-tauri/src/engine/protocol.rs`。

上位は [app.md](app.md)。エンジンプロセスの生死は [engine.md](engine.md)、
棋譜側のカーソルと分岐計画は [game.md](game.md) が持つ。
**[game.md](game.md) とは別物。** あちらは「棋譜を読む・辿る・編集する」で、
こちらは「対局が進む」。同じ `game` で始まるが状態機械は交わらない。

## 責任の切れ目

**Rust はここで将棋のルールを持たない。**

合法手と成りの判定は**既にフロントにある**
（`src/entities/game/lib/shogiMoveValidator.ts`、shogi.js）。盤の表示
（移動可能マスの強調・成り選択）にも要るので消せず、Rust に重ねると
合法手判定が2実装になる。ルールをフロント側に寄せるのはそのため。

**詰み・千日手・持将棋・最大手数の判定は、まだどちらにも無い** → #354。
`shogiMoveValidator.ts` が持つのは合法手と成りだけで（`isLegalMove` から
`getLegalMovesWithPromotionOptions` まで）、`src/` を
`千日手|repetition|持将棋|jishogi|最大手数` で引いても当たるのは
`entities/kifu/model/jkf.ts` の**棋譜の特殊手の文字列定数**だけ。

その帰結として、**Rust は手が決まっても次の `go` を自分では出せない**。
指した後の局面が終局かどうかを知る手立てを持たないため。`AwaitingRuling` で
止まり、フロントの裁定（`continue_game` / `end_by_rule`）を待つ。

**#354 が入るまで、この表の `end_by_rule` の列は「呼ばれる口があるだけ」で、
呼ぶ側が存在しない。**

**指し手列の権威はフロント。** Rust の `Runner.moves` は `go` を組むための写しで、
`continue_game` が毎手上書きする。書き込むのは `start`（`initial_moves`）と
`accept_continue` の2箇所だけ（不変条件6）。

## 状態（Rust セッション）

`session.rs` の `Phase`。

| 記号   | 状態                                                    | 判定                                       |
| ------ | ------------------------------------------------------- | ------------------------------------------ |
| **G0** | `side` の着手待ち。**時計は動くとは限らない**（下の 3） | `Phase::Thinking { side }`                 |
| **G1** | 手が決まり、裁定待ち。**時計は止まる**                  | `Phase::AwaitingRuling { last_mover, .. }` |
| **G2** | 終局                                                    | `Phase::Over { result }`                   |

`G1` の `since` から `RULING_TIMEOUT`で中断する。
時計が止まっているので、この打ち切りが対局者の持ち時間を削ることはない。

## 外部の状態（エンジンプロセス）

外部プロセスの状態を列に入れる理由は [engine.md](engine.md)。
`Player.activity` を先後それぞれが持つ。

| 記号   | 状態                                     | 判定                                                         |
| ------ | ---------------------------------------- | ------------------------------------------------------------ |
| **A0** | 何もしていない                           | `Activity::Idle`                                             |
| **A1** | 本番の思考中                             | `Activity::Searching { kind: SearchKind::Search, .. }`       |
| **A2** | 先読み中                                 | `Activity::Searching { kind: SearchKind::Ponder { m }, .. }` |
| **A3** | 止めた。**この結果は採らない**           | `Activity::Stopping { req, restart }`                        |
| **A4** | 止めたのに応答しない。**探索中とみなす** | `Activity::Unresponsive`                                     |

**「走っている探索をどう扱うか」はこの enum が全部持つ。**
別のフラグと併せ持たないこと。持つと「立てる場所」と「読む場所」が割れ、
どちらか一方しか見ない枝ができる。

人間側の `activity` は常に `A0`（`engine` が `None` なので `spawn_search` を通らない）。

## イベント

| 記号    | イベント                       | 発生源                                                                                         |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| **E1**  | `submit_move(side, mv)`        | 人間の着手（フロントが合法性を確かめてから呼ぶ）                                               |
| **E2**  | `continue_game(moves)`         | 裁定「続く」                                                                                   |
| **E3**  | `end_by_rule(winner, detail)`  | 裁定「終局」（詰み・千日手・持将棋・最大手数・反則）                                           |
| **E4**  | `resign(side)`                 | 人間の投了                                                                                     |
| **E5**  | `abort()`                      | 利用者の中断                                                                                   |
| **E6**  | `close()`                      | 対局を閉じてエンジンを落とす                                                                   |
| **E7**  | `bestmove <手>`                | `SearchOutcome::Move`                                                                          |
| **E8**  | `bestmove resign`              | `SearchOutcome::Resign`                                                                        |
| **E9**  | `bestmove win`（入玉宣言）     | `SearchOutcome::DeclareWin`                                                                    |
| **E10** | エンジンの出力が終わった       | `SearchOutcome::Failed`。発生源は `protocol.rs` の EOF 検出※9                                  |
| **E11** | 打ち切りに応じた `bestmove`    | `SearchOutcome::StoppedCleanly`（`GameOverReason::Aborted` とは別物）                          |
| **E12** | **`stop` に応じない**          | `SearchOutcome::StopTimedOut`。`SEARCH_STOP_GRACE`超過か、書き込みが `WRITE_TIMEOUT`で返らない |
| **E13** | `info`                         | `SearchMessage::Info`                                                                          |
| **E14** | tick: 手番側の時計が尽きた     | `on_tick` の `has_expired`                                                                     |
| **E15** | tick: 裁定が返らない           | `on_tick` の `RULING_TIMEOUT`                                                                  |
| **E17** | tick: 畳み待ちが長すぎる       | `on_tick` の `SETTLE_TIMEOUT`                                                                  |
| **E18** | 思考が長すぎる                 | `on_tick` の `stalled_turn`。**3つの締切のどれか**（※12）                                      |
| **E16** | 世代の合わない `SearchOutcome` | `req` が `activity` のものと違う                                                               |

**E7〜E12 は「そのとき `activity` が何だったか」で意味が変わる。**
`A1` / `A2` なら採る候補、`A3` なら捨てる、それ以外なら世代違い（E16）。

## 表

`—` はそのイベントがその状態で起きないか、状態が変わらないもの。
`Err` は呼び出し側に文字列を返して状態を変えないこと。

テスト列の意味: `✓` そのセルを固定するテストがある / `△` 一部の列だけ /
`✗` 未検証（実装上は経路があるが、踏むテストが無い）。

| イベント                              | G0 思考中                                                                  | G1 裁定待ち                           | G2 終局                      | テスト |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------- | ---------------------------- | ------ |
| **E1** 人間の着手                     | 手番かつ人間なら → G1※1。手番でない／エンジン側／形が壊れた手は `Err`      | `Err` "not waiting for a move"        | `Err`                        | △※10   |
| **E2** 裁定「続く」                   | `Err` "not awaiting a ruling"                                              | 検算を通れば → G0※2。落ちたら `Err`※3 | `Err`                        | △※10   |
| **E3** 裁定「終局」                   | → G2（`reason: Rule`）                                                     | → G2                                  | `Err` "game is already over" | △※10   |
| **E4** 人間の投了                     | → G2（`winner` は相手）。エンジン側を指定したら `Err`                      | → G2                                  | `Err`                        | △※10   |
| **E5** 中断                           | → G2（`reason: Aborted`、`winner: None`）                                  | → G2                                  | 何もしない。`Ok`             | △※10   |
| **E6** 閉じる                         | E5 を通し、**探索が畳まれるのを待ってから**エンジンを落とす※4              | 同左                                  | 同左                         | ✗      |
| **E7** `A1` からの `bestmove`         | 形が通れば → G1※1。通らなければ → G2（`EngineFailure`）                    | 起きない※5                            | `gameover` を送って `A0`※6   | △※10   |
| **E7'** `A2` / `A3` からの `bestmove` | **採らない。** `A0` に落とし、`A3` で `restart` なら `go` を出し直す※7     | 採らない                              | 同左※6                       | △※10   |
| **E8** `bestmove resign`              | `A1` からなら → G2。`A2` / `A3` からは採らない                             | 採らない                              | 同左※6                       | ✓※10   |
| **E9** `bestmove win`                 | `A1` からなら → G2（`winner` は自分）。他は採らない                        | 採らない                              | 同左※6                       | ✗      |
| **E10** 出力が終わった                | → G2（`EngineFailure`、`winner` は相手）。**採る採らないに関わらず**       | 同左                                  | 同左※6                       | ✗      |
| **E11** 打ち切りの `bestmove`         | `A3` の `restart` が立っていて手番側なら `go` を出し直す※7。他は何もしない | 何もしない                            | 同左※6                       | ✗      |
| **E12** `stop` に応じない             | → G2（`EngineFailure`）。**その側は `A4` になり `gameover` を送らない**※6  | 同左                                  | 同左                         | △※10   |
| **E13** `info`                        | 手番側のものだけ流す※8                                                     | 流さない※8                            | 流さない                     | ✗      |
| **E14** 時計が尽きた                  | 成立するなら → G2（`Timeout`）※11                                          | 起きない（時計が止まっている）        | —                            | ✓※10   |
| **E15** 裁定が返らない                | —                                                                          | → G2（`Aborted`、`detail` 付き）      | —                            | ✗      |
| **E17** 畳み待ちが長すぎる            | → G2（`EngineFailure`）                                                    | 起きない（畳み待ちは `G0` だけ）      | —                            | ✓      |
| **E18** 思考が長すぎる                | ※12 の締切に当たれば → G2（`EngineFailure`）                               | 起きない                              | —                            | △      |
| **E16** 世代違い                      | 捨てる                                                                     | 捨てる                                | 捨てる                       | ✗      |

### 注

※1 `decide_move`。**時計を締めてから** `G1` へ入る（`running_clock()` は
`G0` の間しか値を返さないので、順序が逆だと 0 になる）。締めた結果が時間切れで、かつ
その側の時間切れが成立するなら（※11）、裁定を待たずに直接 `G2`（`Timeout`）へ落とし、
`MoveDecided` も出さない。**その手は指されなかったものとして扱う。**

※2 `accept_continue`。渡された `moves` で `Runner.moves` を上書きし、`G0` へ。
その中で `hand_turn_to` が相手側の `activity` を見て `Handover` の4値に振り分ける。

| `activity`              | 判定            | すること                                                                                                                                                                                                        |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A2` で先読みの手が一致 | `PonderHit`     | `ponderhit` を送り `A2` → `A1`。**エンジンはそのまま考え続け、時計はここから動く**（先読みの時間は無料）。**送信に失敗したら `StopThenStart` へ倒す**（送れていないのに「考えている」ことにすると時計だけ進む） |
| `A2` で一致しない       | `StopThenStart` | 打ち切って `A3 { restart: true }` へ                                                                                                                                                                            |
| `A1`                    | `StopThenStart` | **手番でない側が本番の思考をしている＝組み立てを間違えている。** `A0` と同じ扱いにすると探索中のエンジンへ `go` を送ることになるので、止めてから始め直す。`warn` を出す                                         |
| `A3`                    | `StopThenStart` | 既に止めてある。`restart` を立てるだけ                                                                                                                                                                          |
| `A4`                    | `Unusable`      | 止めたのに応答しないエンジンには渡せない。→ G2（`EngineFailure`）                                                                                                                                               |
| `A0`                    | `StartNow`      | その場で `go`                                                                                                                                                                                                   |

指した側は、裁定が通ってから先読みへ入る（`start_ponder`）。
**裁定の前に始めないのは、指せない手の上で読ませないため。**

※3 `accept_continue` の検算は3つ。`moves` の末尾が直前に決まった手であること、
`moves.len()` の偶奇が次の手番と合うこと、各手の形が通ること。
**権威はフロントだが、受け取ったものが直前の手の続きであることは確かめる。**
確かめないと、食い違いに気付く経路がどこにも無くなる。
落ちると `G1` のまま留まるので、フロントが直さなければ E15（`RULING_TIMEOUT`）で中断される。

※4 `GameSession::close` は「止める（`CLOSE_ABORT_TIMEOUT`） →
**畳まれるのを待つ**（`CLOSE_IDLE_TIMEOUT`） → 落とす」の順。
**上限は別枠。** 1つの予算を分け合うと、止めるのに使ったぶんだけ畳み待ちが縮む。
**この表は秒数を書かない**（定数を動かすと嘘になる）。値は定数名で指し、
大小関係は `the_watchdogs_are_ordered` が式で固定する。畳み待ちが畳みの最悪値より
長いことは `the_watchdogs_are_ordered` が固定する。
待たずに落とすと、`stop` を送ろうとしている探索の足元で
プロセスが消え、**正常に閉じただけで毎回「エンジンが応答しない」のログが出る**。
`A4` は待っても返らないと分かっているので、畳まれたものとして数える。

上限を置くのは、書き込みが詰まると `close_game` が無期限に返らないため。
**超えたら、畳めていなくても落とす**（警告を1行残す）。落とす側にも上限があり
（`protocol.rs` の `KILL_TIMEOUT`）、そちらを超えるとプロセスが残る。

エンジンへの書き込みは**1本の列**を通る（`protocol.rs` の `run_writer`）。
投入順がそのままワイヤ上の順になり、上限（`WRITE_TIMEOUT`）もそこ1箇所。
**掛かるのは列へ入ったものだけ。** `readyok` 待ちや掃きの最中に積まれたコマンド
（`dispatch_for` の `Queue`）はまだ列に入っていないので、この上限の外にある。
そちらを見張るのは `READY_TIMEOUT` と `on_tick` の見張り。

**これらの上限が効くのは、書き込みが `spawn_blocking` の中にあるから。**
async のタスクの中で同期 write を直に呼ぶと `poll` が返らず、
`timeout` は発火する機会そのものを持たない。

なお `GameManager::close` は `Arc::try_unwrap` が通らないと、中断だけ通して
セッションを**台帳へ戻し** `Err` を返す。戻すのは、手掛かりを残さずに
エンジンだけが残るのを避けるため。次の `close_game` か `close_all` で落とせる。

アプリを閉じるときは `lib.rs` が `close_all` → `shutdown_all` を呼ぶ。
**`RunEvent` を2つとも受ける。** macOS の Cmd+Q は `NSApp terminate:` で
`ExitRequested` を出さず、届くのは `Exit` だけ（ウィンドウの × は逆）。

上限は2つに分けてある（`CLOSE_TIMEOUT` / `SWEEP_TIMEOUT`）。
1つで包むと、対局を閉じるのに使い切ったときに掃除の future が1度も poll されず、
**解析用エンジンは掃除からしか届かない**ので必ず残る。

`CLOSE_TIMEOUT` を超えても掃除が拾う。プロセスが残るのは `SWEEP_TIMEOUT` か
`KILL_TIMEOUT` を超えたときだけ（→ 台帳の F-25）。

※5 `G1` に入るのは手番側の探索が終わった直後なので、その側は既に `A0`。

※6 `gameover` を送る口は2つあり、**側の状態で分かれる**。

- **探索中だった側**（`A1`〜`A3`）: `finish` の時点では送らない。探索中のエンジンへ
  送るのはプロトコル違反なので、`bestmove` が返って `A0` になるまで待つ。
  送るのは `on_search_outcome` の `Phase::Over` の枝
- **`finish` の時点で `A0` だった側**: `finish` がその場で送る（`idle_sides`）。
  人対人や、両者が `A0` で終局した対局では**これが唯一の送信経路**。
  消すと、探索していないエンジンに `gameover` が永久に届かない
  （`on_search_outcome` は `bestmove` が返らない限り呼ばれない）

**`A4` には送らない。** `stop` に応じないエンジンは探索中とみなしているので、
`finish` の `idle_sides` にも入らない。その代償として、そのエンジンは
`close_game` まで探索したまま残る。

※7 `A3` の結果は着手として採らない。止めた探索の答えは**別の局面に対するもの**で、
いまの局面では非合法になりうる。採ると `MoveDecided` に載り、フロントが反則として
終局させるので、**エンジンが身に覚えのない負けを負う**。
`restart` が立っていて手番側なら、`go` を出し直す前に**時計を引き直す**
（畳んでいた `SEARCH_STOP_GRACE` ぶんを、1手も読んでいないエンジンの消費にしないため。
その間はどちらの持ち時間にも入らない）。

※8 `info` を落とすのは `on_search_info` の `is_to_move` **1本だけ**。
先読み中の側は手番ではないので、手番が変わった後に届いたものと同じ判定で落ちる。

**`search.rs` では間引かない。** 探索タスクは起動時の値を握ったまま走るので、
`ponderhit` で本番へ昇格したことを観測できない。間引くと、先読みが当たった手番だけ
読み筋が1行も出なくなる（当たる率はエンジンが強いほど高い）。

**この1行がいま守っている唯一のもの。** 冗長と読んで消すと、相手の手番中の
先読みが画面に出る。**間引きは1段も無い** → 埋まっていないセル。

※9 E10 の発生源は `protocol.rs::start_listening` の転送タスク。
`line_tx` が落ちた時点で `listeners` を全部落とし、待っている側へ「もう来ない」を
届ける。**読み取りの終わり方は1つではない**（EOF は hook が拾うが、
読み取り自体の `Err`＝非 UTF-8 の行や数値のパース失敗では `usi` crate が
hook を呼ばずにスレッドを抜ける）。どの終わり方でも `line_tx` は落ちるので、
そこ1箇所で全部を拾う。同じ場所で `ready` にも `Closed` を立てる
（そうしないと `ensure_ready` が `READY_TIMEOUT` まで待つ）。

※10 **踏めているのは先後とも人間の1局と、`Runner` を直に組んだ単体のみ。**
`spawn_players` は人間側を飛ばすので、その設定なら**エンジンを1つも起動せずに
状態機械を通せる**。`Runner` はテストと同じモジュールにあるので、
`activity` を好きな状態にして `on_search_outcome` を直接呼べる。

**`△` が意味するのは「`G0` 列だけ固定している」。**

`(G2, E7)`（終局後に届いた `bestmove`）は
`a_bestmove_after_the_game_ended_still_gets_a_gameover` が `Phase::Over` を置いて
踏んでいる。**ただし表明は `activity` が `A0` に戻ることだけ。** `gameover` が
実際に飛ぶことは見ていない——`send_gameover` の宛先が `UsiProtocol` の具象で、
観測する継ぎ目が無いため。`Phase::Over` の早期 return を `match` より後ろへ
動かしても、`activity` の代入はその手前にあるので落ちない。
**つまりセルは踏んでいるが、不変条件3 は依然として守られていない。**

`(G2, E7')` `(G2, E8)` `(G2, E12)` は踏めていない。`(G2, E8)` を名乗るテストは
`Phase::Thinking` から始まるので、実際に踏んでいるのは `(G0, E8)`
（その固有の価値は※6 の順序——`Over` の emit が `send_gameover` より先——であって、
セルではない）。

出来事の宛先は trait なので観測できる（`game::events` の `RecordedEvents`）。
残っているのは**エンジンへ送ったコマンド**を観測する継ぎ目。

`△` は「その行のうち人間で踏める列だけ」の意。E1 の `is_engine` の枝と
`(G2, E1)` は踏めていない。

※12 `Thinking` の番人は `stalled_turn` 1本。締切は3つあり、どれかに当たれば落とす。

1. `Settling` が `SETTLE_TIMEOUT` を超えた（畳み待ちが長すぎる → E17）。
   **これだけは対局者の種別に関わらず見る**（止めた探索の話なので）
2. `Running` が持ち時間＋`HARD_TURN_LIMIT` を超えた。**喋っていても落とす**
3. `Running` が `SEARCH_GRACE` を超え、**かつ**その間 `info` が1行も来ていない。
   **ここは持ち時間を見ない**——黙っているかどうかは持ち時間と無関係の信号で、
   足すと、持ち時間が長い対局で初手から固まったエンジンが持ち時間ぶん検出されない

**2 と 3 は手番側がエンジンのときだけ。** 人間は長考しても「応答しない」ではないし、
`info` を出さないので沈黙条件は常に満たされる。掛けると、30分切れ負けで11分考えた
人間が残り19分あるのに `EngineFailure` で負ける。人間の手番を締めるのは時計。

**2 は持ち時間に足す。** 絶対の値にすると、持ち時間の長い対局で時計より先に
発火する（60分の持ち時間で15分の長考が故障扱いになる）。

**2 と 3 は両方要る。** 3 だけだと、`info` を出しながら `bestmove` を返さない
エンジンに上限が1つも残らない（`enforce_engine_timeout` は既定で偽なので
時間切れも掛からず、探索タスクにも締切が無い）。3 の沈黙条件が無いと、
時計が尽きた側の `budget_ms` は 0 に張り付くので、正常に読んでいるエンジンが
`SEARCH_GRACE` ちょうどで「応答しない」と呼ばれる。

**`last_progress` は2箇所で進む。** `begin_turn`（手番の開始）と
`on_search_info`（手番側からの `info`）。どちらも消せない。

**探索タスクの中には置かない。** あのタスクは起動時の値を握ったまま走るので、
`ponderhit` で先読みから本番へ昇格したことを観測できない。`on_tick` は
`TurnClock` を毎回読み直すので、昇格した手番も同じ番人が覆う。

`on_tick` から終局させると `Activity` は `Searching` のままなので、
`finish` の `idle_sides` に入らない＝**探索中のエンジンへ `gameover` を送らない**
（不変条件3）。打ち切りは `cancel` を通って探索タスクへ届き、
そちらが `stop` を出す。

どちらの枝も `enforce_engine_timeout` を見ない。時間切れ負けではなく、
**黙ったエンジンを見つける**ためにある。

※11 `timeout_enforced`。**エンジンの時間切れは既定で成立しない**
（`GameSettings.enforce_engine_timeout` の既定が false）。この打ち切りが
当たるのはたいてい GUI 側の取りこぼしだから
（→ `research/shogihome/02-game.md` の `enableEngineTimeout` も既定 false）。
人間の時間切れは常に成立する。

## 1回の `go`（`search.rs`）

`go` **ごとに**リスナーを作り、終わったら外す。使い回すと、打ち切った探索の
`bestmove` が次の探索のものとして届く。

| 相  | 何をしているか                                                                   |
| --- | -------------------------------------------------------------------------------- |
| 1   | `position` → `go` を送り、`bestmove` か打ち切りのどちらかを待つ                  |
| 2   | 打ち切られたなら `stop` を送り、捨てる `bestmove` を `SEARCH_STOP_GRACE`まで待つ |

第2相の終わり方は、`stop` で返る**3つ**と、書けた後の**3つ**。
潰すと、落ちたエンジンに「stop に応じなかった」という説明が付く。

`stop` の側（`outcome_of_stop`）。ここで返ると `bestmove` を待たない。

| `stop` の結果     | 意味                                   | `SearchOutcome`  |
| ----------------- | -------------------------------------- | ---------------- |
| `CancelledQueued` | **まだ書かれていない `go` を落とした** | `StoppedCleanly` |
| `Timeout`         | **stdin を読んでいない**               | `StopTimedOut`   |
| その他の `Err`    | **送る口が無い**                       | `Failed`         |

書けたら（`Written`）待ちへ進み、その終わり方が3つ（`outcome_after_stop`）。

| 待ちの結果          | 意味                 | `SearchOutcome`  |
| ------------------- | -------------------- | ---------------- |
| `bestmove` を受けた | 打ち切りに応じた     | `StoppedCleanly` |
| チャンネルが閉じた  | **プロセスが落ちた** | `Failed`         |
| 待ち切れなかった    | **まだ探索中**       | `StopTimedOut`   |

## 時計

**減っていく値ではなく、尽きる時刻を渡す**（`GameClocks::view`）。

減る値を渡すと、滑らかに見せたい側がそれを自分で減らすことになり、
「持ち時間を使い切ってから秒読みが減り始める」という規則が**境界の両側に生える**。
時刻なら受け手は `deadline - now` をクランプするだけで済み、その規則は Rust から出ない。

**Rust の中では3箇所にある。** 表示側が `GameClocks::view`、消費と時間切れの
判定側が `SideClock::budget_ms` と `SideClock::consume`。
`SideClock::has_expired` は `budget_ms` に委譲しているので数に入らない。
1つだけ変えると、画面に秒読みが残っているのに時間切れになる。

```
ClocksView {
  black / white: { mainMs, byoyomiMs }        // 止まっている値
  running: { side, mainZeroAt, byoyomiZeroAt } | null
}
```

`running` が `null` になるのは**4つ**。`G1` と `G2` に加えて、
**`G0` でも `null` になりうる**。

1. `G1`（裁定待ち）
2. `G2`（終局後）
3. **`G0` で `turn_clock` が `Settling`**（前の探索の畳み待ち。`go` をまだ出していない）
4. **壁時計が epoch より前**（`clocks_view` が `now_epoch_ms` を取れない）

**3 が起きるのは、渡す先に畳む探索があったときだけ。** 先読みが外れた、
手番でない側が本番の思考をしていた、既に止めてある——`Handover::StopThenStart`
に落ちる場合。`StartNow` と `PonderHit` は emit より前に `begin_turn` を通るので、
`TurnChanged` は `running` を載せて飛ぶ。`ponder` の既定は偽なので、
**既定の設定では 3 は起きない。**

受け手は `running` の有無で分岐すること。**`null` を「対局が止まった」と
読まないこと。** 逆に「毎手 `null` が来る」と決め打つと、`running` を捨てて
次の `ClockUpdated`（最短 `CLOCK_EMIT_INTERVAL`）まで期限を持たないことになる。

時刻を出さないことで、受け手が減らす余地そのものを消している。

送っている時刻は壁時計で、**表示のためだけ**。時間切れの判定は単調時計
（`Instant`）で測るので、壁時計が飛んでも狂うのは表示だけで、次の更新で入れ直る。

消費時間は Rust が測って `MoveDecided.elapsed_ms` で渡し、フロントが棋譜に残す。
**測るのと残すので持ち主が違う。** 対局が終われば Rust 側の時計は消えるので、
永続的な持ち主は棋譜＝フロント。中断からの再開に必要な「残り時間の持ち込み口」は
まだ無い → #358。

## この表が満たすべき不変条件

1. **`G0` の間、本番の `go`（`A1`）が出ているのは手番側のエンジンだけ。**
   相手側は `A0` / `A2` / `A3` / `A4`。破れると、手番でない側の `bestmove` を
   着手として採る。`hand_turn_to` は `A1` を見つけたら `warn` を出し、
   **`A0` と同じ扱いにせず止めてから始め直す**（※2）。
   `spawn_search` も `A0` でなければ `debug_assert` で止まる。

2. **1つの `go` に対して着手として採る `bestmove` は高々1つ。**

   守っているのは2つ。
   1. **`A3` の結果を採らない**（`on_search_outcome` の `accept`）
   2. **捨てる `bestmove` を受け取れなかったら、次の `go` を出さずに終局する**（E12）

   **「リスナーが `go` ごとだから古いものは届かない」は根拠にならない。**
   `run_search` は戻る直前にリスナーを外すので、遅れて届いた `bestmove` は
   **次の探索のリスナー**が受け取り、`req` も一致する。窓を狭めるだけで閉じない。
   届いた先の世代照合だけでも防げない。

3. **`G2` に入ったら、全エンジンに `gameover` が届く。ただし `A4` を除く。**
   探索中だったエンジンには `bestmove` が返ってから送る（※6）。
   `A4` は探索中とみなしているので送らない。

4. **時計が動くのは `G0` かつ `turn_clock` が `Running` のときだけ。**
   守っているのは `running_clock()` 1本。`Phase::Thinking` と
   `TurnClock::Running` の両方が揃わなければ `None` を返す。
   呼ぶ側（`on_tick` / `clocks_view` / `decide_move` / `finish`）はこれを通すだけで、
   **独立した番人ではない。** ここの `Phase` 判定を「到達しない枝」と読んで
   消すと、`snapshot` と `finish` が終局後も動いている時計を出す。

5. **`close_game` を呼ぶまでエンジンプロセスは落ちない。** 終局は落とさない
   （`gameover` の後に `usinewgame` で指し直せる形にしてあるため）。
   **アプリが動いている間は、呼び忘れるとプロセスが残る。** これはフロント側の契約。
   終了時は `lib.rs` の `close_all` → `shutdown_all` が拾う（※4）。

6. **`Runner.moves` を書くのは `start` と `accept_continue` の2箇所だけ。**
   権威はフロントにあり、Rust は写しを持つ。

7. **対局を捨てたら、走っているタスクも終わる。**
   `Runner` と `tick_loop` と探索の転送タスクは weak sender で持ち、
   `Runner` の `Drop` が走っている探索を cancel する
   （`CancellationToken` は drop では cancel しない）。

## 埋まっていないセル

**エンジンが絡むセルのうち、実プロセスを要するものは1つも固定できていない。**
`EngineRegistry::spawn` が `UsiEngineHandler::spawn` を直に呼んで実行ファイルを
起動する作りなので、**プロセスを差し替える口が無い**。

固定できているのは、人間だけで踏める経路（※10）と、`Runner` を直に組んで
`activity` を置いた単体。`manager.rs` と `commands/game.rs` にはテストが無い。

とくに危ないもの:

| セル                                               | 状態                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A4` になったエンジンの後始末                      | 探索したまま `close_game` まで残る。**`gameover` も届かない。** プロセスを落とすのは `close_game` と、終了時の `close_all` → `shutdown_all`                                                                                                                  |
| `GameManager::close` の `Arc::try_unwrap` 失敗     | 中断だけ通して台帳へ戻り `Err` が返る（※4）。終了時は `close_all` が拾うが、**画面から呼び直す導線が無い**（対局 UI が未着手）                                                                                                                               |
| `(G0, E13)` `info` の間引き                        | Rust は対局も解析も1行ごとに `emit` する。間引きは**受け手側**にあり、解析は `entities/analysis` の provider が持つ（`RESULT_FLUSH_MS`）。対局は受け手そのものが無い。**`run_loop` は単一キューなので、`emit` が詰まると `bestmove` の処理がその後ろに並ぶ** |
| `(G0, E10)` 出力が終わった                         | 実プロセスを落とす手段がテストに無い                                                                                                                                                                                                                         |
| `(G1, E15)` 裁定が返らない                         | `RULING_TIMEOUT` で中断する。**踏んだことが無い**                                                                                                                                                                                                            |
| `ponderhit` の当たり／外れ                         | ※2 の6分岐のうち踏めているのは `A0` の1つ。`A1` / `A3` / `A4` は `Runner` を直に組めば実プロセス無しで踏めるのに未検証。実機が要るのは `A2` の2つだけ                                                                                                        |
| `(G0, E9)` `bestmove win`                          | 入玉宣言。踏むテストが無い                                                                                                                                                                                                                                   |
| `(G0, E1)` エンジン側を人間として撃つ / `(G2, E1)` | `accept_human_move` の `is_engine` の枝と終局後の着手                                                                                                                                                                                                        |
| `enforce_engine_timeout` が true のとき            | ※11 の分岐。既定 false 側しか通していない                                                                                                                                                                                                                    |
| `E16` 世代違いの `SearchOutcome`                   | `req` の照合。`Runner` を直に組んで `req` をずらせば踏める（実機は要らない）。未検証                                                                                                                                                                         |
| 終了フックがエンジンを落とすこと                   | `ExitRequested` / `Exit` のどちらでも走る形にしたが、**実機で確かめていない**（Cmd+Q とウィンドウの × で経路が違う）                                                                                                                                         |
| `GameOverReason` が潰している区別                  | 裁定タイムアウトと利用者の中断が同じ `aborted`。`engineFailure` に落ちる経路は5本あるのに理由は1値                                                                                                                                                           |

## 実装との対応

- 状態機械: `src-tauri/src/engine/game/session.rs`
- 1回の `go`: `src-tauri/src/engine/game/search.rs`
- 持ち時間: `src-tauri/src/engine/game/clock.rs`
- 走っている対局の台帳: `src-tauri/src/engine/game/manager.rs`
- 出来事の宛先（`GameEventSink`）: `src-tauri/src/engine/game/events.rs`
- Tauri コマンド: `src-tauri/src/engine/commands/game.rs`
- 境界に出る型: `src-tauri/src/engine/game/types.rs`
- エンジンの出力を読む側: `src-tauri/src/engine/protocol.rs`
- エンジンプロセスの台帳: `src-tauri/src/engine/registry.rs` → [engine.md](engine.md)
- フロント側の口: `src/entities/game-session/`
