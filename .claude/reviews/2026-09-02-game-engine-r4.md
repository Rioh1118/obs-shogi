# 対局エンジン レビュー ラウンド4

対象: `worktree-wt-game-engine`（`origin/main` + `59ddb6d`）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

r3 の焦点5点（`Closed` の扱い / 畳み待ち / 時計の番人 / doc の識別子 / 3ラウンド持ち越しの
`pending_after_ready`）を明示して回した。

## 総括

**BLOCK が4件。うち1件は rust と robustness が独立に同じものを挙げた。**
残る3件は comment が挙げた doc の腐りで、rust も同じ箇所を別番号で挙げている。

r3 の修正が原因のものが多い。内訳は下の「退行の出どころ」に書く。

| 観点       | BLOCK | HIGH | MEDIUM |
| ---------- | ----- | ---- | ------ |
| rust       | 1     | 3    | 6      |
| robustness | 1     | 2    | 4      |
| comment    | 3     | 1    | 5      |

---

## 3人が独立に同じものを挙げたもの

同じ行を別の観点から指したものは、まとめて1件として扱う。

### R4-B1 `ReadyState::Closed` が終端でない（rust BLOCK / robustness BLOCK）

`send_command` は `IsReady` を `dispatch_for` より**前**に返し（`protocol.rs:308-311`）、
その先の `start_ready_watch_and_send` が現在値を見ずに `ready.send(ReadyState::Waiting)`
する（`:356`）。`Closed` を立てるのは転送タスク1箇所（`:233`）で、読み取りは二度と
始まらない（`usi` の `listen` は reader を `take` する）。

つまり **`isready` を1回送ると、その `UsiProtocol` は永久に `Waiting` になる。**
r3 が `Closed` を足して塞いだ「無音で積んで `Ok` を返す」がそのまま復活する。

筋道（`analyzer.rs:108`、`options` が空でエンジンを既定のまま使う場合）:

1. エンジンの出力が終わる（EOF / 非 UTF-8 の1行 → #359）→ `ready = Closed`
2. 「適用」を押す → `setoption` の `Refuse` を踏まずに `send_command(IsReady)` へ到達
   → **`:356` が `Closed` を `Waiting` へ戻す**
3. `register_listener` の `Closed` 拒否（`:160-163`）はもう当たらない
4. 以降 `set_position` も `go infinite` も `Queue` → **`Ok`**。掃く watch タスクは
   存在しない（その世代の `readyok` は来ない）。**画面は解析中のまま、`info` もエラーも永久に出ない**

対局側も同じ。`ensure_ready`（`:523`）は `send_command(IsReady)` が先に `Closed` を
消すので、`:542` の早期 `Err` が**一度も当たらない**。`send_setup`（`session.rs:1229`）
経由で `READY_TIMEOUT` の120秒フルに `start_game` が返らなくなる。
**これは `protocol.rs:29-33` が `ready` を3値にした理由として名指ししている故障そのもの**で、
doc が防ぐと書いている状況を doc のすぐ下のコードが作っている。

派生（rust HIGH、同じ根）: `dispatch_for` の doc は「送ろうとしているコマンドを
どう扱うか決める」と名乗り、`dispatch_for(Closed, IsReady)` は `Refuse` を返すが、
**誰もその答えを聞いていない。** テスト（`:659`）は `[go, position, stop]` しか回さないので
緑のまま通る。

### R4-B2 `clocks.running: null` の意味が4通りに増えた（comment BLOCK / rust HIGH / robustness HIGH）

3人とも同じ3箇所を指した。`types.rs:227` / `rust-types.ts:140` /
`game-session.md:241` はどれも「両方止まっているなら `None`（**裁定待ちと終局後**）」。

現物で `None` になるのは4つ（`session.rs:1094-1110`）。

