# レビュー game-engine ラウンド1

- 日付: 2026-09-02
- 範囲: `origin/main...HEAD` の27ファイル（対局の Rust API、エンジンプロセスの台帳、ADR-0007 とラチェット、TS 側の口）
- 走らせた reviewer: `rust` / `architecture` / `robustness` / `comment` / `perf` / `oss-hygiene`
- 対象コミット: `476c560`

## 所見

### BLOCK

#### B-1 エンジンが死んでも検出できない。読み取りスレッドが busy loop になり、対局は無音で永久に止まる

`rust` / `robustness`（同じ経路を別の入口から）

`src-tauri/src/engine/protocol.rs:134-146`。依存先 `usi-0.6.2/src/process/reader.rs:52-58` は **EOF を `Err` ではなく `Ok(EngineOutput { response: None })` で返す**。`listen` のループ（`engine.rs:192-208`）は hook が `Err` を返すまで回り、こちらの hook は常に `Ok(())`。

帰結は3つ。

1. エンジンが落ちると読み取りスレッドが EOF を延々読む **busy loop**（1プロセスにつき1コアを常時消費）
2. `listeners` の sender が落ちないので、`search.rs:138` の `None => SearchOutcome::Failed` に**到達する経路が無い**
3. `Phase::Thinking` のまま。`enforce_engine_timeout` の既定が false（`game/types.rs:147-148`）なので `on_tick` の時間切れも成立しない

利用者に見えるのは「相手の時計が 0 になり、その後なにも起きない盤面」だけ。
`docs/state-transitions/game-session.md:100` の E10 は**実装されていない**。

#### B-2 終局しても `run_loop` と `tick_loop` が永久に残る

`rust` / `perf` / `robustness`（3つが独立に検出）

`src-tauri/src/engine/game/session.rs:102`（`tx: tx.clone()`）、`:292`、`:295-311`。
**`Runner` が自分あての `Sender` を自分で持っている。** `rx.recv()` が `None` を返すには全 sender が落ちる必要があるが、その1つは `run_loop` が所有する `runner` の中にある。`tick_loop` も同じ輪を作る。

`close_game` を呼んでも `GameSession` を drop しても切れない。対局1局につきタスク2本と**毎秒10回の起床**が、アプリ終了まで残る。`Arc<EngineProcess>` も解放されない。
`session.rs:299` の `run_loop: ended` は**到達不能**。

#### B-3 `registry::terminate` の後に `UsiEngineHandler` が drop されるとパニックする

`rust`

`usi-0.6.2/src/process/engine.rs:73-77` の `Drop` は `self.kill().unwrap()`。`kill()` は先に `writer.send(&GuiCommand::Quit)` を通す（`:176-180`）。

`registry.rs:170-176` の `terminate` は `quit()` → `sleep(300ms)` → `kill_engine()` の順。行儀の良いエンジンは 300ms 後には消えているので `kill_engine` 内の `h.kill()` が EPIPE で `Err`（これは `let _ =` が握り潰す）。その後 `Arc` の最後の参照が落ちると `Drop` が同じ `kill()` を呼び、今度は `.unwrap()` で**パニックする**。

対局側は B-2 の leak で drop まで到達しないが、解析側は到達する。`EngineAnalyzer::initialize_engine`（`analyzer.rs:66-74`）が `shutdown()` を通り、関数末尾で `Arc` が落ちる。**エンジンを差し替えるたびにパニックしうる。**

#### B-4 「`validate` が排他にしているので両方が載ることは無い」が成り立たない

`comment`

`src-tauri/src/engine/game/clock.rs:131-138` のコメント。`TimeLimit::validate`（`types.rs:113`）が見ているのは**1つの `TimeLimit` の中だけ**で、`validate_settings`（`session.rs:967-974`）はそれを `black_time` / `white_time` に別々に掛ける。

`black_time = {byoyomi: 30s}` / `white_time = {increment: 5s}` は両方通り、`think_params(Black)` が **`byoyomi` と `winc` を同じ `go` に載せる**。コメントが「起きない」と断言している状態が入口を素通りして起きる。

#### B-5 「詰み・千日手・持将棋・最大手数はフロントが持つ」— 現物に無い

`architecture` / `comment`（独立に検出）

`session.rs:10-12` / `game/types.rs:151-155` / `docs/state-transitions/game-session.md:13-16` / `src/entities/game-session/api/rust-types.ts:74` の4箇所。