1. `Phase::AwaitingRuling`
2. `Phase::Over`
3. **`Thinking` だが `turn_started` が `None`**（畳み待ち。r3 の `578e5b1` / R3-H1）
4. **壁時計が取れない**（`now_epoch_ms()` が `None`。r3 の `43e573d` / R3-M6）

3 は毎手通る。`accept_continue` が `turn_started = None`（`:538`）→ `hand_turn_to` が
`StopThenStart`（`:875`）→ そのまま `TurnChanged` を emit（`:555-559`）。
**`phase: thinking` なのに `clocks.running: null` のイベント**が、doc に
「手番が変わり、時計が動き出した」と書いてある型（`types.rs:276`）で飛ぶ。

しかも `on_tick` は畳み待ちの間 `:745` で戻るので `clockUpdated` を1件も出さない。
契約どおりに書いたフロントは**相手の手番の頭で最大5秒、時計が止まって見える。**
4 では恒久的に止まったまま対局だけが進む。

**`session.rs:1571-1574` のテストが `Thinking` かつ `running.is_none()` を固定しているので、
doc は自分のリポジトリのテストと逆のことを書いている。**

### R4-B3 不変条件4 が存在しない関数名・偽の呼び出し数・正反対の指示を同時に持つ（comment BLOCK / rust MEDIUM）

`game-session.md:275-279`:

> 守っているのは `clocks_view` と `on_tick` の2箇所。
> `elapsed_ms` の `Thinking` 以外の枝は**到達しない**（呼び出し3箇所すべてが `Thinking` の中）

3点とも偽。

- `elapsed_ms` という関数は `engine/game/` に無い（`578e5b1` が `running_clock()` に改名）
- `clocks_view` は `finish` の後（`:1033`、`Over`）・`decide_move` の後（`:813`、`AwaitingRuling`）・
  `snapshot`（`:1134`、任意の段）から呼ばれる。**`Thinking` 以外の枝は毎回通る**（`:1801-1812` が固定）
- doc は「そこを番人と読むな」、`session.rs:1092` は「**時計の番人はここ1箇所**」

信じた人が `running_clock` の `Phase` 判定を「到達しない枝」と読んで消せる。消すと
`snapshot` と `finish` が終局後も動いている時計を出す。`cargo test` は落ちない
（`Over` 側を見るテストが無い）。

### R4-B4 表 ※4 が存在しない定数名を指す（comment BLOCK / rust MEDIUM / robustness MEDIUM）

`game-session.md:149` の `CLOSE_QUIET_TIMEOUT` は現物に無い（`CLOSE_SETTLE_TIMEOUT`、
`session.rs:73`）。`de86dd4` の改名で腐った。リポジトリ全体で他に1件も無いので grep が空振りする。
`docsSourcePaths` はパスしか見ないため機械でも止まらない。

加えて ※4 は「待つ理由」だけで、r3 が足した**「上限を置く理由」**（`session.rs:66-70`）も
「超えたら畳めていなくても落とす」（`:215-226`）も書いていない。

### R4-H1 `close` の上限は `registry.shutdown` の手前で切れている（rust HIGH / robustness HIGH）

`CLOSE_SETTLE_TIMEOUT` の doc は上限を置く理由として「stdin を読まないエンジンでは
書き込みが止まり `close_game` が無期限に返らない」と書いている（`session.rs:66-70`）。
ところが畳み待ちを6秒で打ち切った直後、`:224-226` が**まさにその詰まる書き込みを
上限なしで**呼ぶ。

```
registry.shutdown(id) → terminate → protocol.quit() → send_command(Quit)
  → handler.lock().await → usi の write_all + flush（同期）
```

`usi-0.6.2/src/process/writer.rs:33-38` は `ChildStdin` へのブロッキング書き込み。
パイプが埋まれば `close_game` は返らず、`handler` の Mutex を握ったままなので
同じエンジンへの他の全タスクも道連れになる。**6秒の上限は「返らない」を
「6秒待ってから返らない」に変えただけ。**

同じ関数にもう1つ偽の断言がある。`:198` の `timeout` が期限を使い切ると `:202` の
`left` が 0 で即 `break` するため、**畳まれたかを一度も尋ねないまま** `:216` の
「**本当に畳めなかったときだけ出る**」という警告が出る。

### R4-M3 `analyzer.rs` に `unwrap()` が残っている（rust MEDIUM / robustness MEDIUM）

R3-M3（`1e00f17`）は `protocol.rs` の1件を落として「本番で唯一」と記録したが、
**兄弟を数えていない。** `analyzer.rs:165` に手書きの
`duration_since(UNIX_EPOCH).unwrap()` が残る。同じファイルの `:15-20` に
`unwrap_or_default()` を使った `now_nanos()` があり、`:248` / `:285` はそちらを呼んでいる。

`start_infinite_analysis` の本番経路なので、壁時計が epoch より前を指すと Tauri の
コマンドタスクが panic し、`invoke` の promise が永久に解決しない。用途は ID の
一意化だけで `unwrap` である必要がゼロ。

### R4-M6 コードにレビューのラウンド番号が入った（comment MEDIUM / rust MEDIUM / robustness MEDIUM）

- `types.rs:175` — `型で分けたい → r4`
- `protocol.rs:650-651` — `**書き込み側の分岐を数え直さなかった**のが r2 → r3 の退行だった`

CLAUDE.md は変更の経緯を書くことを明示的に禁じ、`TODO` は issue 番号を伴わせる規約。
`r4` も `r2 → r3` も `.claude/reviews/` にしか存在しない採番を指している。
**R3-M9 でレビュー識別子（`B-2`）を落とした同じラウンドの別コミット**（`71147b0` / `872638a`）で
同じ種類が2件入った。`commentHistory` の `REVIEW_TAG` は括弧付きの識別子しか見ないので素通り。

---

## 1人だけが挙げたもの

### R4-H2 世代の確認と `ready.send(Ready)` の間に窓がある（rust）

`:398` の read guard は `if` を抜けた時点で落ちるので、`:398` と `:403` の間に別タスクが
`start_ready_watch_and_send` を完走できる。`h.abort()` は次の await 点までしか効かないので、
`:398` を通過済みのタスクは `:403` を同期実行する。

結果、**世代2の `isready` に `readyok` が返っていないのに `ready = Ready`** になり、
`ensure_ready` が即 `Ok` を返す。その先で `usinewgame` / `position` / `go` が
まだ評価関数を読んでいるエンジンへ流れる（USI 上、`readyok` 前の `position` / `go` は認められない）。
`apply_engine_settings` を続けて2回叩くと踏む。

### R4-H3 `Activity::Unresponsive` の「いまは到達しない」が何も書いていない doc を指す（comment）

`session.rs:843` が「いまは到達しない（`Activity::Unresponsive` の doc）」と書くが、
参照先（`:326-329`）は到達性に触れていない。理由（`on_search_outcome` が `StopTimedOut` を
受けたときだけ立ち、同じ呼び出しの中で必ず `Phase::Over` に入る）は `386e57f` の
**コミットメッセージにしか無い。** 不変条件が git log に置き去りになっている。

### R4-M1 `pending_after_ready` は積んだコマンドを黙って捨てる（rust / robustness。r1 から4ラウンド持ち越し）

消える経路が3つあり、どれも呼び出し側には既に `Ok(())` を返している。

1. **`abort_init` の全消し**（`:566`）。`isready` のたびに世代を問わず `clear()` する。
   「適用」→ 積まれる →「解析開始」で `position` / `go` も積まれ `Ok` →
   `readyok` の前にもう一度「適用」→ **`go` はどこにも書かれないまま消える**
2. **世代の読みと挿入が別のロック**（`:320` と `:321`）。間に `abort_init` が挟まると
   消された直後の古い世代へ挿入する。その entry を掃く者はいない