`src/entities/game/lib/shogiMoveValidator.ts` が持つのは合法手と成りの6メソッドだけ。土台の `moveValidation.ts` の export 11本も同じ。**`src/` を `千日手|repetition|持将棋|jishogi|最大手数` で引いても、当たるのは `entities/kifu/model/jkf.ts:33-34` の棋譜の特殊手の文字列定数と、今回足したコメントだけ。**

この一文が `AwaitingRuling` という設計の根拠そのものになっている。読み手は「フロントを呼べば裁定できる」と読むが、**必要な判定はどこにも実装されていない**。

なお「フロントが判定して `Rule` として渡す」という**契約の記述は正しい**。直すのは「既にある」と言っている箇所だけ。

### HIGH

| #    | 所見                                                                                                                                                                                                                                                                                                                                                         | reviewer                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| H-1  | **`STOP_GRACE` 超過後、捨てるはずの `bestmove` を次の手の着手として採る。** `search.rs:163-173` が `Aborted` を返し、`session.rs:501-507` が新しいリスナー付きで `go` を出し直す。遅れて届いた先読み分の `bestmove` は `req` が一致するので採用される。**先読み局面に対する手が実際の局面の着手として `MoveDecided` に載る**。表の不変条件2 が破れる具体経路 | `robustness` / `rust`                  |
| H-2  | **`hand_turn_to` の `Busy{Search}` が `Idle` と同じ `None` に潰れる**（`session.rs:643-651`, `:673`）。`start_search` へ落ちて探索中のエンジンへ `go` を送り、`spawn_search:739` が `activity` を上書きするので前の `CancellationToken` が失われる。前の探索は `stop` すら送られずに生き残り、2つの読み筋が交互に出る                                        | `rust` / `comment`                     |
| H-3  | **`go` に上限が無い。** `search.rs:122-146` の第1相に時間の枝が無く、`enforce_engine_timeout` の既定が false。`byoyomi` を無視するエンジンや `isready` 後に固まったエンジンで対局が無音で止まる。`AwaitingRuling` には 30 秒の打ち切りがあるのに `Thinking` には対が無い                                                                                     | `rust`                                 |
| H-4  | **エンジン出力を1行ごとに `spawn` して配っているので配送順が保証されない**（`protocol.rs:134-146`）。`id name` と `usiok` が入れ替わると `collect_engine_info` が `name.is_empty()` で落ち、**エンジン起動が偶発的に失敗する**。この変更で `EngineRegistry::spawn` が必ずこの経路を通るようになった                                                          | `rust`                                 |
| H-5  | **`close` が `Arc::try_unwrap` に失敗するとエンジンを回収する手段が無くなる**（`manager.rs:50-69`）。(1) セッションは既に台帳から外れているので `close_all` でも拾えない (2) `close_all` / `shutdown_all` の**呼び出し元が0**（`lib.rs` に `RunEvent` も `on_window_event` も無い）。コメント「残ったプロセスは `close_all` が拾う」は二重に嘘               | `architecture` / `rust` / `robustness` |
| H-6  | **`info` の間引きが1段も無い**（`search.rs:126-131` → `session.rs:469-479`）。解析側は `RESULT_FLUSH_MS = 80` で毎秒12.5回に畳んでいる。さらに `run_loop` は単一キューなので `bestmove` が `info` の滞留の後ろに並び、**消費時間を取り出した時点で測っている**（`decide_move:602-604`）ため滞留がそのまま持ち時間の請求になる                                | `perf` / `rust`                        |
| H-7  | **`engine::bridge` ⇄ `engine::game` の相互依存**（`bridge.rs:4` ⇄ `game/bridge.rs:6`）。`AppState` が解析の facade と同じファイルに同居しているため、対局側がアプリ状態を取るのに解析のファイルを読むことになる                                                                                                                                              | `architecture`                         |
| H-8  | **`GameEvent::SearchInfo` が運ぶ `AnalysisResult` だけ snake_case で線に出る。** `rename_all_fields` は中の型まで降りない。`types.rs:344` の `assert!(!json.contains('_'))` は `MoveDecided` にしか当たっておらず、**テストが `SearchInfo` の枝を一度も作っていない**。テスト名は "all the way down"                                                         | `architecture`                         |
| H-9  | **裁定タイムアウトの終局が利用者の中断と区別できない**（`session.rs:576-586`）。どちらも `reason: aborted` / `winner: null`。区別できるのは `detail` の英文だけで、**アプリが対局を落とした事実に利用者は永久に気付かない**                                                                                                                                  | `robustness`                           |
| H-10 | **時計を止めているのは `elapsed_ms` ではない。** `session.rs:813-826` の `_ => 0` の枝は**一度も実行されない**（呼び出し3箇所すべて `Thinking` の中）。実際の番人は `clocks_view:824` と `on_tick:576-586`。表の不変条件4 は間違った場所を指している                                                                                                         | `comment`                              |
| H-11 | **`bridge.rs:20-22`「分けると同じ実行ファイルを二重に起動する」が実装に無い。** `EngineRegistry::spawn` はパスでの引き当てを一切せず、毎回新しい ID で起動する                                                                                                                                                                                               | `architecture` / `comment`             |
| H-12 | **文書の数値と主張の誤りが6件**（下の「文書の誤り」節にまとめる）                                                                                                                                                                                                                                                                                            | `oss-hygiene` / `comment`              |
| H-13 | **Q-006 の期限「対局の実装に着手するまで」が切れた。** 対局のコマンド9本（`lib.rs:18-20`）が旧語彙で入り、案（`docs/proposals/naming-and-module-layout.md`）の前提「41本→書き換え」は50本になった。問いも案も触られていない                                                                                                                                  | `oss-hygiene`                          |