3. **flush の失敗が `warn` だけで残りを捨てる**（`:415-423`）。`position` は書けたが
   `go` で失敗した場合、`search.rs` は `bestmove` を待ち続ける（第1相に時間の枝が無い＝H-3）

キューに上限も無い。`readyok` が返らないエンジンでは積み続ける。

### R4-M2 `Thinking` かつ `turn_started == None` に番人が1つも無い（rust / robustness）

`STOP_GRACE` が包んでいるのは**待ち**だけで、`stop` の書き込み自体
（同期 write、`handler` の Mutex 付き、`search.rs:162`）は包まれていない。ここで詰まると
`Activity::Stopping` が解けず `turn_started` は `None` のまま。

`AwaitingRuling` には `RULING_TIMEOUT` がいるのに、**`Thinking` + `turn_started == None` には
番人が無い**（時計が動かないので `on_tick` の時間切れ判定にも当たらない）。
r3 より前は時計が進んでいたので `enforce_engine_timeout` が真なら終局に落ちた。
いまは無音で固まり `close_game` を押すまで気付けない。

### R4-M4 `shutdown_engine` が冪等でない（rust）

`bridge.rs:123` の `stop_all_sessions().await?` は、エンジンが既に居ないと
`NotInitialized` で `Err` になり、**`:125` の `analyzer.shutdown()`（台帳から外す処理）に
到達しない。** `engine_id` は `Some` のまま残り、以降どのコマンドも
「Engine is no longer running」を返す。

`EngineRegistry::shutdown` は「知らない ID を渡しても成功扱い」と決めている
（`registry.rs:142-143`）のに、その上の層で冪等性が壊れている。
利用者に見えるのは「終了ボタンを押したらエラーが出て、以後何をしてもエラー」。

### R4-M5 `info nodes` が 2^31 を超えると行が丸ごと捨てられる（rust）

`usi-0.6.2/src/protocol/parser.rs:121-127` は `nodes` を `i32` でパースし、失敗すると
**行ごと** `Error::IllegalSyntax`。`process/engine.rs:200-203` はそれを `continue` で黙って捨てる。

`nodes` は `pv` / `score` / `depth` と同じ行に載るので、累計ノード数が 2^31 を超えた瞬間から
**`info` が1行も通らなくなる。** 無限解析は 10 Mnps なら約3.6分で届く。
利用者に見えるのは「解析が動いているのに評価値と読み筋が固まったまま」で、
ログに手掛かりが1行も無い。`utils.rs` の `as u64` は値がここまで来ないので救いにならない。

### R4-M7 「規則は2箇所」の数が2つの文書で違う（comment）

`clock.rs:119-123` は「同じ規則が `budget_ms` と `consume` にもある」＝ここを入れて3、
`game-session.md:230-232` は「**2箇所**」と言いながら関数を3つ並べる。
実際に式を持つのは `view` / `budget_ms` / `consume` の3つ（`has_expired` は `budget_ms` に委譲）。

r3 の決めごとは「場所を言いたいなら数えて並べる」だったが、**並べた数そのものが食い違っている。**
「2箇所」を信じた人は3つ目を残す。残るのがどれかは読んだ文書で変わる。

### R4-M8 r3 が禁じたはずの一意性の断言が2箇所残っている（comment）

- `protocol.rs:220` — 「**ここが唯一の置き場。**」
- `session.rs:1835-1838` — 「**人間の手番が返らないまま止まった対局を畳む唯一の仕掛け**」

どちらも現時点では偽ではない（`protocol.rs` 側は `usi-0.6.2/src/process/engine.rs:190,196-206` を
読んで確認済み）。だが r1〜r3 で偽になった断言5件は全部この形だった。
とくに `session.rs:1837` は「唯一」をテスト名でも関数名でも表現していないので、
`Thinking` 側に別の打ち切り（R4-M2 / H-3）が入っても直す動機が誰にも生まれない。