### MEDIUM

| #    | 所見                                                                                                                                                                                                                                                                 | reviewer       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| M-1  | `finish` が時計を締めないので `Over` で**時計が巻き戻って見える**（`session.rs:758-770`）。時間切れ負けした側の持ち時間が満額残る                                                                                                                                    | `rust`         |
| M-2  | 時計の算術が `u64` で溢れる（`clock.rs:43-45`, `:71-77`）。`validate` に上限が無く、`mainMs: u64::MAX` が通る。debug でパニック、release で初手時間切れ                                                                                                              | `rust`         |
| M-3  | `start_game` が `tests/root_guard.rs` の `STRUCT_CARRIED_PATH` に無い。加えて **`work_dir` は一切検査されず `Command::current_dir` に渡る**                                                                                                                          | `rust`         |
| M-4  | `async fn` の中でブロッキング IO（`protocol.rs:219-225` の `write_all`、`registry.rs:78-101` の `canonicalize` / `Command::spawn`）。詰まるとそのセッションの全コマンドが無期限に固まる                                                                              | `rust`         |
| M-5  | 対局 API のエラーが全部 `String`。フロントが「再試行」「やり直し」「バグ」を文字列比較でしか分けられない。`{side:?}` の `Black` / `White` が利用者向け文言に混じる                                                                                                   | `rust`         |
| M-6  | `accept_continue` の検算が**末尾と偶奇だけ**で、先頭側が食い違った列を通す（`session.rs:396-412`）。千日手模様では末尾も偶奇も自然に一致する                                                                                                                         | `robustness`   |
| M-7  | **3フィールドの SFEN が門番を通る**（`session.rs:981-987`）。手数欄が無い `... b -` が通り、`position sfen ... b - moves 7g7f` が届く                                                                                                                                | `robustness`   |
| M-8  | **`failure-surfacing.md` に対局の行が1つも無い。** ADR-0004 決定6 の運用は「台帳に載せてから出口を作る」                                                                                                                                                             | `robustness`   |
| M-9  | **`game-event` が `start_game` の戻り前に流れ始める**（`session.rs:105-115`）。受け手はまだ `gameId` を知らないので捨てるしかなく、捨てた `moveDecided` に裁定を返せず30秒で中断される                                                                               | `robustness`   |
| M-10 | `registry.rs:70-71` の「`/bin/sh` のような任意バイナリを塞ぐ」が塞げていない。`/bin/sh` は実在するので `canonicalize` も `is_file()` も通る                                                                                                                          | `robustness`   |
| M-11 | `GameManager` だけ registry を**引数で毎回受ける**（`manager.rs:29,49,73`）。`start` と `close` に別物を渡しても `shutdown` が黙って成功する                                                                                                                         | `architecture` |
| M-12 | `contains_usi_breaking_char` が2実装（`analyzer.rs:22-24` / `session.rs:1036-1038`）。同じ「USI に流していい文字列か」に定義が2つ                                                                                                                                    | `architecture` |
| M-13 | `session.rs` に3本の切れ目（起動段取り `:868-955` / 検証 `:957-1038`）。どちらも `Runner` の状態を触らない純関数群。`clock.rs` を切り出した基準がここに当たっていない                                                                                                | `architecture` |
| M-14 | `engine/` に trait が0本。`UsiProtocol` が具体型のまま渡るので**テストがエンジンを差し替えられない**。表の「埋まっていないセル」8件はこの形の帰結                                                                                                                    | `architecture` |
| M-15 | `entities/game` の barrel が `ShogiMoveValidator` を出しておらず（`index.ts` 3行）、`game-session` からの逆向きの注記も無い                                                                                                                                          | `architecture` |
| M-16 | `GameId` と `startSfen` が素の `string`。`submitGameMove(gameId, side, usiMove)` は第1・第3引数を入れ替えても tsc が通る。この repo には brand 型の前例がある                                                                                                        | `architecture` |
| M-17 | `engine.md` が registry 化を反映していない（対象に `registry.rs` が無く、P 列が `analyzer` の初期化状態で書かれている）。`app.md` から `game-session.md` への参照も無い                                                                                              | `architecture` |
| M-18 | 変更の経緯がコメントに（`game/types.rs:282-286` の「出ていた」、`tests/serde_naming.rs:263-265` の「実際に踏んだ」）。`commentHistory` の `HISTORY_WORDS` に語が無く素通り                                                                                           | `comment`      |
| M-19 | `rust-types.ts:2` が**実在しない `types.ts`** を指す。加えて「綴りは ADR-0007」の断言が `searchInfo.result` で守れていない（H-8）                                                                                                                                    | `comment`      |
| M-20 | `decide_move` の順序依存がコード側に無い（`session.rs:601-634`）。`self.phase = ...` を頭へ動かすと `elapsed` が常に 0 になり**全員の持ち時間が減らなくなる**が、コンパイルもテストも通る                                                                            | `comment`      |
| M-21 | 定数の根拠が無い3つ（`QUIT_GRACE` の 300ms、`STOP_GRACE` の 5s）。`USI_OK_TIMEOUT` は「長く取る理由が無い」と書いた直後に 30 秒。「終わらないエンジンは実在する」に裏付けが無い                                                                                      | `comment`      |
| M-22 | 命名の割れ: 同じ「台帳」に `Manager` と `Registry`／`SearchKind::Search` が情報を持たない／`get_game_state` だけ `snapshot` の語彙から外れる（**呼び手が0のいまなら改名は barrel と登録だけ**）／TS に3つ目の先後の語 `Side` が入るのに既存の `Color` との変換が無い | `comment`      |
| M-23 | Tauri コマンド9つのうち `get_game_state` / `list_games` の2つに doc が無い。`list_games` が**終局した対局も返す**ことはコードから読めない                                                                                                                            | `comment`      |
| M-24 | `on_search_outcome` が78行で説明コメント5本。`restart_after_abort` の消費が `Phase::Over` の判定より後であることに依存している（順序を入れ替えると `gameover` の前に `go` が飛ぶ）                                                                                   | `comment`      |
| M-25 | `submit_move` の doc が「必ず `MoveDecided` が出る」と読める。時間切れ時は `Over` になり `MoveDecided` は出ない                                                                                                                                                      | `comment`      |
| M-26 | エンジンの停止が直列で1本あたり必ず 300ms 寝る（`registry.rs:170-176`）。エンジン同士の対局を閉じると `close_game` が**必ず 600ms 返らない**                                                                                                                         | `perf`         |
| M-27 | `docs/OPEN-QUESTIONS.md` の Q-003 🔴 に、対局の範囲の一部が入った事実が書かれていない                                                                                                                                                                                | `oss-hygiene`  |
| M-28 | ADR-0007:51-52 が `research/shogihome/05-usi-engine.md` を**逐語でない鉤括弧**で引き、`所感` 節の文を事実として使い、しかも原因を別の型（`EnginePreset.options`）に帰属させている                                                                                    | `oss-hygiene`  |
| M-29 | `CONTRIBUTING.md:280` の「`npm run test` に置いてあります」が Rust の2行に当てはまらない（Rust は `verify:rust`）。ADR-0007 自身がその区別を設計理由にしている                                                                                                       | `oss-hygiene`  |
| M-30 | `ratchetIndex` は **Rust の検査の載せ忘れを止められない**（`src/__tests__/` しか歩かない）。今回2本目になったので例外ではなくなった                                                                                                                                  | `oss-hygiene`  |
| M-31 | ADR-0007:78 が未着手の書き換え（`MateInMoves { moves: i32 }`）を完了形で書いている。EXEMPT の理由が未採用案（`naming-and-module-layout.md:276-277` の alias 移行）と衝突                                                                                             | `oss-hygiene`  |

### 文書の誤り（H-12 の内訳）

| 場所                                  | 書いてあること                        | 現物                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/state-transitions/README.md:45` | 「セルを固定したテストは1つも無い」   | **同じ PR で20本入れている**（`session.rs` 15 + 5）                                                                                                                           |
| `game-session.md:232`                 | 「（テストはここだけ）」              | `:207` と矛盾。`clock.rs` 9 / `session.rs` 20 / `types.rs` 2                                                                                                                  |
| `game-session.md:130`                 | 「※14 の 30 秒で中断」                | **注は ※1〜※11 しか無い。** 指したいのはイベント **E14**                                                                                                                      |
| `game-session.md:90` / `:162`         | E1 は「人間だけで全列を踏める」`✓`    | `(G2,E1)` と `is_engine` の枝（`session.rs:373`）を踏むテストが無い                                                                                                           |
| `game-session.md:85-86`               | 凡例が `—` と `Err` だけ              | 新設した「テスト」列の `✓` / `✗` の意味がどこにも無い                                                                                                                         |
| ADR-0007:22                           | 「`search/` は18型中16」              | `search/types.rs` は **20型中18**。残る2つは `IndexState` / `Consistency`                                                                                                     |
| ADR-0007:12-13                        | 「数え方は `serde_naming.rs` が持つ」 | テストが出すのは **26 と 2 だけ**。67 も 18/16 も再現できない                                                                                                                 |
| ADR-0007:19                           | 値なし enum は「3通り」               | **4通り。** 抜けているのが一番危ない「無指定＝PascalCase のまま」で、`IndexState` / `Consistency` がそれ。TS 側は `"BestEffort"` / `"Empty"` という文字列リテラルで受けている |

## 重複・矛盾した所見

- **B-2 は3つの reviewer が独立に検出**（`rust` BLOCK / `perf` HIGH / `robustness` HIGH）。深刻度の食い違いは「CPU の無駄」と見るか「`Arc<EngineProcess>` が解放されない」と見るかの差で、指している経路は同一。**BLOCK として扱う**
- **B-1 と H-3 は同じ症状（対局が無音で止まる）の別原因。** B-1 は「死んだのに気付けない」、H-3 は「生きているが返さない」。B-1 を直しても H-3 は残る
- **H-1 と H-2 はどちらも「探索中のエンジンへ `go` を出す」に落ちる。** H-1 は `STOP_GRACE` 超過経路、H-2 は状態の潰し込み経路。`SearchOutcome` に1バリアント足す修正が両方に効く
- **H-5 と B-2 は矛盾しない補完関係。** B-2 があるので対局側は `Drop` に到達せず、B-3 のパニックが偶然回避されている。**B-2 を直すと B-3 が顕在化する**
- `comment` は B-5 について「`types.rs:151-155` / `bridge.rs:38-42` / `tauri.ts:28-38` の契約の記述は正しい」と限定し、`architecture` は4箇所すべてを対象にした。**`comment` の限定が正しい**（契約と現状の記述を分ける）

## 見ていない範囲

- **実機のエンジンを起動しての確認は誰もしていない。** エンジンが絡む所見は全て静的読解
- `npm run verify` / `verify:rust` を走らせた reviewer は0（`oss-hygiene` が `cargo test --test serde_naming` と vitest 3本だけ）
- `emit`（Tauri IPC）1回の実コストが未計測。H-6 の「発散する行数」を数字で出せない
- エンジンが実際に毎秒何行の `info` を出すかを未計測。H-6 の閾値は消費側（`RESULT_FLUSH_MS`）からの推定
- `protocol.rs` の `pending_after_ready` の世代管理（`:228-309`）の正しさ
- `Instant` が macOS のスリープ中に進むか（`RULING_TIMEOUT` のスリープ復帰時の振る舞い）
- フロントの対局 UI は存在しないので、レンダ回数・`invoke` の連打経路は評価できない
- `research/shogihome/` の実装への逐語引用の有無（帰属の観点）

## lint / hook で強制できるもの

| 何を                                                                            | どう                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `run_loop` が終わること（B-2）                                                  | `close` 後に `tx.send(Tick)` が `Err` になることを見る `#[test]` 1本                                   |
| ソースコメントの中のパスの実在（M-19）                                          | `src/__tests__/docsSourcePaths.ts` の `sourcePathsIn` を `SRC` と `RUST_SRC` にも掛ける                |
| `※N` の参照切れ（`game-session.md:130`）                                        | `docs/state-transitions/*.md` の本文の `※N` を `### 注` の定義と突き合わせる。`stripFences` が既にある |
| Rust のラチェットの載せ忘れ（M-30）                                             | `ratchetIndex.test.ts` に `src-tauri/tests/*.rs` を歩く4本目                                           |
| Tauri コマンドの `///` 欠落（M-23）                                             | `#[tauri::command]` の直前に `///` が無いものを数える。`serde_naming.rs` と同じ形                      |
| `commentHistory` の語彙の穴（M-18）                                             | `HISTORY_WORDS` に「出ていた」「踏んだ」相当。ただし状態の記述にも出うるので形を絞ること               |
| `GameOverReason` の全バリアントの綴り                                           | `types.rs:288` と同じ手口で全バリアントを列挙して固定（いまは `declareWin` 1つだけ）                   |
| `docs/state-transitions/` の新規表が `failure-surfacing.md` に現れること（M-8） | `verify-gate.sh` に足せる                                                                              |
| **機械で防げないもの**                                                          | 定数の値の根拠、コメントの主張と実装の対応、命名の割れ、責務の置き場、brand 型の有無、ADR の実測値     |

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