### R4-M9 `CLOSE_POLL` だけ理由が書かれていない（comment）

`session.rs:74`。直前の `CLOSE_SETTLE_TIMEOUT` には2段落あるのに行が裸。
50ms は `close_game` の応答性と `run_loop` への `SearchesSettled` の投げ回数
（6秒で最大120回、`Tick` と同じキュー）の両方を決めている。
そもそも要求／応答なのにポーリングになっている理由（`Activity` が畳まれたことを
通知する口が無い）も読み取れない。

### R4-M10 命名の持ち越し4件の優先度（comment）

1. **`Aborted` の衝突が最優先で一番安い。** `SearchOutcome::Aborted`（正常に止まった）と
   `GameOverReason::Aborted`（勝敗なしで終局）が `on_search_outcome` の中に同居する
   （`session.rs:690` と `:761`）。表でも `E5` と `E11` が7行違いで並ぶ。
   `SearchOutcome` には serde が無い（`search.rs:33`）ので**改名すべきは内側**。
   境界も TS も動かない。`StoppedCleanly` を推す
2. **`Side` / `Color`。** `Color.Black = 0` が **falsy** なので `color ? "white" : "black"` の類が
   必ず紛れ、先後が入れ替わったまま `submitGameMove` に渡る。変換を1組に閉じる
3. **`get_game_state` → `get_game_snapshot`。** 綴りが割れているのは4箇所だけで**呼び手はまだ0**。
   UI が付いた後は最も高くなる
4. **`GameManager` / `EngineRegistry` の「台帳」は最後。** `registry.rs` は解析側からも
   使われていて影響範囲が対局の外へ出る

### R4-M11 `failure-surfacing.md` に対局の行が1つも無い（robustness。M-8 から4ラウンド持ち越し）

ADR-0004 決定6 の運用は「台帳に載せてから出口を作る」で、対局は**出口が1つも無いまま
Rust 側の経路だけが5本増えた。**

とくに `emit` の失敗（`session.rs:1142`）は、失敗が**別の失敗として説明される**形になっている。
`app.emit` が失敗 → `MoveDecided` が届かない → フロントは裁定を返しようがない →
30秒後に `Aborted` + `detail: "no ruling came back from the app"`。
**原因は Rust 側の送信失敗なのに、記録も表示もフロントの怠慢を指す。**

| 失敗                   | 場所                                        | いま起きること                                             |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| イベントの送信失敗     | `session.rs:1142`                           | `warn` のみ。30秒後に `aborted`、`detail` は別の原因を指す |
| 壁時計が取れない       | `session.rs:1104-1107`                      | `warn` のみ。両者の時計が止まったまま対局が進む            |
| 畳めないまま閉じた     | `session.rs:216-222`                        | `warn` のみ。探索中のエンジンを落とす                      |
| `gameover` を送れない  | `session.rs:1046-1048`                      | `warn` のみ。エンジンは対局中のまま                        |
| `EngineFailure` で終局 | `session.rs:654` / `:666` / `:709` / `:884` | 英文の `detail` が載るだけ（R2-H5）                        |

---

## 重複と矛盾

**重複**: B2 は3人、B3 / B4 / H1 / M3 / M6 は2人が別番号で挙げた。上でまとめた。

**矛盾はゼロ。** 3人の所見が食い違った箇所は無い。r1〜r3 では
「片方が安全と言い、片方が危険と言う」が毎回1件はあったので、これは焦点を絞った効果だと読む。

ただし**強調点は割れている**。rust は `Closed` の穴を「解析が無音で `Ok` を返し続ける」で、
robustness は同じ穴を「`ensure_ready` の早期脱出が死ぬ」で説明した。
どちらも正しく、直し方は同じ1つ。

## 退行の出どころ

BLOCK / HIGH 8件のうち **5件が r3 の修正が作ったもの**。