| 束                         | 所見                                                 | 判定                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **エンジンの生死と同期**   | B-1 → H-4 → H-2 → H-1 → H-3                          | B-1 を直すと H-3 の「死んだ場合」が消える（「生きているが返さない」は残る）。H-4 は B-1 と**同じ hook** を書き換えるので隣に置く。H-2 を直すと H-1 の指摘箇所が**別物になる**（潰し込みが無くなった状態での grace 超過） |
| **タスクとプロセスの寿命** | B-2 → B-3 → H-5 → M-26                               | **B-2 を直すと B-3 が顕在化する**（いまは leak のせいで `Drop` に到達しない）。順序を逆にすると B-3 は再現しないまま通る                                                                                                 |
| **時計**                   | B-4 → M-1 → M-2 → H-10 → M-20                        | B-4 は検査の追加、残りは独立                                                                                                                                                                                             |
| **責任の切れ目の記述**     | B-5 → M-8 → M-27                                     | B-5 を直すと「その判定はまだ無い」が確定し、M-8（台帳への登録）と M-27（Q-003 の更新）の書く内容が決まる                                                                                                                 |
| **文書の数値**             | H-12 の8件 → M-28 / M-29 / M-30 / M-31 → H-13        | 独立。まとめて1ラウンドで取る                                                                                                                                                                                            |
| **線に出る形**             | H-8 → M-19                                           | H-8 を直すと M-19 の「断言が守れていない」が消える                                                                                                                                                                       |
| **構造**                   | H-7 → M-11 → M-12 → M-13 → M-14 → M-15 → M-16 → M-17 | M-14（trait を入れる）を先にやると M-13（ファイル分割）の切り方が変わる                                                                                                                                                  |