| 所見  | 出どころ              | 何が起きたか                                                      |
| ----- | --------------------- | ----------------------------------------------------------------- |
| R4-B2 | `578e5b1` / `43e573d` | `running: None` の発生源を2つ増やし、契約3箇所を直さなかった      |
| R4-B3 | `578e5b1`             | `elapsed_ms` → `running_clock` の改名で表が腐った                 |
| R4-B4 | `de86dd4`             | `CLOSE_QUIET_TIMEOUT` → `CLOSE_SETTLE_TIMEOUT` の改名で表が腐った |
| R4-H1 | `de86dd4`             | 上限を足したが、その先の詰まる書き込みを数えなかった              |
| R4-M6 | `71147b0` / `872638a` | R3-M9 でレビュー識別子を落とした同じラウンドで2件入れた           |

**形が1つに揃っている。「変えた側」は直して「読んでいる側」を数え直していない。**
r3 の計画で自分に課した2つの規律のうち、2番目（状態の意味を変えたら読み手を数える）を
守れていない。守れなかった理由は、規律を**人の注意**として書いたから。
r4 では同じものを機械に移す（下の lint 案）。

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。** すべて静的読解
- `npm run verify` / `npm run verify:rust` はレビュアーは走らせていない
- フロントの対局 UI は存在しない（`startGame` / `listenToGameEvents` の呼び出し元が0）ので、
  「利用者に何が見えるか」はイベントの payload と型の doc からの推定

個別:

- `docs/state-transitions/game-session.md` の `E1`〜`E16` 各セルと現物の突き合わせ（rust）
- `broadcast_to_listeners` の `HashMap` clone のコスト、`info` の流量（H-6 の持ち越し分）
- `apply_info_params` の `i32 as u32` の**負値**側。`info depth -1` を出すエンジンの実在を
  確かめられないので、オーバーフロー側（R4-M5）だけを出した
- `docs/state-transitions/` の他の表（`app.md` / `engine.md` / `game.md`）との整合
- 持ち越し（H-3 / H-5 / H-6 / H-9 / R2-H5 / R2-M1 / R2-M9 / M-1〜M-14 / M-18 / M-20〜M-25 /
  R2-M11 / R2-M12 / R3-M5 / R3-M10 / R3-M12 / R3-M13 / H-11）は再検証していない

## lint / hook 案

3人が独立に同じものを挙げた順に並べる。

| 何を                                                | どう                                                                                                                                                                       | 誰が挙げたか      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **doc が存在しない識別子を指さないこと**            | `docs/**/*.md` のバッククォート内から `[A-Z_]{4,}` と `snake_case` を拾い、`src-tauri/src/**` と `src/**` に無ければ落とす。`docsSourcePaths.ts` の `stripFences` が使える | **3人全員**       |
| **レビューのラウンド番号**                          | `commentHistory` の `REVIEW_TAG` に `→ *r\d+` と `r\d+ *→ *r\d+` を足す                                                                                                    | **3人全員**       |
| `Closed` が吸収状態であること                       | 遷移を純関数 `next_ready_state(current, event)` に出して `#[test]`。`dispatch_for` を足しただけでは足りなかったのが今回の穴                                                | rust / robustness |
| `ready.send(` の呼び出しが1箇所であること           | `protocol.rs` を grep して数える。いま `:233` / `:356` / `:403` の3つ                                                                                                      | robustness        |
| `send_command` の全分岐が `dispatch_for` を通ること | `send_command` の中に `dispatch_for` より前の `return` が現れたら落とす                                                                                                    | rust              |
| 本番コードの `unwrap()`                             | `src-tauri/src/engine/` の `#[cfg(test)]` 外の `.unwrap()` を数える。いま1件なので0に落として固定                                                                          | robustness        |
| 2つの enum に同名バリアントが無いこと               | R3-M10 で既出。`Aborted` の衝突が落ちる                                                                                                                                    | comment           |
| `failure-surfacing.md` に対局の行があること         | `verify-gate.sh` で `engine/game/` を触ったコミットを見る                                                                                                                  | robustness        |
| **機械で防げないもの**                              | 一意性の断言 / 「`null` になるのは A と B」型の**列挙**の断言 / 数えて並べた件数の食い違い / 世代照合と書き込みの間の窓 / コミットメッセージにしか無い不変条件             | 3人全員           |