### このラウンドで直すもの

| 順  | 所見    | なぜこの順か                                                                              | この直し方で壊しうるもの                                                                                                                                                                                                                                                |
| --- | ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **B-1** | 束の先頭。これが無いと E10 が一度も動かず、H-3 の切り分けもできない                       | hook が `Err` を返すと `listen` のスレッドが止まる。**EOF の判定を誤ると、生きているエンジンの listener が全部落ちて `EngineFailure` になる。** `reader.rs` は EOF 時に空でない `buf` を返しうる（直前の read の残り）ので、`raw_str.is_empty()` だけを見る判定は危ない |
| 2   | **H-4** | B-1 と**同じ `start_listening` の hook** を書き換える。分けると同じ場所を2回触る          | 1本のタスクへ直列化すると、`broadcast_to_listeners` の `listeners.read().await` の取得待ちが読み取り全体を止める。`send` は unbounded なのでブロックしないが、**ロック待ちは起きる**                                                                                    |
| 3   | **B-2** | 束の先頭。B-3 の前提                                                                      | weak sender にすると `spawn_search` の `upgrade()` が `None` を返す窓ができ、**対局が終わる瞬間に投げた探索が黙って消える。** 消えたことをログに残さないと原因不明の停止になる                                                                                          |
| 4   | **B-3** | **B-2 の後でないと顕在化しない**（いまは `Drop` に到達しない）                            | `mem::forget` で逃げると **fd がリークする**。エンジンを何度も差し替えると枯れる。`quit` を送らずに `kill` する形にすると、行儀の良いエンジンが後始末（学習データの書き出し）を打ち切られる                                                                             |
| 5   | **H-2** | H-1 より先。状態の潰し込みを直してから grace 超過を扱わないと、H-1 の指摘箇所が別物になる | `Busy{Search}` で `finish` に落とすと、**組み立てのバグが対局の強制終了として表に出る**（いまは warn だけで進んでいた）。人間だけのテストは通るので、この枝は実機でしか踏めない                                                                                         |
| 6   | **H-1** | H-2 の後                                                                                  | `Aborted` を `Failed` にすると、**先読みが外れて 5 秒で止まらなかっただけのエンジンが `EngineFailure` で負ける。** `STOP_GRACE` の 5 秒の妥当性が初めて効いてくる（M-21 と連動）                                                                                        |
| 7   | **B-4** | 弾く方向の門番。積み上がる前に入れる                                                      | **「先手は秒読み・後手はフィッシャー」が弾かれる。** これを通したい要求があるかは未確認 → **通したいものの一覧を先に作ってからテストにする**（`/implement` 手順5）                                                                                                      |
| 8   | **B-5** | コメントのみ。他の修正の記述と衝突しないよう最後                                          | 壊れるものは無い。ただし**「その判定はまだ無い」と書くだけで終えると、次の人が同じ勘違いをする。** 判定を誰がどこに作るかの issue を必ず伴わせる                                                                                                                        |