**上2つは今回の BLOCK 4件のうち2件（B3 / B4）と M6 をそのまま止められる。** 最優先で入れる。

---

## 修正計画

危ないものから。1所見1コミット。

### 第1群: 実際に壊れているもの

1. **R4-B1** `Closed` を吸収状態にする。`next_ready_state` を純関数に出し、`IsReady` も
   `dispatch_for` を通す。`ensure_ready` は `subscribe()` を `send_command` より前に取る
2. **R4-H2** 世代の read guard を握ったまま `ready.send` まで行く
3. **R4-H1** `registry::terminate` の `quit` / `kill_engine` に上限を通す
4. **R4-M2** `stop` の書き込みを `timeout` で包み、`Thinking` + `turn_started == None` に番人を置く
5. **R4-M1** 世代の読みと push を1つのロックに入れ、上限を置き、捨てるときは必ず1行残す
6. **R4-M4** `stop_all_sessions` の `NotInitialized` を成功として飲む
7. **R4-M3** `analyzer.rs:165` を `now_nanos()` に置き換える

### 第2群: 機械化（第1群の再発を止める）

8. doc の識別子の実在検査（3人全員 / B3 / B4 を止める）
9. `commentHistory` に `→ *r\d+`（3人全員 / M6 を止める）
10. 本番 `unwrap()` のラチェット（M3 を止める）

### 第3群: 契約と doc

11. **R4-B2** `running: null` の4通りを3箇所に書き、畳み待ちでも `ClockUpdated` を出す
12. **R4-B3** 不変条件4 を `running_clock()` 1本に統一
13. **R4-B4** ※4 の定数名と、上限を超えたときに何が起きるかを書く
14. **R4-H3** `Unresponsive` の到達しない理由を doc に移す
15. **R4-M7** 時計の規則を3箇所に揃える
16. **R4-M8** 一意性の断言2件を機構の記述に置き換える
17. **R4-M9** `CLOSE_POLL` に理由を書く
18. **R4-M11** `failure-surfacing.md` に対局の5行を足す

### 第4群: 命名

19. **R4-M10-1** `SearchOutcome::Aborted` → `StoppedCleanly`（`E11` 行も同じコミットで）

### issue へ送る

- **R4-M5** `usi` crate の `nodes` が `i32`。fork か置き換えが要るので範囲外
- **R4-M10-2/3/4** `Side`/`Color` の変換、`get_game_state` の改名、台帳の語

## 結果

所見 17 件のうち **13 件を直し、4 件を issue へ送った**。1所見1コミット。