### 直さないもの

| 所見                                                                          | 行き先               | 理由                                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| H-3 / H-5 / H-6 / H-8 / H-9 / H-10 / H-11 / H-12                              | **r2**               | 検証コスト（下）。H-3 は B-1 を直した後に残る範囲を測り直してから取る                                                         |
| M-1 / M-2 / M-6 / M-7 / M-19 / M-20 / M-25 / M-26                             | **r2**               | 同上                                                                                                                          |
| H-7 / M-11〜M-17（構造）                                                      | **r3**               | M-14（trait）を先に入れると M-13 の切り方が変わる。**設計の順が決まってから取る**                                             |
| M-22（命名）                                                                  | **r3**               | `get_game_state` → `get_game_snapshot` は**呼び手が0のいまなら barrel と登録だけ**。r3 までは安い                             |
| M-3 / M-4 / M-5 / M-9 / M-10 / M-18 / M-21 / M-23 / M-24                      | **r3**               | 同 PR 内。r1 で積むと検証が20分を超える                                                                                       |
| M-8（`failure-surfacing.md` に対局の行）                                      | **r2**（B-5 の直後） | B-5 で「まだ無い判定」が確定してから書かないと、台帳の行が空約束になる                                                        |
| H-13（Q-006 の期限切れ）                                                      | **issue**            | コマンド41→50本の改名は**この PR の範囲外**。事実（9本が旧語彙で入った）を issue に記録し、Q-006 の期限行の更新は別コミットで |
| M-27（Q-003 に対局が入った事実）                                              | **r2**               | 1行なので安い                                                                                                                 |
| M-28 / M-29 / M-30 / M-31                                                     | **r2**               | どれも自分が足した文書の誤り。同 PR 内で直す                                                                                  |
| `AnalysisUpdate` の `session_id` / `sessionId` 不一致                         | **issue**            | 解析側。ADR-0007 の移行に含めるべきで、対局の差分に混ぜない                                                                   |
| 解析側の USI 語彙の漏れ（`isReady` / 局面同期 / `position` 文字列の組み立て） | **issue**            | 範囲外。`features/engine-position-sync` の解体を伴う                                                                          |
| `setPositionFromMoves` が `position sfen startpos ...` を作る                 | **issue**            | 範囲外（呼び出し元0の死んだ関数だが、地雷）                                                                                   |

### 対象そのものを疑ったか

**所見が集まっている機構は2つ。**

1. **`restart_after_abort`（bool 1つ）に H-1 / H-2 / M-24 の3件が集まっている。** 先読みが外れたときの「止めて、捨てる `bestmove` を待ってから再開する」を、`Activity` の状態とは**別の bool** で持っているのが根。同じ判断をする場所が `hand_turn_to`（立てる）と `on_search_outcome`（消費する）の2箇所に割れている。
   → **落とす案**: bool を消して `Activity::Restarting { req, cancel }` を `Activity` に足す。判断が1つの enum に閉じ、`on_search_outcome` の早期 return が1段減る。**r1 では取らない**（H-2 / H-1 を先に直して、それでも所見が出るなら r2 で機構ごと落とす）。
   なお **ponder そのものを落とす案は採らない。** ユーザーが「フルスペック」を要求しており、この機構は要求されている。

2. **`session.rs` の `Runner` に9件**（B-2 / B-4 / H-1 / H-2 / H-6 / H-10 / M-1 / M-20 / M-24）。ただしこれは状態機械そのものなので、落とす対象ではなく**分ける対象**（M-13 / M-14）。r3 で扱う。

**所見が減らないラウンドが3回続いたら、この2つを疑い直すこと。**

### 次ラウンドの焦点

r2 の reviewer へ渡す。

1. **B-1 の EOF 判定が、生きているエンジンを誤って殺していないか。** `reader.rs` が EOF 時に返す `buf` の中身を確かめること
2. **H-4 の直列化で読み取りが詰まっていないか。** `listeners.read()` の取得待ちが `broadcast` の中に入る形になっていないか
3. **B-2 の weak sender で、対局終了の瞬間に投げた探索が黙って消えていないか。** 消えたことがログに残るか
4. **B-3 の後始末で fd がリークしていないか。** `quit` を送る／送らないの選択の根拠がコメントに書かれているか
5. **H-2 / H-1 で `EngineFailure` の発火条件が広がりすぎていないか。** 正常な先読みの外れが終局にならないこと
6. **B-4 の門番が「先手は秒読み・後手はフィッシャー」を弾いてよいのか。** 通したいものの一覧がテストに落ちているか
7. **B-5 を直した結果、`AwaitingRuling` という設計の根拠がまだ立っているか。** 「フロントに判定が無い」なら、なぜ Rust に持たないのかの理由が別に要る

### 検証の見積り

`git commit` ごとに `.claude/hooks/verify-gate.sh` が走る。r1 で直す8件はすべて `.rs` を触るので `npm run verify:rust`。

    8件 × 約2分15秒 ≒ 18分

10件を超えると20分を超えるので8件で止めた。**r2 へ送ったのは HIGH 8件・MEDIUM 12件、r3 へ送ったのは MEDIUM 14件、issue は4件。**

## 修正の結果（r1）

| 順  | 所見 | コミット  | 結果                                                                                                                                                                                                       |
| --- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | B-1  | `4ed9a8e` | 直した。EOF 判定は `response.is_none()` だけで足りることを `reader.rs` を読んで確認（`response: None` は EOF のときだけ／そのとき `raw_str` は必ず空）。**計画が疑った「`raw_str` が空でない」は起きない** |
| 2   | H-4  | `ca3a257` | 直した。読み取りスレッドと配布をチャンネル1本で繋いだ。読み取り側は `send` だけで、ロックを待つのは配る側の1本                                                                                             |
| 3   | B-2  | `cca5927` | 直した。`Runner` と `tick_loop` を weak sender に。**テスト1本（`dropping_a_game_leaves_no_one_holding_its_channel`）を足し、strong に戻す変異で落ちることを確認**                                         |
| 4   | B-3  | `b838be0` | 直した。handler を `Option` にして `kill_engine` が `take` + `forget`。**fd の漏れと子プロセスの回収は残る**（`Child::drop` は `wait` しない）→ #353                                                       |
| 5   | H-2  | `bb5e346` | 直した。`Handover` の3値に分け、`Busy{Search}` は「止めてから始め直す」へ。`spawn_search` にも門番を1つ                                                                                                    |
| 6   | H-1  | `6be0c53` | 直した。`SearchOutcome::StopTimedOut` を分け、`EngineFailure` で終局させる。`restart_after_abort` は結果に関わらず消す                                                                                     |
| 7   | B-4  | `61b7fc1` | 直した。通したい5つを先に並べてから門番を書いた。**弾くのは流儀が違うときだけで、長さの違いは通す**                                                                                                        |
| 8   | B-5  | `a3d4a9c` | 直した。合法手（既にある）と終局判定（まだ無い）を分けて書いた。**設計の結論は変わらない**（Rust が終局を知る手立てを持たないという理由はむしろ強くなる）→ #354                                            |

### 提案どおりに直さなかったもの

- **H-2 で `finish(EngineFailure)` に落とす案**（`rust` の提案）は採らなかった。`Busy{Search}` は組み立てのバグであって、エンジンの故障ではない。**内部のバグを対局の強制終了に変えると、原因が「エンジンが悪い」に化ける。** 先読みが外れたときと同じ復帰経路（止めてから始め直す）に寄せ、`warn` は残した
- **B-3 で `usi` crate を patch する案**は採らなかった。エンジン層の作り替えを伴うので対局の PR に混ぜない。`forget` の代償（fd の漏れ）をコメントに書いて #353 へ送った

### 新しく立てた issue

| 番号 | 内容                                                                     |
| ---- | ------------------------------------------------------------------------ |
| #353 | `usi` crate の `Drop` が `kill().unwrap()` を呼ぶ。fd と子プロセスが残る |
| #354 | 対局の終局判定（詰み・千日手・持将棋・最大手数）がどこにも無い           |