| 所見            | コミット            | 結果                                                                     |
| --------------- | ------------------- | ------------------------------------------------------------------------ |
| R4-B1           | `b6c4546`           | `Closed` を吸収状態にし、`isready` も `dispatch_for` を通した            |
| R4-H2           | `6daf768`           | 世代の確認と `Ready` の書き込みを同じロック区間へ                        |
| R4-H1           | `4076d4a`           | `quit` / `kill_engine` に `WRITE_TIMEOUT`。警告の偽の断言も直した        |
| R4-M2           | `3172248`           | `SETTLE_TIMEOUT` の番人 ＋ `stop` の書き込みの上限                       |
| R4-M1           | `f3c96d9`           | 世代とキューを1つの Mutex へ。上限 32。捨てるときは必ず `warn`           |
| R4-M4           | `bd6d4fa`           | `stop_analysis` が `NotInitialized` を飲む。`shutdown_engine` は折れない |
| R4-M3           | `084ac67`           | `analyzer.rs` の `unwrap()` を落とした                                   |
| R4-B4           | `13fd3e1` `16d1098` | 定数名を直し、**識別子の実在を機械で見る検査**を足した                   |
| R4-M6           | `e646a5c`           | ラウンド番号を落とし、`REVIEW_TAG` に足した                              |
| R4-M3（機械化） | `3e9ba2e`           | 本番の `.unwrap()` を 0 で固定                                           |
| R4-B2           | `2032c50`           | `running: null` の4通りを境界の3箇所に書いた                             |
| R4-B3           | `5f77764`           | 不変条件4 を `running_clock()` 1本に。`Over` 側のテストも足した          |
| R4-H3 / R4-M9   | `f379f5c`           | 到達しない理由を doc へ。`CLOSE_POLL` に理由を書いた                     |
| R4-M7 / R4-M8   | `43489fe`           | 件数を3に揃え、一意性の断言2件を落とした                                 |
| R4-M11          | `297c7eb`           | 台帳に F-19〜F-23 を足した                                               |
| R4-M10-1        | `1713c78`           | `SearchOutcome::StoppedCleanly` に改名                                   |

### issue へ送ったもの

| 所見         | issue | なぜ送ったか                                                     |
| ------------ | ----- | ---------------------------------------------------------------- |
| R4-M5        | #363  | `usi` crate の `nodes` が `i32`。fork か置き換えが要る           |
| R4-M10-2/3/4 | #364  | `Side`/`Color` の変換、`get_game_state`、台帳の語                |
| R4-M1 の根   | #361  | 積んで `Ok` を返す形そのもの。`send_command` の署名が動く        |
| R4-B2 の型   | #362  | `GameOverReason::Aborted` を型で割る。線に出る値なので TS も動く |

新しく立てたもう1件（#360）は「`UsiProtocol` をプロセス無しに検証できない」。
R4-H2 と R4-M4 にテストを付けられなかった理由がこれ。

### 足した機械（3本）

r4 の反省は「変えた側は直して、読んでいる側を数え直していない」だった。
r3 では同じことを**人の注意**として自分に課して守れなかったので、機械に移した。

| 検査                     | 何を止めるか                           | 効いた証拠                               |
| ------------------------ | -------------------------------------- | ---------------------------------------- |
| `docsIdentifiers`        | 状態遷移表が実在しない識別子を指すこと | **作った直後に R4-B4 を捕まえた**        |
| `commentHistory`（拡張） | コードに残ったラウンド番号             | 変異（`→ r4` を書き戻す）で落ちる        |
| `production_unwrap`      | 本番コードの `.unwrap()`（ハード0）    | 変異（`analyzer.rs` に書き戻す）で落ちる |

### 作業中に機械に止められた回数: 3

自分の作った検査と既存の検査が、この修正ラウンドの中で私を3回止めた。

1. `docsIdentifiers` が自分の doc に引いた消えた定数名を根拠に空回りしていた
   （コメントを落としてから数える形に直した）
2. そのコメント除去を自前で書いたら `sourceText` の検査が落ちた（`codeOf` に寄せた）
3. `production_unwrap` の doc に経緯を書いて `commentHistory` に止められた
   （現在形に直した）

**3件とも、機械が無ければ気付かないまま通していた。**

### 自分が作った退行

`git checkout` で変異を戻したとき、同じファイルに足したばかりの
`no_clock_is_running_after_the_game_is_over` も一緒に消した。
気付いて入れ直した（`5f77764` に含まれている）。
**変異を戻すのに `git checkout <file>` を使わない**（そのファイルの未コミットの
変更を全部捨てる）。以降はバックアップからの復元に統一した。

### 検証

`npm run verify`（644 tests）と `npm run verify:rust`（69 lib + 2 + 9 + 10 + 4）が
どちらも緑。**実機のエンジンは1つも起動していない。**
